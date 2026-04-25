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
        errors: errors
    };
}

module.exports = { saveLeadsToAirtable };

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
