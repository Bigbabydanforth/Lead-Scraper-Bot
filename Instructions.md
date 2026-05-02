# Agent Operating Guide


These instructions help turn human prompts into reliable, repeatable systems.


AI can guess. 
This system is designed to behave.


---


# How This Project Works


There are two important files:


- `instructions.md` → Defines how the system should behave.
- `project_specs.md` → Defines what we are building.


The agent must follow both.


---


# Step 1: Define the Project First


Before writing any code, you must:


1. Create a file called `project_specs.md`
2. Clearly define:
  - What the user can send as input
  - What workflows exist
  - What tools are being used (Telegram, Airtable, Railway, etc.)
  - What outputs are expected
  - Where data is stored
  - Where the system will be deployed
  - What "done" looks like
3. Show the file
4. Wait for approval


No code should be written before this file is approved.


---


# How the Agent Is Structured


The system has three layers:


## How this works (simple)


- **Instructions** = what we want to happen (in `instructions/`)
- **Decision** = pick the right workflow based on the message
- **Actions** = the real work (Javascript scripts in `execution/`)


The agent can plan, but it must execute by running the scripts in `execution/`.
No one-off code.


---


# File Structure


- `instructions/` → Workflow descriptions (markdown files)
- `execution/` → Javascript scripts
- `.tmp/` → Temporary files (safe to delete)
- `.env` → Secret keys and API tokens
- `project_specs.md` → Full project definition


Test data can be saved in `.tmp/` as CSV files.
Live data should be saved to Airtable or Google Sheets.


---


# Development Rules


## Rule 1: Always Read First
Always read:
- `instructions.md`
- `project_specs.md`


Before taking action.


---


## Rule 2: Javascript Only
All scripts must be written in javaScript.


---


## Rule 3: Every Workflow Has Two Files
Each workflow must include:
- A markdown file in `instructions/`
- A matching Javascript file in `execution/`


Do not run code unless both exist.


---


## Rule 4: Build in Small Pieces


Never build everything at once.


Instead:


1. Build one small part
2. Test it locally
3. Confirm it works
4. Then move to the next piece
5. Only connect parts after both work independently


---


## Rule 5: Deployment Checklist (Railway)


Before deploying:

1. Test locally
2. Make sure all secret keys are in `.env`
3. Show the deployment command
4. Wait for approval
5. Deploy
6. Test the live version
7. Confirm it works end-to-end


---


# When Something Breaks


1. Fix the issue
2. Improve the script so it doesn't fail the same way again
3. Test again
4. Update instructions if needed


Errors are feedback.


Each fix should make the system stronger.


---


# Response Format


When replying, always use:


- **Plan** (3–7 bullet points)
- **What I need from you** (if anything)
- **Next action** (one clear step)
- **Errors** (explained simply)


---


# Core Principle


Define clearly. 
Build in small steps. 
Test before moving on. 


Reliable systems are built intentionally.


---
---


# PHASE 2 — Outbound AI Sales Engine
## Added to extend the Lead Scraper Bot into an autonomous cold outreach system.
## All original rules above still apply. These rules are additive only.


---


## What Phase 2 Does


Phase 2 transforms the scraper into a full outbound sales pipeline.
Every day, automatically, the system will:


1. Discover businesses on Google Maps across target cities and countries
2. Scrape each company's website to understand what they do
3. Find two email addresses per company — the general company email AND a decision-maker (CEO, Founder, Co-Founder, or Hiring Manager)
4. Use Claude to research the company and identify exactly how Gideon's skills can help them
5. Draft two separate personalized cold emails — one to the company, one to the decision-maker
6. Send both emails via Gmail API as Gideon
7. Log everything to Airtable
8. Send Gideon a Telegram summary of what was done


---


## Phase 2 File Structure (added to existing structure)


```
execution/
  ├── discover_leads.js         ← already exists (Google Maps scraper)
  ├── enrich_leads.js           ← NEW: scrape website, extract emails, find decision-maker
  ├── research_company.js       ← NEW: Claude reads company, finds automation opportunities
  ├── draft_email.js            ← NEW: Claude writes 2 personalized emails per company
  ├── send_email.js             ← NEW: Gmail API sends both emails, logs result
  ├── airtable_save_leads.js    ← already exists
  └── airtable_search_leads.js  ← already exists

instructions/
  ├── enrich_leads.md           ← NEW
  ├── research_company.md       ← NEW
  ├── draft_email.md            ← NEW
  └── send_email.md             ← NEW

scheduler.js                    ← NEW: daily cron that runs the full pipeline
assets/
  └── gideon_profile.md        ← NEW: Gideon's skills, LinkedIn, portfolio (used in email drafts)
```


---


## Phase 2 Workflows


### Workflow: enrich_leads
- Input: a single lead object with `name`, `website`, `address`, `service`, `city`
- What it does:
  1. Opens the company website using Puppeteer
  2. Reads the homepage, About page, Contact page, and Team page (if they exist)
  3. Extracts: `company_summary` (what the company does in plain text)
  4. Extracts: `company_email` (any email found — info@, contact@, hello@, etc.)
  5. Extracts: `decision_maker_name` and `decision_maker_title` from Team or About page
  6. Constructs `decision_maker_email` by:
     - First: calling Hunter.io Domain Search API with the company domain
     - Hunter.io returns a list of emails with job titles and confidence scores
     - Filter for: CEO, Founder, Co-Founder, Hiring Manager, Head of Operations (in that priority order)
     - Pick the highest confidence score match
     - Second (fallback, only if Hunter.io returns nothing): look for the email directly on the website page
  7. If no company_email AND no decision_maker_email is found → skip this lead entirely
  8. If only one email is found → proceed with what is available
- Output: enriched lead object with all fields filled


### Workflow: research_company
- Input: enriched lead (company_summary, service, city, website)
- What it does:
  1. Sends company details to Claude API
  2. Claude reads the summary and identifies specific automation pain points
  3. Claude maps those pain points to Gideon's exact skills:
     - n8n, Make.com, Zapier → workflow automation
     - Claude API, OpenAI → AI integrations
     - Node.js, JavaScript → custom backend automation
     - Airtable, Google Sheets → data pipeline automation
     - Telegram bots → internal tool automation
     - React → frontend dashboards
     - Docker, Railway, AWS EC2 → deployment automation
  4. Output is a short list: `automation_opportunities[]`
     - Each item is one specific, actionable thing Gideon could build for them
  5. Claude must NOT hallucinate. If no clear opportunity exists, return an empty array.
     If array is empty → skip drafting email for this lead.
- Output: `automation_opportunities[]` added to lead object
- Model: Claude Haiku (cost-efficient for research pass)


### Workflow: draft_email
- Input: enriched + researched lead (all fields including automation_opportunities)
- What it does:
  1. Reads `gideon_profile.md` from `assets/` for tone, skills, links
  2. Sends everything to Claude API
  3. Claude drafts TWO emails:
     - Email 1 → to `company_email` (general contact)
       - Addresses the company as a whole
       - Mentions a specific pain point found during research
       - Explains how Gideon can solve it
       - References company name, city, and what they do
       - Includes LinkedIn and portfolio links
       - Friendly, professional, not salesy
       - Plain text only (no HTML — plain text lands in inbox, not spam)
       - Subject line must not contain spam trigger words
       - Maximum 180 words in body
     - Email 2 → to `decision_maker_email` (CEO / Founder / Hiring Manager)
       - Addresses the person by first name
       - More direct and personal tone
       - Mentions their role and company by name
       - Same pain point, but framed as a leadership problem they personally face
       - Same link inclusions
       - Maximum 180 words in body
  4. If only one email address is available → draft only one email
  5. Both emails must feel handwritten, not automated
- Output: `email1_subject`, `email1_body`, `email2_subject`, `email2_body` added to lead object
- Model: Claude Sonnet (higher quality for final email output)


### Workflow: send_email
- Input: lead with all email fields filled
- What it does:
  1. Sends `email1` to `company_email` via Gmail API
  2. Waits 5 seconds
  3. Sends `email2` to `decision_maker_email` via Gmail API (if it exists)
  4. Logs: `email_sent: true`, `sent_at: timestamp`, `email_status: sent` to Airtable
  5. If send fails → logs `email_status: failed`, does not retry immediately
  6. Rate limit: maximum 30 emails per day total (across all leads)
    - Each company = up to 2 emails → maximum 15 companies per day
  7. If daily limit is reached → stop sending, log remaining leads as `email_status: queued`
- Output: Airtable updated. Telegram notified.
- Gmail must send as Gideon's real name: "Gideon Awotuyi"
- No bulk sending headers. No unsubscribe footers. Plain text only.


### Workflow: scheduler (daily pipeline)
- This is not a Telegram workflow. It runs on a cron schedule.
- Runs every day at 08:00 AM UTC
- Steps in order:
  1. Load today's target list: service categories + cities from `targets.json`
  2. Run `discover_leads` → get raw leads
  3. For each lead → run `enrich_leads`
  4. For each enriched lead → run `research_company`
  5. Skip leads with empty `automation_opportunities`
  6. For each qualified lead → run `draft_email`
  7. Run `send_email` for each drafted lead (respecting 30/day cap)
  8. Save all leads (sent or not) to Airtable
  9. Send Gideon a Telegram summary:
     - How many leads discovered
     - How many enriched successfully
     - How many emails sent
     - How many skipped (no email or no opportunity found)
     - Top 3 companies contacted today (name + city)
- File: `scheduler.js` at root level
- Triggered by: node-cron inside Railway (always-on process)
- Can also be manually triggered via Telegram: "Run outreach today"


---


## Phase 2 Development Rules


### Rule 6: Never Hallucinate Company Data
Claude must only use data that was actually scraped from the company website.
If a field is missing, it stays empty. It is never invented.
An email sent with wrong information destroys trust and reputation.


### Rule 7: Plain Text Emails Only
All emails sent via Gmail must be plain text.
No HTML. No images. No fancy formatting.
Plain text emails have the highest inbox delivery rate.
Plain text emails feel personal.


### Rule 8: Respect Daily Email Limits
Maximum 30 emails per day. This is hardcoded.
Exceeding this risks Gmail flagging the account as spam.
If the limit is hit, log remaining leads as `email_status: queued`.
Next day's run will pick up queued leads first before discovering new ones.


### Rule 9: Cost Efficiency
- Use Claude Haiku for: `research_company` (bulk pass, many companies)
- Use Claude Sonnet for: `draft_email` (quality matters, fewer calls)
- Puppeteer is free. Use it aggressively.
- Gmail API is free up to 500 emails/day. Never exceed 30/day.
- Airtable free tier = 1,000 records. When full, create a new table. Never pay.
- Hunter.io is approved and is the PRIMARY method for finding decision-maker emails.
  - Store the Hunter.io API key in `.env` as `HUNTER_API_KEY`
  - Use the Domain Search endpoint: `https://api.hunter.io/v2/domain-search`
  - When Hunter.io free tier is exhausted, switch to Puppeteer website scraping as fallback.
  - Do NOT switch to pattern guessing without Gideon's approval.
- No other paid APIs unless explicitly approved by Gideon.


### Rule 10: Two Emails Per Company, Not One
Every company gets:
- `company_email` → general outreach
- `decision_maker_email` → personal outreach to CEO / Founder / Hiring Manager


Both are drafted separately by Claude. Both are sent separately.
They must not be identical. They must not feel like the same message.


### Rule 11: Gideon's Profile Must Be Loaded Before Drafting
Before calling Claude for `draft_email`, always read `assets/gideon_profile.md`.
This file contains Gideon's tone, skills, LinkedIn, portfolio link.
Claude must use this file as the sender's identity. No assumptions.


### Rule 12: Skip, Never Crash
If any step in the pipeline fails for a single lead:
- Log the failure with the lead name and reason
- Skip that lead
- Continue to the next lead
The pipeline must never crash because of one bad lead.


---


## Phase 2 Target Configuration


Target regions and service types are stored in `targets.json` at root level.
This file is editable without touching code.


Primary countries: USA, Canada, UK, Australia, New Zealand, Netherlands, Germany, UAE, Ireland, Singapore
Secondary countries: Switzerland, Sweden, Israel, Denmark, Norway, Portugal, Poland, Estonia


Service categories to search (starting list — editable):
- SaaS startups
- eCommerce brands
- Marketing agencies
- Tech companies
- Recruitment agencies
- Real estate agencies
- Law firms
- Accounting firms
- Healthcare clinics
- Logistics companies


The scheduler rotates through cities and services daily.
No city or service should repeat until the full list has been cycled.


---


## Phase 2 Definition of Done


The system is complete when:


1. Scheduler runs at 08:00 UTC every day without manual intervention
2. At least 10 companies are researched per day
3. At least 10 personalized email pairs are drafted per day
4. Emails are delivered to inbox (not spam) as confirmed by a test send
5. All leads and email statuses are logged in Airtable
6. Gideon receives a Telegram summary every morning
7. No hardcoded API keys anywhere in the codebase
8. The system recovers gracefully from any single lead failure


---