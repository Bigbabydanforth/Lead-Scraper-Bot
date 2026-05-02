const puppeteer = require('puppeteer');

/**
 * Navigates to a company website to extract an email address.
 */
async function extractEmail(browser, url) {
    if (!url || !url.startsWith('http')) return '';

    let email = '';
    const page = await browser.newPage();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        email = await page.evaluate(() => {
            // Priority 1: mailto links
            const mailto = document.querySelector('a[href^="mailto:"]');
            if (mailto) {
                const raw = mailto.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
                try { return decodeURIComponent(raw); } catch (_) { return raw; }
            }

            // Priority 2: regex match on body text
            const text = document.body.innerText;
            // Basic email regex
            const match = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (match) {
                // Ignore common false positives
                const val = match[1].toLowerCase();
                if (!val.endsWith('.png') && !val.endsWith('.jpg') && !val.endsWith('.webp') && !val.endsWith('.gif')) {
                    return val;
                }
            }
            return '';
        });
    } catch (e) {
        console.log(`Error extracting email from ${url}:`, e.message);
    } finally {
        await page.close().catch(() => { });
    }
    return email;
}

/**
 * Scrapes Google Maps for business leads.
 * @param {string} service - The service to search for.
 * @param {string} city - The city to search in.
 * @param {number} count - The exact number of leads to extract.
 * @returns {Promise<Array>} - Array of objects containing lead information.
 */
async function scrapeGoogleMaps(service, city, count) {
    const query = encodeURIComponent(`${service} in ${city}`);
    const url = `https://www.google.com/maps/search/${query}`;

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();

    // Set a cookie to bypass Google Consent pages
    await page.setCookie({
        name: 'CONSENT',
        value: 'YES+cb.20230501-07-p0.en+FX+414',
        domain: '.google.com'
    });

    // Set a sensible user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log(`Navigating to Google Maps: ${url}`);

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Handle Google Consent screen if redirected
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

                    if (acceptBtn) {
                        acceptBtn.click();
                    } else {
                        const forms = document.querySelectorAll('form');
                        if (forms.length > 0) forms[0].submit();
                    }
                });
                console.log('Submitted consent, waiting for navigation...');
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
            } catch (e) {
                console.log('Error bypassing consent:', e);
            }
        }

        // Wait for results container or similar element to appear
        try {
            await page.waitForSelector('a[href*="/maps/place/"]', { timeout: 15000 });
        } catch (e) {
            console.log("Could not find standard places link. Dumping HTML to .tmp/debug.html");
            const fs = require('fs');
            const path = require('path');
            const tmpDir = path.join(__dirname, '..', '.tmp');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
            fs.writeFileSync(path.join(tmpDir, 'debug.html'), await page.content());
            throw new Error("Failed to find results. See .tmp/debug.html");
        }

        const placeUrls = new Set();
        let attempts = 0;
        const maxAttempts = parseInt(count) * 5; // scroll more times to gather URLs
        const urlsNeeded = parseInt(count) * 10 + 20; // buffer since many might lack emails

        while (placeUrls.size < urlsNeeded && attempts < maxAttempts) {
            attempts++;

            const urls = await page.evaluate(() => {
                const results = [];
                const items = document.querySelectorAll('a[href*="/maps/place/"]');
                for (const item of items) {
                    if (item.href) results.push(item.href);
                }
                return results;
            });

            urls.forEach(url => placeUrls.add(url));

            if (placeUrls.size >= urlsNeeded) break;

            // Scroll down to load more using the feed container
            const canScroll = await page.evaluate(() => {
                const feed = document.querySelector('div[role="feed"]');
                if (feed) {
                    feed.scrollBy(0, feed.clientHeight);
                    return true;
                }
                return false;
            });

            if (!canScroll) break;

            // Wait for new items to load
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log(`Gathered ${placeUrls.size} place URLs. Extracting details...`);
        const leads = [];

        for (const url of Array.from(placeUrls)) {
            if (leads.length >= count) break;

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                // We just wait for the h1 to appear, which means the place loaded
                await page.waitForSelector('h1', { timeout: 5000 }).catch(() => { });

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
                const hasNoRating = isNaN(ratingNum); // New business with no reviews yet

                if (details.name && details.website && (hasValidRating || hasNoRating)) {
                    const email = await extractEmail(browser, details.website) || "";
                    leads.push({
                        name: details.name,
                        service: service,
                        address: details.address || `Located in ${city}`,
                        website: details.website,
                        email: email,
                        city: city,
                        rating: details.rating || "No rating",
                        date_created: new Date().toISOString().split('T')[0],
                        status: 'lead'
                    });
                    const ratingLabel = hasNoRating ? 'No rating' : `⭐${ratingNum}`;
                    console.log(`Found qualified lead: ${details.name} ${ratingLabel} (Email: ${email || "None, passed to enrichment"})`);
                } else {
                    console.log(`Discarded ${details.name} (no website, or rating below 3.5)`);
                }
            } catch (e) {
                console.log(`Error navigating to place page: ${e.message}`);
            }
        }

        await browser.close();

        // Return exactly count leads
        return leads.slice(0, count);

    } catch (e) {
        console.error("Error scraping Google Maps:", e);
        await browser.close();
        throw e;
    }
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
            // Ensure .tmp exists
            const tmpDir = path.join(__dirname, '..', '.tmp');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir);
            }

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

            csvWriter.writeRecords(leads)
                .then(() => {
                    console.log(`Successfully saved to ${csvPath}`);
                });
        }
    }).catch(err => {
        console.error("Failed to run test:", err);
    });
}
