require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { updateLeadStatus } = require('./airtable_save_leads');

const LIMIT_FILE = path.join(__dirname, '../.tmp/daily_email_count.json');
const MAX_EMAILS_PER_DAY = 30;

function getDailyCount() {
    const today = new Date().toISOString().split('T')[0];
    if (fs.existsSync(LIMIT_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(LIMIT_FILE, 'utf8'));
            if (data.date === today) return data;
        } catch (_) {}
    }
    return { date: today, count: 0 };
}

function saveDailyCount(data) {
    const tmpDir = path.dirname(LIMIT_FILE);
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }
    fs.writeFileSync(LIMIT_FILE, JSON.stringify(data, null, 2));
}

function createGmailClient() {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    return google.gmail({ version: 'v1', auth: oauth2Client });
}

function sanitizeText(text) {
    return text
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\u2026/g, '...')
        .replace(/[^\x00-\x7F]/g, '')
        .trim();
}

function makeMessage(to, subject, body) {
    const from = `"Gideon Awotuyi" <${process.env.GMAIL_FROM_ADDRESS}>`;
    const str = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${sanitizeText(subject)}`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        `${sanitizeText(body)}`
    ].join('\r\n');

    return Buffer.from(str).toString('base64url');
}

async function sendEmails(lead, airtableRecordId) {
    try {
        let dailyData = getDailyCount();

        if (dailyData.count >= MAX_EMAILS_PER_DAY) {
            console.log(`[send_email] Daily limit reached. Skipping ${lead.name}`);
            if (airtableRecordId) {
                await updateLeadStatus(airtableRecordId, {
                    email_status: "queued"
                });
            }
            return { sent: false, reason: "daily_limit_reached" };
        }

        const gmail = createGmailClient();
        let sentCount = 0;
        let anyFailed = false;
        let email1SentThisRun = false;
        let finalStatus = lead.email_status || "queued";

        // Send Email 1
        if (finalStatus !== 'email1_sent' && lead.email1_subject && lead.email1_body && lead.company_email) {
            console.log(`[send_email] Sending to ${lead.company_email}`);
            try {
                const raw = makeMessage(lead.company_email, lead.email1_subject, lead.email1_body);
                await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
                console.log(`[send_email] Success for ${lead.company_email}`);
                sentCount++;
                dailyData.count++;
                saveDailyCount(dailyData);
                finalStatus = "email1_sent";
                email1SentThisRun = true;
            } catch (err) {
                console.log(`[send_email] Failed: ${err.message}`);
                anyFailed = true;
                finalStatus = "failed";
            }
        } else if (finalStatus === 'email1_sent') {
             console.log(`[send_email] Email 1 already sent previously, skipping to Email 2`);
        }

        if (dailyData.count < MAX_EMAILS_PER_DAY && !anyFailed) {
            await new Promise(r => setTimeout(r, 5000));
        }

        // Send Email 2
        if (dailyData.count >= MAX_EMAILS_PER_DAY && finalStatus === "email1_sent") {
             console.log(`[send_email] Daily limit reached before Email 2. Pausing ${lead.name}`);
             // finalStatus remains "email1_sent"
        } else if (dailyData.count < MAX_EMAILS_PER_DAY && lead.decision_maker_email && lead.email2_subject && lead.email2_body) {
            console.log(`[send_email] Sending to ${lead.decision_maker_email}`);
            try {
                const raw = makeMessage(lead.decision_maker_email, lead.email2_subject, lead.email2_body);
                await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
                console.log(`[send_email] Success for ${lead.decision_maker_email}`);
                sentCount++;
                dailyData.count++;
                saveDailyCount(dailyData);
                finalStatus = "sent";
            } catch (err) {
                console.log(`[send_email] Failed: ${err.message}`);
                anyFailed = true;
                // If email1 was sent this run, keep "email1_sent" so the retry loop resends email2 tomorrow.
                // If this is already a retry run (email1_sent from a previous day), mark failed to stop retrying.
                finalStatus = email1SentThisRun ? "email1_sent" : "failed";
            }
        } else if (!anyFailed && sentCount > 0) {
            // No email2 to send — at least one email went out, so we're fully done.
            finalStatus = "sent";
        }

        if (airtableRecordId) {
            await updateLeadStatus(airtableRecordId, {
                email_sent: sentCount > 0,
                sent_at: new Date().toISOString(),
                email_status: finalStatus
            });
        }

        return { sent: sentCount > 0, emails_sent_count: sentCount };

    } catch (e) {
        console.error(`[send_email] Critical error:`, e.message);
        if (airtableRecordId) {
            await updateLeadStatus(airtableRecordId, {
                email_status: "failed"
            });
        }
        return { sent: false, emails_sent_count: 0 };
    }
}

module.exports = { sendEmails };
