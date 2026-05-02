# Workflow: draft_email

## Purpose
Drafts two personalized cold emails for each company:
- Email 1: addressed to the company's general contact email
- Email 2: addressed to the decision-maker (CEO / Founder / Hiring Manager) personally

## Input
Fully enriched and researched lead object containing:
name, service, city, website, company_summary, company_email,
decision_maker_name, decision_maker_title, decision_maker_email,
automation_opportunities[]

## Pre-condition
- automation_opportunities must not be empty. If it is empty, return null immediately.
- Always read assets/gideon_profile.md before calling Claude.

## Email 1 — Company Email
- Recipient: company_email
- Salutation: "Hi [Company Name] team,"
- Content must reference: company name, city, what the company does,
  one specific automation opportunity from automation_opportunities[]
- Explain how Gideon can solve it in plain, simple terms
- Include Gideon's LinkedIn URL and portfolio URL from gideon_profile.md
- Tone: friendly, professional, warm. Not salesy. Not template-sounding.
- Format: plain text only. No HTML. No bullet points. No bold. No headers.
- Body length: 150–180 words maximum
- Subject line: specific to the company, references their name or industry
- Subject must NOT contain these words: free, guaranteed, opportunity,
  make money, click here, limited time, exclusive, urgent, act now

## Email 2 — Decision-Maker Email
- Recipient: decision_maker_email (only if it exists)
- Salutation: "Hi [FirstName]," using only the first name from decision_maker_name
- Content must reference: their first name, their job title, company name,
  the same automation opportunity — reframed as a personal leadership problem
  they face as the person running the business
- Include Gideon's LinkedIn URL and portfolio URL from gideon_profile.md
- Tone: direct, personal, peer-to-peer. More like one professional to another.
  Not like a vendor writing to a client.
- Format: plain text only. No HTML. No bullet points. No bold. No headers.
- Body length: 150–180 words maximum
- Subject line: different from Email 1. More personal. References their name or role.
- Same subject line rules apply (no spam trigger words)

## Rules
- Both emails must feel handwritten by a real person
- Both emails must be completely different from each other — not paraphrases
- Neither email may mention that it was written by AI
- Do not sign off with "Best regards" — use "Best," or "Talk soon," or similar
- Do not say "I hope this email finds you well"
- Do not use words: synergy, leverage, touch base, circle back, bandwidth, scalable solution
- If decision_maker_email is null: draft Email 1 only. Set email2_subject and email2_body to null.
- If company_email is null: draft Email 2 only. Set email1_subject and email1_body to null.

## Claude Model
claude-sonnet-4-6

## Output
Lead object updated with:
- email1_subject (string or null)
- email1_body (string or null)
- email2_subject (string or null)
- email2_body (string or null)

## Environment Variables Required
- ANTHROPIC_API_KEY
