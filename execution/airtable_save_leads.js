require('dotenv').config();
const Airtable = require('airtable');

/**
 * Saves a list of leads to Airtable.
 * Matches columns exactly: name, service, address, website, rating, date_created, status.
 * @param {Array} leads - The list of lead objects to save.
 * @returns {Promise<Object>} - Status object detailing success and records added.
 */
async function saveLeadsToAirtable(leads) {
    if (!process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_TABLE_NAME) {
        throw new Error("Missing Airtable environment variables: AIRTABLE_PERSONAL_ACCESS_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME");
    }

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
        console.log("No leads to save.");
        return { success: true, inserted: 0, errors: [] };
    }

    const base = new Airtable({ apiKey: process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN }).base(process.env.AIRTABLE_BASE_ID);
    const table = base(process.env.AIRTABLE_TABLE_NAME);

    // Airtable SDK allows creating up to 10 records at a time
    const chunkedLeads = [];
    for (let i = 0; i < leads.length; i += 10) {
        chunkedLeads.push(leads.slice(i, i + 10));
    }

    let insertedCount = 0;
    const errors = [];
    const insertedRecords = [];

    for (const chunk of chunkedLeads) {
        const recordsToCreate = chunk.map(lead => {
            const ratingNum = parseFloat(lead.rating);
            const fields = {
                name: lead.name || '',
                service: lead.service || '',
                address: lead.address || '',
                website: lead.website || '',
                email: lead.email || '',
                date_created: lead.date_created || new Date().toISOString().split('T')[0],
                status: lead.status || 'lead'
            };
            
            // Only add rating if it's a valid number to prevent type errors
            if (!isNaN(ratingNum)) {
                fields.rating = ratingNum;
            }

            // Add Phase 2 fields optionally
            if (lead.company_email) fields.company_email = lead.company_email;
            if (lead.company_summary) fields.company_summary = lead.company_summary;
            if (lead.decision_maker_name) fields.decision_maker_name = lead.decision_maker_name;
            if (lead.decision_maker_title) fields.decision_maker_title = lead.decision_maker_title;
            if (lead.decision_maker_email) fields.decision_maker_email = lead.decision_maker_email;
            
            if (lead.automation_opportunities && lead.automation_opportunities.length > 0) {
                fields.automation_opportunities = Array.isArray(lead.automation_opportunities) 
                    ? lead.automation_opportunities.join('\n') 
                    : lead.automation_opportunities;
            }

            if (lead.email1_subject) fields.email1_subject = lead.email1_subject;
            if (lead.email1_body) fields.email1_body = lead.email1_body;
            if (lead.email2_subject) fields.email2_subject = lead.email2_subject;
            if (lead.email2_body) fields.email2_body = lead.email2_body;
            if (lead.email_sent !== undefined && lead.email_sent !== null) fields.email_sent = lead.email_sent;
            if (lead.sent_at) fields.sent_at = lead.sent_at;
            if (lead.email_status) fields.email_status = lead.email_status;
            if (lead.skip_reason) fields.skip_reason = lead.skip_reason;

            return { fields };
        });

        try {
            await new Promise((resolve, reject) => {
                table.create(recordsToCreate, { typecast: true }, function(err, records) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    insertedCount += records.length;
                    insertedRecords.push(...records);
                    resolve(records);
                });
            });
        } catch (err) {
            console.error("Failed to insert chunk to Airtable:", err);
            errors.push(err);
        }
    }

    return {
        success: errors.length === 0,
        inserted: insertedCount,
        errors: errors,
        records: insertedRecords
    };
}

/**
 * Updates an existing lead record in Airtable with specific fields.
 * @param {string} recordId - The Airtable record ID
 * @param {Object} updates - Object containing the fields to update
 */
async function updateLeadStatus(recordId, updates) {
    if (!process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_TABLE_NAME) {
        throw new Error("Missing Airtable environment variables");
    }
    const base = new Airtable({ apiKey: process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN }).base(process.env.AIRTABLE_BASE_ID);
    const table = base(process.env.AIRTABLE_TABLE_NAME);

    try {
        const record = await new Promise((resolve, reject) => {
            table.update(recordId, updates, { typecast: true }, function(err, rec) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rec);
            });
        });
        console.log(`[Airtable] Successfully updated record ${recordId}`);
        return record;
    } catch (err) {
        console.error(`[Airtable] Failed to update record ${recordId}:`, err.message);
        return null;
    }
}

async function isLeadAlreadySaved(website) {
    if (!website) return false;
    if (!process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_TABLE_NAME) return false;

    let domain;
    try {
        let url = website;
        if (!url.startsWith('http')) url = 'https://' + url;
        domain = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch (e) {
        return false;
    }

    const base = new Airtable({ apiKey: process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN }).base(process.env.AIRTABLE_BASE_ID);
    const table = base(process.env.AIRTABLE_TABLE_NAME);

    const safeDomain = domain.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return new Promise((resolve) => {
        table.select({
            filterByFormula: `FIND("${safeDomain}", LOWER({website})) > 0`,
            maxRecords: 1,
            fields: ['website']
        }).firstPage((err, records) => {
            if (err) { resolve(false); return; }
            resolve(records && records.length > 0);
        });
    });
}

module.exports = { saveLeadsToAirtable, updateLeadStatus, isLeadAlreadySaved };

// Self-test execution if run directly
if (require.main === module) {
    console.log("Testing Airtable integration...");
    
    // Create dummy leads
    const dummyLeads = [
        {
            name: 'Test Coffee Shop 1',
            service: 'coffee shops',
            address: '123 Fake Street, Toronto',
            website: 'http://testcoffee1.com',
            rating: '4.9',
            date_created: new Date().toISOString().split('T')[0],
            status: 'lead'
        },
        {
            name: 'Test Coffee Shop 2',
            service: 'coffee shops',
            address: '456 Fake Avenue, Toronto',
            website: 'http://testcoffee2.com',
            rating: '4.1',
            date_created: new Date().toISOString().split('T')[0],
            status: 'lead'
        }
    ];

    saveLeadsToAirtable(dummyLeads)
        .then(result => {
            console.log("Test complete. Result:", result);
        })
        .catch(err => {
            console.error("Test failed:", err);
            console.log("\nMake sure your .env file is configured correctly!");
        });
}
