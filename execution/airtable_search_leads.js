require('dotenv').config();
const Airtable = require('airtable');

/**
 * Searches the Airtable leads based on given filters.
 * @param {Object} filters - Dictionary of filters.
 * @param {string} [filters.city] - The city the lead is located in.
 * @param {string} [filters.service] - The type of service.
 * @param {number} [filters.minimum_rating] - Minimum acceptable rating.
 * @param {string} [filters.status] - Status of the lead.
 * @param {number} filters.count - Number of results to return.
 * @returns {Promise<Array>} Array of matched lead objects.
 */
async function searchLeadsInAirtable(filters) {
    if (!process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_TABLE_NAME) {
        throw new Error("Missing Airtable environment variables: AIRTABLE_PERSONAL_ACCESS_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME");
    }

    const count = parseInt(filters.count) || 5;
    
    const base = new Airtable({ apiKey: process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN }).base(process.env.AIRTABLE_BASE_ID);
    const table = base(process.env.AIRTABLE_TABLE_NAME);

    // Build the formula
    const conditions = [];

    if (filters.name) {
        conditions.push(`FIND(LOWER('${filters.name.replace(/'/g, "\\'")}'), LOWER({name})) > 0`);
    }
    
    if (filters.city) {
        // Simple case-insensitive match for city in address
        conditions.push(`FIND(LOWER('${filters.city.replace(/'/g, "\\'")}'), LOWER({address})) > 0`);
    }
    
    if (filters.service) {
        conditions.push(`LOWER({service}) = LOWER('${filters.service.replace(/'/g, "\\'")}')`);
    }

    if (filters.minimum_rating !== undefined && filters.minimum_rating !== null) {
        const minRating = parseFloat(filters.minimum_rating);
        if (!isNaN(minRating)) {
            conditions.push(`{rating} >= ${minRating}`);
        }
    }

    if (filters.status) {
        conditions.push(`{status} = '${filters.status.replace(/'/g, "\\'")}'`);
    }

    let formula = '';
    if (conditions.length > 1) {
        formula = `AND(${conditions.join(', ')})`;
    } else if (conditions.length === 1) {
        formula = conditions[0];
    }

    const queryOptions = {
        maxRecords: count,
        sort: [{ field: 'rating', direction: 'desc' }]
    };

    if (formula) {
        queryOptions.filterByFormula = formula;
    }

    try {
        const records = await table.select(queryOptions).firstPage();
        
        return records.map(record => {
            return {
                id: record.id,
                name: record.get('name'),
                service: record.get('service'),
                address: record.get('address'),
                website: record.get('website'),
                email: record.get('email'),
                rating: record.get('rating'),
                date_created: record.get('date_created'),
                status: record.get('status')
            };
        });
    } catch (err) {
        console.error("Failed to query Airtable:", err);
        throw err;
    }
}

module.exports = { searchLeadsInAirtable };

// Self-test execution if run directly
if (require.main === module) {
    console.log("Testing Airtable search integration...");
    
    // Create dummy filters based on command line arguments
    const filters = {
        city: process.argv[2] || 'Portland',
        service: process.argv[3] || undefined,
        count: parseInt(process.argv[4]) || 3
    };

    console.log("Using filters:", filters);

    searchLeadsInAirtable(filters)
        .then(result => {
            console.log(`\nFound ${result.length} result(s):`);
            console.log(JSON.stringify(result, null, 2));
        })
        .catch(err => {
            console.error("Test failed:", err);
        });
}
