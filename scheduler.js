require('dotenv').config();
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const Airtable = require('airtable');

const { scrapeGoogleMaps } = require('./execution/scrape_google_maps');
const { enrichLead, getCurrentMode } = require('./execution/enrich_leads');
const { researchCompany } = require('./execution/research_company');
const { draftEmail } = require('./execution/draft_email');
const { sendEmails } = require('./execution/send_email');
const { saveLeadsToAirtable, isLeadAlreadySaved } = require('./execution/airtable_save_leads');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const TARGETS_FILE = path.join(__dirname, 'targets.json');

async function runDailyPipeline(overrideService, overrideCity, overrideCount) {
    console.log(`\n\n--- DAILY PIPELINE STARTED AT ${new Date().toISOString()} ---\n`);

    const summaryData = {
        queuedProcessed: 0,
        queuedSent: 0,
        discovered: 0,
        enriched: 0,
        researched: 0,
        drafted: 0,
        saved: 0,
        sentToday: 0
    };

    // Step 1: Process queued leads
    try {
        const base = new Airtable({ apiKey: process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN }).base(process.env.AIRTABLE_BASE_ID);
        const table = base(process.env.AIRTABLE_TABLE_NAME);
        
        console.log("[scheduler] Step 1: Processing queued leads from previous days");
        const queuedRecords = await new Promise((resolve, reject) => {
            table.select({
                filterByFormula: "OR({email_status} = 'queued', {email_status} = 'email1_sent')",
                maxRecords: 50
            }).firstPage((err, records) => {
                if (err) return reject(err);
                resolve(records);
            });
        });

        console.log(`[scheduler] Processing ${queuedRecords.length} queued leads from previous runs`);
        summaryData.queuedProcessed = queuedRecords.length;

        for (const record of queuedRecords) {
            const lead = record.fields;
            if (!lead.email1_body && !lead.email2_body) {
                console.log(`[scheduler] Skipping queued lead ${lead.name} — no email body found`);
                continue;
            }
            const result = await sendEmails(lead, record.getId());
            if (result.sent) summaryData.queuedSent++;
            summaryData.sentToday += (result.emails_sent_count || 0);
        }

    } catch (err) {
        console.error("[scheduler] Failed processing queued leads:", err.message);
    }

    // Step 2: Load today's targets or use overrides
    let city, service, countToScrape, dailyTarget;

    if (overrideService && overrideCity) {
        city = overrideCity;
        service = overrideService;
        dailyTarget = overrideCount || 15;
        countToScrape = dailyTarget * 3;
        console.log(`[scheduler] Running Targeted Override: ${service} in ${city} (Target: ${dailyTarget} companies)`);
    } else {
        let targets;
        try {
            targets = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf8'));
        } catch (e) {
            console.error("[scheduler] Failed to load targets.json");
            return;
        }

        const allCountries = [
            ...(targets.primary_countries || []),
            ...(targets.secondary_countries || [])
        ];
        
        const countryIndex = (targets.current_country_index || 0) % allCountries.length;
        const sIndex = (targets.current_service_index || 0) % targets.service_categories.length;
        const country = allCountries[countryIndex];
        const citiesList = targets.cities[country];
        if (!citiesList || citiesList.length === 0) {
            console.error(`[scheduler] No cities configured for country "${country}" — skipping this run`);
            return;
        }
        const cIndex = (targets.current_city_index || 0) % citiesList.length;
        
        city = citiesList[cIndex];
        service = targets.service_categories[sIndex];
        countToScrape = targets.scrape_buffer || 40;
        dailyTarget = targets.leads_per_run || 15;

        console.log(`[scheduler] Today's target: ${service} in ${city}, ${country}`);

        // Country-first saturation: run all 12 niches in one city before moving to the next.
        // Service index advances every day. City only advances when all niches are done.
        const nextSIndex = (sIndex + 1) % targets.service_categories.length;
        targets.current_service_index = nextSIndex;

        if (nextSIndex === 0) {
            // Completed all niches for this city — move to the next city
            const nextCIndex = cIndex + 1;
            if (nextCIndex >= citiesList.length) {
                // Exhausted all cities in this country — move to next country
                targets.current_city_index = 0;
                targets.current_country_index = (countryIndex + 1) % allCountries.length;
            } else {
                targets.current_city_index = nextCIndex;
                targets.current_country_index = countryIndex;
            }
        }

        fs.writeFileSync(TARGETS_FILE, JSON.stringify(targets, null, 2));
    }

    // Step 3: Discover raw leads
    let rawLeads = [];
    try {
        rawLeads = await scrapeGoogleMaps(service, city, countToScrape);
        console.log(`[scheduler] Discovered ${rawLeads.length} raw leads`);
    } catch (err) {
        console.error("[scheduler] Error discovering leads:", err.message);
    }

    // Step 3.5: Deduplicate — skip companies already in Airtable or seen twice in this batch
    const freshLeads = [];
    const seenDomains = new Set();
    for (const lead of rawLeads) {
        let domain = '';
        try {
            const raw = lead.website || '';
            const url = raw.startsWith('http') ? raw : 'https://' + raw;
            domain = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        } catch (e) {}
        if (!domain) {
            console.log(`[scheduler] Dedup: skipping ${lead.name} — cannot parse website URL`);
            continue;
        }
        if (seenDomains.has(domain)) {
            console.log(`[scheduler] Dedup: skipping ${lead.name} — duplicate domain in this run`);
            continue;
        }
        const alreadySeen = await isLeadAlreadySaved(lead.website);
        if (alreadySeen) {
            console.log(`[scheduler] Dedup: skipping ${lead.name} — already in Airtable`);
        } else {
            seenDomains.add(domain);
            freshLeads.push(lead);
        }
    }
    rawLeads = freshLeads;
    summaryData.discovered = rawLeads.length;
    console.log(`[scheduler] ${rawLeads.length} fresh leads after deduplication`);

    // Steps 4-6: Process each lead fully before moving to the next.
    // Stop as soon as dailyTarget companies qualify — saves Claude tokens on unused leads.
    const qualifiedLeads = [];
    const allProcessed = [];

    const mode = getCurrentMode();
    if (mode === 'name_only') {
        console.log(`[scheduler] Mode: NAME-ONLY — domain providers exhausted. Only leads with a scraped decision maker name will qualify.`);
    } else if (mode === 'company_only') {
        console.log(`[scheduler] Mode: COMPANY-ONLY — all providers exhausted. Sending Email 1 (company inbox) only.`);
    } else {
        console.log(`[scheduler] Mode: FULL — domain search active.`);
    }

    for (const rawLead of rawLeads) {
        if (qualifiedLeads.length >= dailyTarget) break;

        const enriched = await enrichLead(rawLead);
        if (!enriched) {
            console.log(`[scheduler] ${rawLead.name} — enrichment failed, skipping`);
            continue;
        }
        summaryData.enriched++;

        // In name-only mode, skip any lead where website scraping found no decision maker name.
        // All three domain providers are exhausted — GetProspect/Prospeo need a name to work.
        if (mode === 'name_only' && !enriched.decision_maker_name) {
            console.log(`[scheduler] Name-only mode: skipping ${rawLead.name} — no name found on website`);
            continue;
        }

        const opps = await researchCompany(enriched);
        if (!opps || opps.length === 0) {
            enriched.skip_reason = 'no_opportunity';
            allProcessed.push(enriched);
            continue;
        }
        summaryData.researched++;
        enriched.automation_opportunities = opps;

        const drafted = await draftEmail(enriched);
        if (!drafted || (!drafted.email1_body && !drafted.email2_body)) {
            enriched.skip_reason = 'draft_failed';
            allProcessed.push(enriched);
            continue;
        }

        qualifiedLeads.push(drafted);
        allProcessed.push(drafted);
    }

    summaryData.drafted = qualifiedLeads.length;
    console.log(`[scheduler] ${qualifiedLeads.length}/${dailyTarget} companies qualified (${summaryData.enriched} enriched, ${allProcessed.length - qualifiedLeads.length} skipped)`);

    // Step 7: Save leads to Airtable
    console.log(`[scheduler] Saving leads to Airtable...`);
    const savedLeadsWithIds = [];
    for (const lead of allProcessed) {
        const saveResult = await saveLeadsToAirtable([lead]);
        if (saveResult.success && saveResult.records && saveResult.records.length > 0) {
            const recordId = saveResult.records[0].getId();
            savedLeadsWithIds.push({ lead, recordId });
        }
    }
    console.log(`[scheduler] Saved ${savedLeadsWithIds.length} leads to Airtable`);
    summaryData.saved = savedLeadsWithIds.length;

    // Step 8: Send Emails
    const sentLeads = []; // Track leads that were fully sent for detailed reporting
    for (const item of savedLeadsWithIds) {
        const { lead, recordId } = item;
        if (lead.email1_body || lead.email2_body) {
            const result = await sendEmails(lead, recordId);
            if (result.sent) {
                console.log(`[scheduler] Sent to ${lead.name}`);
                sentLeads.push({ lead, emailsSentCount: result.emails_sent_count || 0 });
            } else if (result.reason === "daily_limit_reached") {
                console.log(`[scheduler] Queued ${lead.name}`);
            }
            summaryData.sentToday += result.emails_sent_count || 0;
        }
    }

    // Step 9: Send Telegram summary
    console.log("[scheduler] Sending Telegram summary");
    const today = new Date().toISOString().split('T')[0];
    const skipped = (summaryData.enriched - summaryData.researched) + (summaryData.researched - summaryData.drafted);
    const queued = summaryData.saved - sentLeads.length;
    const remainingQuota = Math.max(0, 30 - summaryData.sentToday);

    const summaryMsg = `🤖 *Daily Outreach Report — ${today}*

Leads discovered: ${summaryData.discovered}
Leads enriched: ${summaryData.enriched}
Leads researched with opportunities: ${summaryData.researched}
Emails drafted: ${summaryData.drafted}
Emails sent today: ${summaryData.sentToday}
Leads queued for tomorrow: ${queued}
Leads skipped (no email or no opportunity): ${skipped}

Remaining email quota for the day: ${remainingQuota}`;

    try {
        if (process.env.TELEGRAM_CHAT_ID) {
            await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, summaryMsg, { parse_mode: 'Markdown' });
        } else {
            console.log("[scheduler] TELEGRAM_CHAT_ID missing in .env. Skipping Telegram message.");
        }
    } catch (e) {
        console.error("[scheduler] Failed to send Telegram summary:", e.message);
    }

    // Step 9b: Send detailed per-company reports
    console.log(`[scheduler] Sending detailed reports for ${sentLeads.length} companies`);
    await sendDetailedCompanyReports(sentLeads, bot);

    console.log("--- PIPELINE FINISHED ---");
}

async function sendDetailedCompanyReports(sentLeads, bot) {
    if (!process.env.TELEGRAM_CHAT_ID || sentLeads.length === 0) return;

    for (let i = 0; i < sentLeads.length; i++) {
        const { lead, emailsSentCount } = sentLeads[i];

        try {
            const opps = Array.isArray(lead.automation_opportunities)
                ? lead.automation_opportunities
                : (lead.automation_opportunities || '').split('\n').filter(Boolean);

            const oppLines = opps.length > 0
                ? opps.map(o => `  \u2713 ${o.trim()}`).join('\n')
                : '  \u2713 No opportunities listed';

            const dmLine = lead.decision_maker_name
                ? `${lead.decision_maker_name}${lead.decision_maker_title ? ` (${lead.decision_maker_title})` : ''}`
                : 'Not found';

            const msg = `\u{1F3E2} *Company #${i + 1}*

*Company Name:* ${lead.name}
*City:* ${lead.city || 'N/A'}
*Industry:* ${lead.service || 'N/A'}

*Company Email:* ${lead.company_email || 'N/A'}
*Decision Maker:* ${dmLine}
*Decision Maker Email:* ${lead.decision_maker_email || 'N/A'}

*What They Need Built:*
${oppLines}

*Status:* Emails sent to ${emailsSentCount} recipient${emailsSentCount !== 1 ? 's' : ''} today`;

            await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
            console.log(`[scheduler] Detailed report sent for ${lead.name}`);

            // Respect Telegram rate limits when sending many messages
            if (sentLeads.length > 5 && i < sentLeads.length - 1) {
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {
            console.error(`[scheduler] Failed to send detailed report for ${lead.name}:`, e.message);
            // Never crash the pipeline — just continue to the next company
        }
    }
}

cron.schedule('0 8 * * *', runDailyPipeline);
console.log('[scheduler] Morning pipeline scheduled for 08:00 UTC');

cron.schedule('0 14 * * *', runDailyPipeline);
console.log('[scheduler] Afternoon pipeline scheduled for 14:00 UTC');

module.exports = { runDailyPipeline };
