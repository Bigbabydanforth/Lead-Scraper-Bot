require('dotenv').config();
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TITLES = ['CEO', 'Founder', 'Co-Founder', 'Co Founder', 'Hiring Manager', 'Head of Operations'];

// ─── PROVIDER EXHAUSTION TRACKER ────────────────────────────────────────────
const PROVIDER_STATUS_FILE = path.join(__dirname, '../.tmp/provider_status.json');

function getProviderStatus() {
    const today = new Date().toISOString().split('T')[0];
    const thisMonth = today.substring(0, 7);
    const fresh = { date: today, month: thisMonth, hunter: false, snov: false, tomba: false, icypeas: false, getprospect: false, prospeo: false };

    if (!fs.existsSync(PROVIDER_STATUS_FILE)) return fresh;
    let saved;
    try { saved = JSON.parse(fs.readFileSync(PROVIDER_STATUS_FILE, 'utf8')); } catch (e) { return fresh; }

    // New billing month — full reset
    if (saved.month !== thisMonth) return fresh;

    // Same month, new day — reset daily-only flags, keep monthly ones
    if (saved.date !== today) {
        const refreshed = { ...saved, date: today };
        for (const key of ['hunter', 'snov', 'tomba', 'icypeas', 'getprospect', 'prospeo']) {
            if (refreshed[key] === 'daily') refreshed[key] = false;
        }
        return refreshed;
    }

    return saved;
}

function getCurrentMode() {
    const status = getProviderStatus();
    const domainExhausted = status.hunter && status.snov && status.tomba && status.icypeas;
    const nameExhausted = status.getprospect && status.prospeo;
    if (!domainExhausted) return 'full';
    if (!nameExhausted) return 'name_only';
    return 'company_only';
}

// type: 'monthly' = billing credits gone (don't retry until next month)
//       'daily'   = rate limited today only (retry tomorrow)
function markExhausted(provider, type = 'daily') {
    const status = getProviderStatus();
    if (status[provider] === 'monthly') return; // already permanently flagged this month
    if (status[provider] === type) return; // already flagged same type
    status[provider] = type;
    const tmpDir = path.dirname(PROVIDER_STATUS_FILE);
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(PROVIDER_STATUS_FILE, JSON.stringify(status, null, 2));
    const label = type === 'monthly' ? 'for this billing period' : 'for today';
    console.log(`[enrich] ${provider} exhausted ${label} — skipping remaining leads`);
}

// ─── PROVIDER 1: HUNTER.IO ──────────────────────────────────────────────────
async function tryHunter(domain) {
    if (!process.env.HUNTER_API_KEY) return null;
    if (getProviderStatus().hunter) { console.log(`[enrich] Hunter.io — skipping (exhausted)`); return null; }
    try {
        const res = await axios.get(
            `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${process.env.HUNTER_API_KEY}`
        );
        const emails = res.data?.data?.emails || [];
        for (const title of TITLES) {
            const match = emails.find(e =>
                e.position?.toLowerCase().includes(title.toLowerCase()) && e.value
            );
            if (match) {
                console.log(`[enrich] Hunter.io → ${match.value}`);
                return {
                    email: match.value,
                    name: `${match.first_name || ''} ${match.last_name || ''}`.trim(),
                    title: match.position
                };
            }
        }
    } catch (e) {
        if (e.response?.status === 402) markExhausted('hunter', 'monthly');
        else if (e.response?.status === 429) markExhausted('hunter', 'daily');
        else console.log(`[enrich] Hunter.io failed: ${e.message}`);
    }
    return null;
}

// ─── PROVIDER 4: ICYPEAS (name lookup via LinkedIn data) ─────────────────────
// Does NOT return an email. Returns { name, title } of the decision maker found
// on LinkedIn for this domain. Used to feed GetProspect and Prospeo when website
// scraping found no name.
async function tryIcypeasNameLookup(domain) {
    if (!process.env.ICYPEAS_API_KEY) return null;
    if (getProviderStatus().icypeas) { console.log(`[enrich] Icypeas — skipping (exhausted)`); return null; }
    try {
        const res = await axios.post(
            'https://app.icypeas.com/api/find-people',
            {
                query: {
                    currentJobTitle: { include: ['CEO', 'Founder', 'Co-Founder', 'Co Founder', 'Head of Operations', 'Managing Director', 'President', 'Hiring Manager'] },
                    currentCompanyWebsite: { include: [domain] }
                },
                pagination: { size: 1 }
            },
            { headers: { 'Authorization': process.env.ICYPEAS_API_KEY, 'Content-Type': 'application/json' } }
        );
        const leads = res.data?.leads || [];
        if (leads.length > 0) {
            const person = leads[0];
            const fullName = `${person.firstname || person.firstName || ''} ${person.lastname || person.lastName || ''}`.trim();
            const jobTitle = person.currentJobTitle || person.jobTitle || '';
            if (fullName) {
                console.log(`[enrich] Icypeas → found name: ${fullName} (${jobTitle})`);
                return { name: fullName, title: jobTitle };
            }
        }
    } catch (e) {
        if (e.response?.status === 402) markExhausted('icypeas', 'monthly');
        else if (e.response?.status === 429) markExhausted('icypeas', 'daily');
        else console.log(`[enrich] Icypeas name lookup failed: ${e.message}`);
    }
    return null;
}

// ─── PROVIDER 6: GETPROSPECT ─────────────────────────────────────────────────
// Name-based lookup — only fires after website scraping finds a decision maker name.
async function tryGetProspect(domain, name) {
    if (!process.env.GETPROSPECT_API_KEY || !name) return null;
    if (getProviderStatus().getprospect) { console.log(`[enrich] GetProspect — skipping (exhausted)`); return null; }
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) return null;
    try {
        const res = await axios.get('https://api.getprospect.com/v2/email-finder', {
            params: {
                full_name: name.trim(),
                domain,
                api_key: process.env.GETPROSPECT_API_KEY
            }
        });
        const email = res.data?.data?.email;
        const status = res.data?.data?.status;
        const creditsLeft = res.data?.metadata?.credits?.email_search;
        if (creditsLeft === 0) markExhausted('getprospect', 'monthly');
        if (email && (status === 'valid' || status === 'accept_all')) {
            console.log(`[enrich] GetProspect → ${email}`);
            return { email, name, title: null };
        }
    } catch (e) {
        if (e.response?.status === 402) markExhausted('getprospect', 'monthly');
        else if (e.response?.status === 429) markExhausted('getprospect', 'daily');
        else console.log(`[enrich] GetProspect failed: ${e.message}`);
    }
    return null;
}

// ─── PROVIDER 2: SNOV.IO ────────────────────────────────────────────────────
async function trySnovio(domain) {
    if (!process.env.SNOV_CLIENT_ID || !process.env.SNOV_CLIENT_SECRET) return null;
    if (getProviderStatus().snov) { console.log(`[enrich] Snov.io — skipping (exhausted)`); return null; }
    try {
        // Step 1: Get access token
        const tokenRes = await axios.post(
            'https://api.snov.io/v1/oauth/access_token',
            new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: process.env.SNOV_CLIENT_ID,
                client_secret: process.env.SNOV_CLIENT_SECRET
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const token = tokenRes.data?.access_token;
        if (!token) return null;

        const authHeaders = { 'Authorization': `Bearer ${token}` };

        // Step 2: Start async domain search (v2)
        const startRes = await axios.post(
            'https://api.snov.io/v2/domain-search/start',
            new URLSearchParams({ domain }).toString(),
            { headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const taskHash = startRes.data?.meta?.task_hash;
        if (!taskHash) return null;

        // Step 3: Poll for result (up to 3 attempts)
        let resultData = null;
        for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const resultRes = await axios.get(
                `https://api.snov.io/v2/domain-search/result/${taskHash}`,
                { headers: authHeaders }
            );
            if (resultRes.data?.status === 'completed') {
                resultData = resultRes.data;
                break;
            }
        }
        if (!resultData) return null;

        // Step 4: Start prospects search to find decision maker emails
        const prospectsStartRes = await axios.post(
            'https://api.snov.io/v2/domain-search/prospects/start',
            new URLSearchParams({ domain, page: 1 }).toString(),
            { headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const prospectsHash = prospectsStartRes.data?.meta?.task_hash;
        if (!prospectsHash) return null;

        // Step 5: Poll prospects result
        for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const prospectsRes = await axios.get(
                `https://api.snov.io/v2/domain-search/prospects/result/${prospectsHash}`,
                { headers: authHeaders }
            );
            if (prospectsRes.data?.status === 'completed') {
                const prospects = prospectsRes.data?.data || [];
                for (const title of TITLES) {
                    const match = prospects.find(p =>
                        p.position?.toLowerCase().includes(title.toLowerCase())
                    );
                    if (match && match.search_emails_start) {
                        // Step 6: Fetch this person's email
                        const prospectHash = match.search_emails_start.split('/start/')[1];
                        if (!prospectHash) continue;
                        const emailStartRes = await axios.post(
                            `https://api.snov.io/v2/domain-search/prospects/search-emails/start/${prospectHash}`,
                            {},
                            { headers: authHeaders }
                        );
                        const emailTaskHash = emailStartRes.data?.meta?.task_hash;
                        if (!emailTaskHash) continue;
                        await new Promise(r => setTimeout(r, 2000));
                        const emailResultRes = await axios.get(
                            `https://api.snov.io/v2/domain-search/prospects/search-emails/result/${emailTaskHash}`,
                            { headers: authHeaders }
                        );
                        const emails = emailResultRes.data?.data?.emails || [];
                        const validEmail = emails.find(e => e.smtp_status === 'valid')?.email || emails[0]?.email;
                        if (validEmail) {
                            console.log(`[enrich] Snov.io → ${validEmail}`);
                            return {
                                email: validEmail,
                                name: `${match.first_name || ''} ${match.last_name || ''}`.trim(),
                                title: match.position
                            };
                        }
                    }
                }
                break;
            }
        }
    } catch (e) {
        if (e.response?.status === 402) markExhausted('snov', 'monthly');
        else if (e.response?.status === 429) markExhausted('snov', 'daily');
        else console.log(`[enrich] Snov.io failed: ${e.message}`);
    }
    return null;
}

// ─── PROVIDER 3: TOMBA.IO ───────────────────────────────────────────────────
async function tryTomba(domain) {
    if (!process.env.TOMBA_API_KEY || !process.env.TOMBA_API_SECRET) return null;
    if (getProviderStatus().tomba) { console.log(`[enrich] Tomba.io — skipping (exhausted)`); return null; }
    try {
        const res = await axios.get('https://api.tomba.io/v1/domain-search', {
            params: { domain },
            headers: {
                'X-Tomba-Key': process.env.TOMBA_API_KEY,
                'X-Tomba-Secret': process.env.TOMBA_API_SECRET
            }
        });
        const emails = res.data?.data?.emails || [];
        for (const title of TITLES) {
            const match = emails.find(e =>
                e.position?.toLowerCase().includes(title.toLowerCase()) && e.email
            );
            if (match) {
                console.log(`[enrich] Tomba.io → ${match.email}`);
                return {
                    email: match.email,
                    name: `${match.first_name || ''} ${match.last_name || ''}`.trim(),
                    title: match.position
                };
            }
        }
    } catch (e) {
        if (e.response?.status === 402) markExhausted('tomba', 'monthly');
        else if (e.response?.status === 429) markExhausted('tomba', 'daily');
        else console.log(`[enrich] Tomba.io failed: ${e.message}`);
    }
    return null;
}

// ─── PROVIDER 5: ICYPEAS EMAIL SEARCH ────────────────────────────────────────
// Uses firstname + lastname + domain to find a personal email.
// Async endpoint — POST starts the search, then poll until DONE.
async function tryIcypeasEmailSearch(domain, name) {
    if (!process.env.ICYPEAS_API_KEY || !name) return null;
    if (getProviderStatus().icypeas) { console.log(`[enrich] Icypeas email search — skipping (exhausted)`); return null; }
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) return null;
    try {
        const startRes = await axios.post(
            'https://app.icypeas.com/api/email-search',
            {
                firstname: parts[0],
                lastname: parts.slice(1).join(' '),
                domainOrCompany: domain
            },
            { headers: { 'Authorization': process.env.ICYPEAS_API_KEY, 'Content-Type': 'application/json' } }
        );
        const searchId = startRes.data?.item?._id;
        if (!searchId) return null;

        const TERMINAL = new Set(['FOUND', 'NOT_FOUND', 'DEBITED', 'DEBITED_NOT_FOUND', 'BAD_INPUT', 'INSUFFICIENT_FUNDS', 'ABORTED']);
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 3000));
            const poll = await axios.post(
                'https://app.icypeas.com/api/bulk-single-searchs/read',
                { id: searchId },
                { headers: { 'Authorization': process.env.ICYPEAS_API_KEY, 'Content-Type': 'application/json' } }
            );
            const item = poll.data?.items?.[0];
            if (!item) continue;
            const status = (item.status || '').toUpperCase();
            if (status === 'FOUND' || status === 'DEBITED') {
                const emails = item.results?.emails || [];
                const found = emails.find(e => e.certainty && e.certainty !== 'not_found');
                const email = found?.email;
                if (email) {
                    console.log(`[enrich] Icypeas email search → ${email} (${found.certainty})`);
                    return { email, name, title: null };
                }
                return null;
            }
            if (TERMINAL.has(status)) return null;
        }
    } catch (e) {
        if (e.response?.status === 402) markExhausted('icypeas', 'monthly');
        else if (e.response?.status === 429) markExhausted('icypeas', 'daily');
        else console.log(`[enrich] Icypeas email search failed: ${e.message}`);
    }
    return null;
}

// ─── PROVIDER 6: PROSPEO ─────────────────────────────────────────────────────
// Note: Prospeo deprecated /domain-search on March 1, 2026.
// Now uses /enrich-person which requires a name — called only after scraping finds a name.
async function tryProspeo(domain, name) {
    if (!process.env.PROSPEO_API_KEY || !name) return null;
    if (getProviderStatus().prospeo) { console.log(`[enrich] Prospeo — skipping (exhausted)`); return null; }
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) return null;
    try {
        const res = await axios.post(
            'https://api.prospeo.io/enrich-person',
            {
                data: {
                    first_name: parts[0],
                    last_name: parts.slice(1).join(' '),
                    company_website: domain
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-KEY': process.env.PROSPEO_API_KEY
                }
            }
        );
        const email = res.data?.email?.value;
        if (email) {
            console.log(`[enrich] Prospeo → ${email}`);
            return { email, name, title: null };
        }
    } catch (e) {
        if (e.response?.status === 402) markExhausted('prospeo', 'monthly');
        else if (e.response?.status === 429) markExhausted('prospeo', 'daily');
        else console.log(`[enrich] Prospeo failed: ${e.message}`);
    }
    return null;
}

// ─── CASCADE ORCHESTRATOR ────────────────────────────────────────────────────
// Domain providers run one-at-a-time: exhaust Hunter across ALL leads before
// touching Snov, exhaust Snov before touching Tomba. No credit wasted trying
// the next provider on a lead the current one simply couldn't find.
async function findActiveDomainProvider(domain) {
    const status = getProviderStatus();
    if (!status.hunter) return await tryHunter(domain);
    if (!status.snov)   return await trySnovio(domain);
    if (!status.tomba)  return await tryTomba(domain);
    return null;
}

// Same logic for name-based providers.
async function findActiveNameProvider(domain, name) {
    if (!name) return null;
    const status = getProviderStatus();
    if (!status.getprospect) return await tryGetProspect(domain, name);
    if (!status.prospeo)     return await tryProspeo(domain, name);
    if (!status.icypeas)     return await tryIcypeasEmailSearch(domain, name);
    return null;
}

async function findDecisionMakerEmail(domain, name) {
    // Phase 1: Active domain provider only — if it can't find the lead, move on
    const domainResult = await findActiveDomainProvider(domain);
    if (domainResult) return domainResult;

    // Phase 2: If website had no name, ask Icypeas to find one from LinkedIn
    let resolvedName = name;
    if (!resolvedName) {
        const icypeasPerson = await tryIcypeasNameLookup(domain);
        if (icypeasPerson) resolvedName = icypeasPerson.name;
    }

    // Phase 3: Active name-based provider only
    return await findActiveNameProvider(domain, resolvedName) || null;
}

// ─── MAIN ENRICHMENT ────────────────────────────────────────────────────────
async function enrichLead(lead) {
    let browser;
    try {
        console.log(`[enrich_leads] Starting enrichment for ${lead.name}`);

        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });
        const page = await browser.newPage();
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(15000);

        let company_summary = null;
        let company_email = null;
        let decision_maker_name = null;
        let decision_maker_title = null;
        let decision_maker_email = null;

        const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
        let allEmails = new Set();
        if (lead.email) allEmails.add(lead.email.toLowerCase());
        let allText = '';
        let teamText = '';

        const extractEmails = (text) => {
            const matches = text.match(emailRegex);
            if (matches) {
                matches.forEach(e => {
                    const email = e.toLowerCase();
                    if (!email.startsWith('noreply@') && !email.startsWith('donotreply@') &&
                        !email.includes('support') && !email.includes('job')) {
                        allEmails.add(email);
                    }
                });
            }
        };

        const pagesToVisit = [
            { path: '', name: 'homepage' },
            { path: '/about', name: 'about' },
            { path: '/about-us', name: 'about-us' },
            { path: '/contact', name: 'contact' },
            { path: '/contact-us', name: 'contact-us' },
            { path: '/team', name: 'team' },
            { path: '/our-team', name: 'our-team' }
        ];

        let baseUrl = lead.website;
        if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

        // Strip UTM params and any query strings so sub-page paths (/about, /contact etc.)
        // are appended cleanly. Without this, a URL like ?utm_source=Google/about breaks.
        try {
            const parsed = new URL(baseUrl);
            baseUrl = parsed.origin + parsed.pathname.replace(/\/$/, '');
        } catch (e) { /* leave baseUrl as-is if parsing fails */ }

        let domain = new URL(baseUrl).hostname;
        if (domain.startsWith('www.')) domain = domain.substring(4);

        for (const p of pagesToVisit) {
            const url = baseUrl + p.path;
            try {
                console.log(`[enrich_leads] Visiting ${url}`);
                const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
                if (response && response.status() !== 404) {
                    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
                    allText += ' ' + text;
                    extractEmails(text);
                    if (p.name.includes('team') || p.name.includes('about')) {
                        teamText += ' ' + text;
                    }
                }
            } catch (err) {
                if (p.name === 'homepage') {
                    console.log(`[enrich_leads] Failed to reach homepage: ${err.message}`);
                    return null;
                }
            }
        }

        // 1. Company Summary
        company_summary = allText.replace(/\s+/g, ' ').trim().substring(0, 500);

        // 2. Company Email — only accept emails from the company's own domain
        const emailArray = Array.from(allEmails);
        const ownEmails = emailArray.filter(e => e.split('@')[1] === domain);
        if (ownEmails.length > 0) {
            company_email = ownEmails.find(e =>
                e.includes('contact') || e.includes('info') || e.includes('hello')
            ) || ownEmails[0];
            console.log(`[enrich_leads] Found company_email: ${company_email}`);
        }

        // 3. Decision Maker Name + Title from website pages
        const lines = teamText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        for (let i = 0; i < lines.length; i++) {
            for (const t of TITLES) {
                if (lines[i].includes(t)) {
                    decision_maker_title = t;
                    if (i > 0 && lines[i - 1].split(' ').length <= 4) {
                        decision_maker_name = lines[i - 1];
                    } else if (i < lines.length - 1 && lines[i + 1].split(' ').length <= 4) {
                        decision_maker_name = lines[i + 1];
                    }
                    break;
                }
            }
            if (decision_maker_title) break;
        }

        // 4. Decision Maker Email — cascade: Hunter → Snov.io → Tomba → GetProspect → Prospeo → website fallback
        const dmResult = await findDecisionMakerEmail(domain, decision_maker_name);
        if (dmResult) {
            decision_maker_email = dmResult.email;
            if (!decision_maker_name) decision_maker_name = dmResult.name;
            if (!decision_maker_title) decision_maker_title = dmResult.title;
        }

        // 5. Last resort: personal-looking email already visible on the website pages
        if (!decision_maker_email) {
            const personalEmails = ownEmails.filter(e =>
                !e.includes('info') && !e.includes('contact') && !e.includes('hello') &&
                !e.includes('admin') && !e.includes('support') && !e.includes('sales')
            );
            if (personalEmails.length > 0) {
                decision_maker_email = personalEmails[0];
                console.log(`[enrich_leads] Website fallback decision_maker_email: ${decision_maker_email}`);
            }
        }

        if (!company_email && !decision_maker_email) {
            console.log(`[enrich_leads] Skipping ${lead.name} — no emails found.`);
            return null;
        }

        return {
            ...lead,
            company_summary,
            company_email,
            decision_maker_name,
            decision_maker_title,
            decision_maker_email
        };

    } catch (error) {
        console.log(`[enrich_leads] ERROR for ${lead.name}: ${error.message}`);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { enrichLead, getCurrentMode };
