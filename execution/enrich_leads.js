require('dotenv').config();
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TITLES = ['CEO', 'Founder', 'Co-Founder', 'Co Founder', 'Hiring Manager', 'Head of Operations'];

// ─── PROVIDER EXHAUSTION TRACKER ────────────────────────────────────────────
const PROVIDER_STATUS_FILE = path.join(__dirname, '../.tmp/provider_status.json');

function getProviderStatus() {
    const today = new Date().toISOString().split('T')[0];
    if (fs.existsSync(PROVIDER_STATUS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(PROVIDER_STATUS_FILE, 'utf8'));
            if (data.date === today) return data;
        } catch (e) {}
    }
    return { date: today, hunter: false, snov: false, tomba: false };
}

function markExhausted(provider) {
    const status = getProviderStatus();
    if (status[provider]) return; // already marked
    status[provider] = true;
    const tmpDir = path.dirname(PROVIDER_STATUS_FILE);
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(PROVIDER_STATUS_FILE, JSON.stringify(status, null, 2));
    console.log(`[enrich] ${provider} exhausted for today — skipping for remaining leads`);
}

// ─── PROVIDER 1: HUNTER.IO ──────────────────────────────────────────────────
async function tryHunter(domain) {
    if (!process.env.HUNTER_API_KEY) return null;
    if (getProviderStatus().hunter) { console.log(`[enrich] Hunter.io — skipping (exhausted today)`); return null; }
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
        if (e.response?.status === 429 || e.response?.status === 402) markExhausted('hunter');
        else console.log(`[enrich] Hunter.io failed: ${e.message}`);
    }
    return null;
}

// ─── PROVIDER 4: GETPROSPECT ─────────────────────────────────────────────────
// Name-based lookup — only fires after website scraping finds a decision maker name.
async function tryGetProspect(domain, name) {
    if (!process.env.GETPROSPECT_API_KEY || !name) return null;
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
        if (email && (status === 'valid' || status === 'accept_all')) {
            console.log(`[enrich] GetProspect → ${email}`);
            return { email, name, title: null };
        }
    } catch (e) {
        console.log(`[enrich] GetProspect failed: ${e.message}`);
    }
    return null;
}

// ─── PROVIDER 2: SNOV.IO ────────────────────────────────────────────────────
async function trySnovio(domain) {
    if (!process.env.SNOV_CLIENT_ID || !process.env.SNOV_CLIENT_SECRET) return null;
    if (getProviderStatus().snov) { console.log(`[enrich] Snov.io — skipping (exhausted today)`); return null; }
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
        if (e.response?.status === 402 || e.response?.status === 429) markExhausted('snov');
        else console.log(`[enrich] Snov.io failed: ${e.message}`);
    }
    return null;
}

// ─── PROVIDER 3: TOMBA.IO ───────────────────────────────────────────────────
async function tryTomba(domain) {
    if (!process.env.TOMBA_API_KEY || !process.env.TOMBA_API_SECRET) return null;
    if (getProviderStatus().tomba) { console.log(`[enrich] Tomba.io — skipping (exhausted today)`); return null; }
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
        if (e.response?.status === 402 || e.response?.status === 429) markExhausted('tomba');
        else console.log(`[enrich] Tomba.io failed: ${e.message}`);
    }
    return null;
}

// ─── PROVIDER 5: PROSPEO ─────────────────────────────────────────────────────
// Note: Prospeo deprecated /domain-search on March 1, 2026.
// Now uses /enrich-person which requires a name — called only after scraping finds a name.
async function tryProspeo(domain, name) {
    if (!process.env.PROSPEO_API_KEY || !name) return null;
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
        console.log(`[enrich] Prospeo failed: ${e.message}`);
    }
    return null;
}


// ─── CASCADE ORCHESTRATOR ────────────────────────────────────────────────────
async function findDecisionMakerEmail(domain, name, title) {
    return await tryHunter(domain) ||
           await trySnovio(domain) ||
           await tryTomba(domain) ||
           await tryGetProspect(domain, name) ||
           await tryProspeo(domain, name) ||
           null;
}

// ─── MAIN ENRICHMENT ────────────────────────────────────────────────────────
async function enrichLead(lead) {
    let browser;
    try {
        console.log(`[enrich_leads] Starting enrichment for ${lead.name}`);

        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
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
        const dmResult = await findDecisionMakerEmail(domain, decision_maker_name, decision_maker_title);
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

module.exports = { enrichLead };
