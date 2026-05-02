# Workflow: send_email

## Purpose
Sends two cold outreach emails per company via Gmail API using OAuth2.
Logs the result to Airtable after each send.

## Input
Lead object with: email1_subject, email1_body, email2_subject, email2_body,
company_email, decision_maker_email

## Daily Rate Limit
Maximum 30 emails per day (both Email 1 and Email 2 count toward this limit).
Maximum 15 companies can be fully contacted per day (15 x 2 = 30 emails).
This limit is tracked in a file at .tmp/daily_email_count.json.
The count resets to 0 each day at midnight UTC.

## Steps
1. Read current daily email count from .tmp/daily_email_count.json
   If the file does not exist: create it with count: 0 and date: today
   If the date in the file is not today: reset count to 0 and update date
2. If daily count is already 30 or more:
   log "[send_email] Daily limit reached. Skipping ${lead.name}"
   update lead's Airtable record: email_status = "queued"
   return { sent: false, reason: "daily_limit_reached" }
3. Send Email 1 to company_email (if email1_subject and email1_body exist):
   - From: "Gideon Awotuyi" <GMAIL_FROM_ADDRESS>
   - Content-Type: text/plain
   - No CC, no BCC, no reply-to header
4. Increment daily count by 1 and save to .tmp/daily_email_count.json
5. Wait 5 seconds (to avoid being flagged as automated)
6. If daily count is still below 30 AND decision_maker_email exists
   AND email2_subject and email2_body exist:
   - Send Email 2 to decision_maker_email
   - Increment daily count by 1 again
7. If both sends succeed:
   - email_sent = true
   - sent_at = current ISO timestamp
   - email_status = "sent"
8. If any send fails:
   - Log the error
   - email_status = "failed"
   - Do not retry
9. Save the updated email_sent, sent_at, and email_status to the lead's Airtable record

## Error Handling
- Never crash the pipeline because of a failed email send
- Always log success or failure with the company name
- Always update Airtable regardless of outcome

## Environment Variables Required
- GMAIL_FROM_ADDRESS
- GMAIL_CLIENT_ID
- GMAIL_CLIENT_SECRET
- GMAIL_REFRESH_TOKEN
- AIRTABLE_API_KEY
- AIRTABLE_BASE_ID
- AIRTABLE_TABLE_NAME
