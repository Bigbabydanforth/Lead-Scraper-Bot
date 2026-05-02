# Workflow: research_company

## Purpose
Reads enriched company data and uses Claude to identify specific automation opportunities
that match Gideon's skill set. Output is used to personalize cold emails.

## Input
Enriched lead object containing: name, service, city, website, company_summary

## Steps
1. Read the enriched lead object
2. Build a prompt for Claude that includes:
   - The company name, city, service category, and company_summary
   - Gideon's full skill list (read from assets/gideon_profile.md)
   - Instruction to identify 2–4 specific automation opportunities
3. Send the prompt to Claude API using model: claude-haiku-4-5-20251001
4. Parse the response as a JSON array of strings
5. Each string in the array must be one specific, actionable thing Gideon could build
6. If Claude returns an empty array or cannot identify a real opportunity: return []
7. If the array is empty after parsing: mark this lead as skipped with reason "no_opportunity"

## Output
automation_opportunities: string[] (array of 2–4 specific opportunity descriptions)
Returns [] if no opportunities are found.

## Rules
- Claude must only use information from company_summary. No hallucination.
- Opportunities must reference Gideon's actual skills (n8n, Claude API, Node.js, etc.)
- If company_summary is null or fewer than 50 characters: return [] immediately
  without calling Claude. Log: [research_company] Skipping — insufficient summary.

## Claude Model
claude-haiku-4-5-20251001

## Environment Variables Required
- ANTHROPIC_API_KEY
