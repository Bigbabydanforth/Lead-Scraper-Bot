# Workflow: enrich_leads

## Purpose
Takes a raw lead object and enriches it with company information and email addresses.

## Input
A single lead object with fields: name, website, address, service, city

## Steps
1. Open the company website using Puppeteer (headless: true)
2. Set a 15-second navigation timeout. If the site times out, skip this lead.
3. Visit the following pages in order (only if they exist — do not error if a page is missing):
   - Homepage (already loaded)
   - /about or /about-us
   - /contact or /contact-us
   - /team or /our-team
4. From all pages visited, extract:
   - company_summary: up to 500 characters of text describing what the company does. Use only
     text found on the page. Do not invent or assume anything.
   - company_email: extract the domain from the website URL, then only accept emails whose
     domain exactly matches the company's own domain (ignore third-party emails scraped from
     the page). Priority order within own-domain emails: contact@ > info@ > hello@ > any other.
     Ignore: noreply@, donotreply@, support tickets, job application emails.
5. From the Team or About page, extract if present:
   - decision_maker_name: the full name of the CEO, Founder, Co-Founder,
     Hiring Manager, or Head of Operations (in that priority order)
   - decision_maker_title: their exact job title as written on the page
6. Find the decision_maker_email using a 4-provider cascade (stop at first success):

   **Provider 1 — Hunter.io**
   - GET https://api.hunter.io/v2/domain-search?domain={domain}&api_key={HUNTER_API_KEY}
   - From the results array, match job titles in priority order:
     CEO, Founder, Co-Founder, Co Founder, Hiring Manager, Head of Operations
   - Use the matching entry's `value` field as the decision_maker_email

   **Provider 2 — Apollo.io**
   - POST https://app.apollo.io/api/v1/mixed_people/api_search
   - Body: { organization_domains: [domain], page: 1, per_page: 10 }
   - Header: X-Api-Key: {APOLLO_API_KEY}
   - Match same title priority order; skip entries where email contains `*`

   **Provider 3 — Snov.io**
   - OAuth2 client_credentials flow to get access token
   - Start async domain search (v2), poll up to 3 times for completion
   - Start async prospects search, poll up to 3 times for completion
   - For the first prospect matching title priority, fetch their email via search-emails endpoint
   - Use the first valid SMTP-verified email found

   **Provider 4 — Prospeo**
   - POST https://api.prospeo.io/enrich-person
   - Requires a name (first + last) already extracted from the website
   - Only called if decision_maker_name was found in step 5
   - Header: X-KEY: {PROSPEO_API_KEY}

   **Last resort — Website personal email**
   - If all 4 providers return null, scan own-domain emails already extracted from website pages
   - Use any email that doesn't look like a generic address (not info@, contact@, hello@,
     admin@, support@, sales@)

7. Skip this lead entirely (return null) if BOTH of these are true:
   - company_email is null or empty
   - decision_maker_email is null or empty
8. If only one email was found, proceed with what is available. Do not skip.
9. Close the Puppeteer browser before returning.

## Output
Enriched lead object with all original fields plus:
- company_summary (string)
- company_email (string or null)
- decision_maker_name (string or null)
- decision_maker_title (string or null)
- decision_maker_email (string or null)

## Error Handling
- If the website cannot be reached: return null
- If a sub-page (/about, /contact, /team) 404s: skip that page, continue with others
- If a provider API call fails: log the error, move to the next provider
- Never crash. Always return either an enriched lead object or null.

## Environment Variables Required
- HUNTER_API_KEY
- APOLLO_API_KEY
- SNOV_CLIENT_ID + SNOV_CLIENT_SECRET
- PROSPEO_API_KEY
