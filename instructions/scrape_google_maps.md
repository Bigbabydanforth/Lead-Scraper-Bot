# scrape_google_maps

## Description
This workflow searches Google Maps for a specific service in a given city and extracts a precise number of business leads.

## Inputs
- `service` (string): The type of business to search for (e.g., "plumbers", "coffee shops").
- `city` (string): The location to search in (e.g., "Miami", "Toronto").
- `count` (integer): The exact number of leads to return.

## Outputs
Returns an array of JSON objects (leads). Exactly `count` items (or less if the search exhausted available results).
Fields required for each lead:
- `name` (string): The name of the business.
- `service` (string): The service type/category.
- `address` (string): The physical address.
- `website` (string): The URL of the business website (if available).
- `rating` (string/number): The review rating (if available).
- `date_created` (string): The date the lead was scraped (YYYY-MM-DD).
- `status` (string): Default is "lead".

## Execution Path
Implemented in `execution/scrape_google_maps.js`.
