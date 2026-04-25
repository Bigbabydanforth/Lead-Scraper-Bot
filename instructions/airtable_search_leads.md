# `airtable_search_leads` Workflow Instructions

## Purpose
This workflow searches the Airtable base for leads matching specific criteria and returns them to the user.

## Inputs
This workflow expects a JSON object containing the following filters:
- \`city\` (string): The city the leads should be located in (searched within the address field).
- \`service\` (string): The type of service to filter by (e.g., "coffee shops").
- \`minimum_rating\` (number): The minimum rating the lead should have.
- \`status\` (string): The status of the lead (e.g., "lead", "contacted").
- \`count\` (number): The maximum number of results to return.

## Logic Overview
1.  **Initialize Airtable Client:** Connect to the `Leads` table using `AIRTABLE_PERSONAL_ACCESS_TOKEN` and `AIRTABLE_BASE_ID`.
2.  **Construct Filter Formula:** Dynamically build an Airtable formula using `AND()` to filter records based on provided inputs:
    *   `FIND(LOWER('${city}'), LOWER({address})) > 0` (if city applies)
    *   `{service} = '${service}'` (if service applies)
    *   `{rating} >= ${minimum_rating}` (if minimum_rating applies)
    *   `{status} = '${status}'` (if status applies)
3.  **Fetch Records:** Query Airtable using the formula.
4.  **Sort Results:** Sort the returned records by the `rating` column in descending order (highest first). Airtable API supports a `sort` array option in `.select()`.
5.  **Limit Results:** Return exactly `count` results (or fewer if not enough exist).

## Output
Returns a structured array of the formatted records. If no results are matched, it will return an empty array.
