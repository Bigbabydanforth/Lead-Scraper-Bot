const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

async function launchBrowser() {
    return puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1280, height: 800 },
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });
}

const BLOCKED_TYPES = new Set(['image', 'font', 'media', 'other']);

async function newLeanPage(browser) {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (BLOCKED_TYPES.has(req.resourceType())) req.abort();
        else req.continue();
    });
    page.setDefaultNavigationTimeout(15000);
    return page;
}

/**
 * Navigates to a company website to extract an email address.
 */
async function extractEmail(page, url) {
    if (!url || !url.startsWith('http')) return '';
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        return await page.evaluate(() => {
            const mailto = document.querySelector('a[href^="mailto:"]');
            if (mailto) {
                const raw = mailto.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
                try { return decodeURIComponent(raw); } catch (_) { return raw; }
            }
            const text = document.body.innerText;
            const match = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (match) {
                const val = match[1].toLowerCase();
                if (!val.endsWith('.png') && !val.endsWith('.jpg') && !val.endsWith('.webp') && !val.endsWith('.gif')) {
                    return val;
                }
            }
            return '';
        });
    } catch (e) {
        console.log(`Error extracting email from ${url}:`, e.message);
        return '';
    }
}

/**
 * Phase 1: Collect place URLs from Google Maps, then close browser.
 */
async function collectPlaceUrls(service, city, count) {
    const query = encodeURIComponent(`${service} in ${city}`);
    const url = `https://www.google.com/maps/search/${query}`;
    const urlsNeeded = Math.min(parseInt(count) * 3 + 10, 60);

    const browser = await launchBrowser();
    const page = await newLeanPage(browser);

    await page.setCookie({
        name: 'CONSENT',
        value: 'YES+cb.20230501-07-p0.en+FX+414',
        domain: '.google.com'
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log(`Navigating to Google Maps: ${url}`);

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        if (page.url().includes('consent.google.com')) {
            console.log('Redirected to Google Consent page. Attempting to accept...');
            try {
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const acceptBtn = buttons.find(b =>
                        b.textContent.includes('Accept all') ||
                        b.textContent.includes('I agree') ||
                        b.textContent.includes('Accept')
                    );
                    if (acceptBtn) acceptBtn.click();
                    else { const forms = document.querySelectorAll('form'); if (forms.length > 0) forms[0].submit(); }
                });
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
            } catch (e) {
                console.log('Error bypassing consent:', e);
            }
        }

        try {
            await page.waitForSelector('a[href*="/maps/place/"]', { timeout: 15000 });
        } catch (e) {
            console.log("Could not find standard places link.");
            await browser.close();
            return [];
        }

        const placeUrls = new Set();
        let attempts = 0;
        const maxAttempts = parseInt(count) * 4;

        while (placeUrls.size < urlsNeeded && attempts < maxAttempts) {
            attempts++;
            const urls = await page.evaluate(() => {
                const items = document.querySelectorAll('a[href*="/maps/place/"]');
                return Array.from(items).map(i => i.href).filter(Boolean);
            });
            urls.forEach(u => placeUrls.add(u));
            if (placeUrls.size >= urlsNeeded) break;

            const canScroll = await page.evaluate(() => {
                const feed = document.querySelector('div[role="feed"]');
                if (feed) { feed.scrollBy(0, feed.clientHeight); return true; }
                return false;
            });
            if (!canScroll) break;
            await new Promise(r => setTimeout(r, 2000));
        }

        console.log(`Gathered ${placeUrls.size} place URLs. Closing Maps browser...`);
        return Array.from(placeUrls);
    } finally {
        await browser.close();
    }
}

/**
 * Phase 2: Visit each place URL in a fresh browser and extract lead details.
 */
async function extractLeadDetails(placeUrls, service, city, count) {
    const browser = await launchBrowser();
    const page = await newLeanPage(browser);

    const leads = [];

    try {
        for (const url of placeUrls) {
            if (leads.length >= count) break;

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await page.waitForSelector('h1', { timeout: 5000 }).catch(() => {});

                const details = await page.evaluate(() => {
                    const nameEl = document.querySelector('h1');
                    const name = nameEl ? nameEl.textContent.trim() : '';
                    const ratingEl = document.querySelector('div.fontDisplayLarge');
                    const rating = ratingEl ? ratingEl.textContent.trim() : '';
                    const websiteEl = document.querySelector('a[data-item-id="authority"]');
                    const website = websiteEl ? websiteEl.getAttribute('href') : '';
                    const addressEl = document.querySelector('button[data-item-id="address"]');
                    const address = addressEl ? addressEl.textContent.trim() : '';
                    return { name, rating, website, address };
                });

                const ratingNum = parseFloat(details.rating);
                const hasValidRating = !isNaN(ratingNum) && ratingNum >= 3.5;
                const hasNoRating = isNaN(ratingNum);

                if (details.name && details.website && (hasValidRating || hasNoRating)) {
                    const email = await extractEmail(page, details.website) || '';
                    leads.push({
                        name: details.name,
                        service: service,
                        address: details.address || `Located in ${city}`,
                        website: details.website,
                        email: email,
                        city: city,
                        rating: details.rating || 'No rating',
                        date_created: new Date().toISOString().split('T')[0],
                        status: 'lead'
                    });
                    const ratingLabel = hasNoRating ? 'No rating' : `⭐${ratingNum}`;
                    console.log(`Found qualified lead: ${details.name} ${ratingLabel} (Email: ${email || 'None, passed to enrichment'})`);
                    if (leads.length >= count) break;
                } else {
                    console.log(`Discarded ${details.name} (no website, or rating below 3.5)`);
                }
            } catch (e) {
                console.log(`Error navigating to place page: ${e.message}`);
            }
        }
    } finally {
        await browser.close();
    }

    return leads.slice(0, count);
}

/**
 * Scrapes Google Maps for business leads.
 */
async function scrapeGoogleMaps(service, city, count) {
    const placeUrls = await collectPlaceUrls(service, city, parseInt(count));
    if (placeUrls.length === 0) throw new Error('No place URLs collected from Google Maps.');
    console.log(`Extracting details from ${placeUrls.length} URLs...`);
    return await extractLeadDetails(placeUrls, service, city, parseInt(count));
}

module.exports = { scrapeGoogleMaps };

// Self-test execution if run directly
if (require.main === module) {
    const { createObjectCsvWriter } = require('csv-writer');
    const path = require('path');
    const fs = require('fs');

    const testService = process.argv[2] || 'coffee shops';
    const testCity = process.argv[3] || 'Toronto';
    const testCount = parseInt(process.argv[4]) || 2;

    console.log(`Testing scraper for: ${testCount} ${testService} in ${testCity}`);

    scrapeGoogleMaps(testService, testCity, testCount).then(leads => {
        console.log(`Found ${leads.length} leads.`);
        console.log(leads);

        if (leads.length > 0) {
            const tmpDir = path.join(__dirname, '..', '.tmp');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

            const csvPath = path.join(tmpDir, 'test_leads.csv');
            const csvWriter = createObjectCsvWriter({
                path: csvPath,
                header: [
                    { id: 'name', title: 'Name' },
                    { id: 'service', title: 'Service' },
                    { id: 'address', title: 'Address' },
                    { id: 'website', title: 'Website' },
                    { id: 'email', title: 'Email' },
                    { id: 'rating', title: 'Rating' },
                    { id: 'date_created', title: 'Date Created' },
                    { id: 'status', title: 'Status' }
                ]
            });
            csvWriter.writeRecords(leads).then(() => console.log(`Saved to ${csvPath}`));
        }
    }).catch(err => console.error('Failed:', err));
}
