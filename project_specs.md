# Project Specifications

This document defines what we are building, as required by Step 1 of `instructions.md`.

## 1. Inputs
- What the user can send as input: Messages via Telegram with queries like "Find 5 plumbers in Miami".

## 2. Workflows
- What workflows exist: 
  - `scrape_google_maps`: Input (service, city, count). Output (exact count leads containing name, service, address, website, email, rating, date_created, status). Discards leads missing a website or email.
  - `airtable_save_leads`: Takes leads from `scrape_google_maps` and uploads them to Airtable using MCP. Columns match lead fields exactly.
  - `airtable_search_leads`: Input filters (city, service, minimum rating, status, count). Sorts by rating descending, returns exact count results.

## 3. Tools
- What tools are being used: Telegram (for input/output), Gemini (for understanding messages and workflow determination), Google Maps (for scraping), Airtable (via MCP for storage), Modal (for deployment).

## 4. Outputs
- What outputs are expected: Telegram responses confirming completion and previewing top results. Saved leads in Airtable.

## 5. Storage
- Where data is stored: Airtable.

## 6. Deployment
- Where the system will be deployed: Railway (running in the cloud, utilizing Railway variables for API keys).

## 7. Definition of Done
- What "done" looks like: Sending "Find 5 plumbers in Miami" results in 5 leads saved in Airtable, a Telegram reply confirming completion, and a preview of the top results.


---
---


# PHASE 2 — Outbound AI Sales Engine
## Added to extend the Lead Scraper Bot into a fully autonomous cold outreach system.
## All Phase 1 specs above remain unchanged. These specs are additive only.


---


## Phase 2 Overview

Phase 2 turns the existing lead scraper into a daily-running autonomous outreach engine.
It discovers businesses globally, reads their websites, researches how Gideon can help them,
finds two email addresses per company (general + decision-maker), drafts two separate
personalized cold emails using Claude, and sends them via Gmail — every single day,
automatically, without Gideon needing to do anything.


---


## Phase 2 — Inputs

Two types of triggers:

1. **Scheduled (automatic):** The scheduler runs every day at 08:00 AM UTC via node-cron.
   It reads `targets.json` to know which service categories and cities to search that day.
   No human input required.

2. **Manual (Telegram):** Gideon can send a message like:
   - "Run outreach today" → triggers the full pipeline immediately
   - "Find 10 SaaS companies in Austin" → triggers pipeline for that specific query only


---


## Phase 2 — Workflows

### Workflow 4: `enrich_leads`
- **Input:** A single lead object containing: `name`, `website`, `address`, `service`, `city`
- **Steps:**
  1. Open the company website using Puppeteer
  2. Visit and read: homepage, `/about`, `/contact`, `/team` (any that exist)
  3. Extract `company_summary` — a plain text description of what the company does
  4. Extract `company_email` — any general contact email found on the site
     (info@, contact@, hello@, support@, or any email on the contact page)
  5. Extract `decision_maker_name` and `decision_maker_title` from Team or About page
     (look for: CEO, Founder, Co-Founder, Hiring Manager, Head of Operations)
  6. Find `decision_maker_email` using Hunter.io Domain Search API (PRIMARY method):
     - Call Hunter.io with the company domain
     - Filter results by title priority: CEO → Founder → Co-Founder → Hiring Manager → Head of Operations
     - Select the result with the highest confidence score
     - Fallback (only if Hunter.io returns zero results): look for the email directly on the website pages already loaded
  7. Skip this lead entirely if BOTH `company_email` AND `decision_maker_email` are missing
  8. If only one email is found, proceed with what is available — do not skip
- **Output:** Enriched lead object with fields:
  `company_summary`, `company_email`, `decision_maker_name`, `decision_maker_title`, `decision_maker_email`
- **Environment variable required:** `HUNTER_API_KEY`
- **Hunter.io endpoint:** `GET https://api.hunter.io/v2/domain-search?domain={domain}&api_key={HUNTER_API_KEY}`


---


### Workflow 5: `research_company`
- **Input:** Enriched lead object (must include `company_summary`, `service`, `city`, `website`)
- **Steps:**
  1. Send company details to Claude API
  2. Claude reads `company_summary` and identifies specific, real automation pain points
  3. Claude maps those pain points to Gideon's exact skills:
     - **n8n, Make.com, Zapier** → multi-step workflow automation, removing manual tasks
     - **Claude API, OpenAI/GPT-4o** → AI integrations, chatbots, intelligent data processing
     - **Node.js, JavaScript** → custom backend automation scripts and APIs
     - **Airtable, Google Sheets** → data pipeline automation and structured CRM systems
     - **Telegram bots** → internal notification and automation tools
     - **React** → dashboards and internal tools with live data
     - **Docker, Railway, AWS EC2** → deployment and infrastructure automation
  4. Output is a short, specific list: `automation_opportunities[]`
     - Each item must be one concrete, actionable thing Gideon could build for this company
     - Example: "Automate their client onboarding flow using n8n and Airtable"
     - Example: "Build a GPT-4o chatbot for their ecommerce product support"
     - Claude must NOT invent or guess. Only use what was found in `company_summary`.
     - If no real opportunity is identifiable → return empty array `[]`
  5. If `automation_opportunities` is empty → skip this lead. Do not draft an email.
- **Output:** `automation_opportunities[]` added to lead object
- **Claude model:** `claude-haiku-4-5` (cost-efficient, used for bulk research pass)
- **Environment variable required:** `ANTHROPIC_API_KEY`


---


### Workflow 6: `draft_email`
- **Input:** Fully enriched and researched lead (all fields including `automation_opportunities`)
- **Steps:**
  1. Read `assets/gideon_profile.md` before calling Claude — this file contains Gideon's
     skills, tone, LinkedIn URL, portfolio URL, and how he wants to present himself
  2. Send all lead data + gideon_profile to Claude API
  3. Claude drafts **Email 1** (to `company_email`):
     - Addresses the company as a whole (e.g. "Hi [Company Name] team,")
     - References the company name, what they do, and their city
     - Mentions one specific automation opportunity found during research
     - Explains how Gideon can solve it in simple, plain terms
     - Includes Gideon's LinkedIn URL and portfolio URL
     - Tone: friendly, professional, warm — never salesy or template-sounding
     - Format: plain text only. No HTML. No bullet points. No headers.
     - Length: 150–180 words maximum for the body
     - Subject line: specific to the company, no spam trigger words
       (avoid: FREE, guaranteed, opportunity, make money, click here, limited time)
  4. Claude drafts **Email 2** (to `decision_maker_email`, if it exists):
     - Addresses the decision-maker by first name (e.g. "Hi Sarah,")
     - Mentions their role and company name
     - Same automation opportunity, reframed as a leadership or operational problem
       they personally face as the person running the business
     - Same LinkedIn and portfolio links
     - Tone: more direct and personal — peer-to-peer, not vendor-to-client
     - Format: plain text only. No HTML. No bullet points. No headers.
     - Length: 150–180 words maximum for the body
     - Subject line: different from Email 1, addressed to them personally
  5. Both emails must feel handwritten by a real person
  6. Both emails must be completely different from each other — not paraphrases
  7. If only `company_email` exists → draft Email 1 only
  8. If only `decision_maker_email` exists → draft Email 2 only
- **Output:** `email1_subject`, `email1_body`, `email2_subject`, `email2_body` added to lead object
- **Claude model:** `claude-sonnet-4-6` (higher quality, used only for final email drafting)
- **Environment variable required:** `ANTHROPIC_API_KEY`


---


### Workflow 7: `send_email`
- **Input:** Lead object with drafted email fields
- **Steps:**
  1. Send Email 1 to `company_email` via Gmail API
     - From name: "Gideon Awotuyi"
     - From address: Gideon's Gmail address (stored in `.env` as `GMAIL_FROM_ADDRESS`)
     - Content-Type: text/plain
     - No bulk sending headers
     - No unsubscribe footer
  2. Wait 5 seconds
  3. If `email2_subject` and `email2_body` exist AND `decision_maker_email` exists:
     - Send Email 2 to `decision_maker_email` via Gmail API
     - Same sender settings
  4. Log result to Airtable:
     - `email_sent: true`
     - `sent_at: [ISO timestamp]`
     - `email_status: "sent"`
  5. If a send fails:
     - Do not retry immediately
     - Log `email_status: "failed"` with the error reason
     - Continue to the next lead
  6. Daily rate limit: maximum **30 emails per day** (both Email 1 and Email 2 count toward this)
     - Maximum 15 companies fully contacted per day (2 emails each = 30)
     - If limit is reached mid-run → stop sending
     - Log remaining drafted leads as `email_status: "queued"`
     - Next day's scheduler run picks up queued leads BEFORE discovering new ones
- **Output:** Airtable updated. Telegram daily summary sent to Gideon.
- **Environment variables required:** `GMAIL_FROM_ADDRESS`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`


---


### Workflow 8: `scheduler` (daily pipeline orchestrator)
- **File:** `scheduler.js` at project root
- **Trigger:** node-cron, runs daily at `08:00 AM UTC`
- **Can also be triggered manually** via Telegram message: "Run outreach today"
- **Steps in exact order:**
  1. Check Airtable for any leads with `email_status: "queued"` from previous days
     - If queued leads exist → send their emails first (respecting 30/day cap)
  2. Load `targets.json` → get today's service category and city rotation
  3. Run `discover_leads` (existing `scrape_google_maps`) → get raw leads
  4. For each raw lead → run `enrich_leads`
  5. For each enriched lead → run `research_company`
  6. Skip any lead where `automation_opportunities` is empty
  7. For each qualified lead → run `draft_email`
  8. Run `send_email` for each drafted lead (stop if 30/day cap is reached)
  9. Save ALL leads to Airtable (including skipped ones, with reason logged)
  10. Send Gideon a Telegram summary message containing:
      - Total leads discovered
      - Total leads enriched successfully
      - Total leads skipped (reason: no email found / no opportunity found)
      - Total emails sent today
      - Top 3 companies contacted (name + city + service)
      - Remaining email quota for the day (30 minus sent)
- **Rule:** If any single lead fails at any step → log it and move to the next lead.
  The pipeline must never crash because of one bad lead.


---


## Phase 2 — New Tools

| Tool | Purpose | Cost |
|---|---|---|
| **Hunter.io API** | Find CEO / Founder / Hiring Manager emails by domain | Free tier: 25 searches/month. Paid when volume increases. |
| **Claude Haiku** | Research company and identify automation opportunities | Paid per token. Cheapest Claude model. |
| **Claude Sonnet** | Draft personalized cold emails | Paid per token. Used sparingly (email drafting only). |
| **Gmail API** | Send emails as Gideon via OAuth2 | Free up to 500 emails/day. We never exceed 30/day. |
| **node-cron** | Daily scheduler | Free. |
| **Puppeteer** | Scrape company websites for summary, emails, team info | Free. Already installed. |

All existing tools from Phase 1 remain unchanged.


---


## Phase 2 — Environment Variables

All secrets stored in `.env` locally and Railway environment variables in production.
No secret key is ever hardcoded in any script.

```
# Existing (Phase 1)
TELEGRAM_BOT_TOKEN=
ANTHROPIC_API_KEY=
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
AIRTABLE_TABLE_NAME=

# New (Phase 2)
HUNTER_API_KEY=
GMAIL_FROM_ADDRESS=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
```


---


## Phase 2 — Airtable Schema (Full — Phase 1 fields + Phase 2 fields)

The existing Airtable table is extended with new columns.
Phase 1 fields are untouched. New fields are added alongside them.

| Field Name | Type | Source | Notes |
|---|---|---|---|
| `name` | Text | Phase 1 | Company name from Google Maps |
| `service` | Text | Phase 1 | e.g. plumber, SaaS, hotel |
| `city` | Text | Phase 1 | City scraped from query |
| `address` | Text | Phase 1 | Full address from Google Maps |
| `website` | URL | Phase 1 | Company website URL |
| `rating` | Number | Phase 1 | Google Maps star rating |
| `date_created` | Date | Phase 1 | Date the lead was scraped |
| `status` | Text | Phase 1 | Default: "lead" |
| `company_email` | Email | Phase 2 | General contact email from website |
| `company_summary` | Long Text | Phase 2 | What the company does (from website) |
| `decision_maker_name` | Text | Phase 2 | CEO / Founder / Hiring Manager name |
| `decision_maker_title` | Text | Phase 2 | Their job title |
| `decision_maker_email` | Email | Phase 2 | Found via Hunter.io or website |
| `automation_opportunities` | Long Text | Phase 2 | Claude's analysis — what Gideon can build |
| `email1_subject` | Text | Phase 2 | Subject line for company email |
| `email1_body` | Long Text | Phase 2 | Body of company email |
| `email2_subject` | Text | Phase 2 | Subject line for decision-maker email |
| `email2_body` | Long Text | Phase 2 | Body of decision-maker email |
| `email_sent` | Checkbox | Phase 2 | True if at least one email was sent |
| `sent_at` | Date/Time | Phase 2 | Timestamp of when email was sent |
| `email_status` | Text | Phase 2 | One of: sent / failed / queued / skipped |
| `skip_reason` | Text | Phase 2 | Why the lead was skipped (if applicable) |


---


## Phase 2 — Asset Files

### `assets/gideon_profile.md`
This file is read by `draft_email.js` before every Claude call.
It must contain:
- Gideon's full name
- His role: AI Automation Engineer
- His core skills (n8n, Make.com, Claude API, Node.js, Airtable, Zapier, React, Docker, Railway, AWS)
- His LinkedIn URL
- His portfolio URL
- His tone and personality for emails (professional, warm, direct, not salesy)
- A short 2–3 sentence personal bio for context
- Note: Resume is available on request (do not attach automatically)

### `targets.json`
This file controls what the scheduler searches each day.
Structure:
```json
{
  "primary_countries": ["USA", "Canada", "UK", "Australia", "New Zealand", "Netherlands", "Germany"],
  "secondary_countries": ["Switzerland", "Sweden", "Israel", "Ukraine", "Russia"],
  "service_categories": [
    "SaaS startups",
    "eCommerce brands",
    "marketing agencies",
    "tech companies",
    "recruitment agencies",
    "real estate agencies",
    "law firms",
    "accounting firms",
    "healthcare clinics",
    "logistics companies"
  ],
  "leads_per_run": 15,
  "rotation": "sequential"
}
```
The scheduler rotates through cities and service categories sequentially.
No city or service category repeats until the full list has been cycled.


---


## Phase 2 — Outputs

1. **Emails delivered:** Up to 30 emails per day (plain text, from Gideon's Gmail)
2. **Airtable updated:** Every lead — scraped, enriched, researched, drafted, sent — is logged
3. **Telegram daily summary:** Sent to Gideon every morning after the scheduler finishes
4. **Telegram confirmations:** Sent when Gideon manually triggers outreach


---


## Phase 2 — Deployment

- Platform: Railway (same as Phase 1)
- Process: Always-on Node.js process (scheduler runs inside it via node-cron)
- All Phase 2 secrets added to Railway environment variables
- Health check: existing dummy HTTP server handles Railway's health check ping
- No changes needed to Railway setup — Phase 2 runs inside the existing deployed app


---


## Phase 2 — Definition of Done

The system is complete when all of the following are true:

1. Scheduler runs at 08:00 AM UTC every day without any manual action from Gideon
2. At least 10 companies are fully researched per daily run
3. At least 10 personalized email pairs are drafted per daily run
4. Emails land in recipient inboxes (not spam) — confirmed via a real test send
5. Every lead (successful or skipped) is logged in Airtable with correct status
6. Gideon receives a Telegram summary every morning detailing what happened
7. No secret keys are hardcoded anywhere in the codebase
8. A single lead failure never crashes the pipeline — it is logged and skipped
9. Queued leads from previous days are always sent before new leads are processed
10. Both emails per company are meaningfully different from each other and feel personal


---