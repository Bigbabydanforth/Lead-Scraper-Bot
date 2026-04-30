require('dotenv').config();
const { Anthropic } = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function draftEmail(lead) {
    try {
        // Read governance files first (system architecture rule)
        fs.readFileSync(path.join(__dirname, '../instructions.md'), 'utf8');
        fs.readFileSync(path.join(__dirname, '../project_specs.md'), 'utf8');

        if (!lead.automation_opportunities || lead.automation_opportunities.length === 0) {
            console.log(`[draft_email] Skipping ${lead.name} — no automation opportunities`);
            return null;
        }

        const gideonProfile = fs.readFileSync(path.join(__dirname, '../assets/gideon_profile.md'), 'utf8');

        const dmName = lead.decision_maker_name || "not found";
        const dmTitle = lead.decision_maker_title || "not found";
        const opsJoined = lead.automation_opportunities.join(", ");

        const prompt = `You are a professional copywriter helping an AI Automation Engineer send personalized cold outreach emails to potential clients.

CRITICAL INSTRUCTION: You have access to the engineer's comprehensive profile below. When drafting emails, you MUST:
- Reference specific PROJECTS the engineer has built that are relevant to this company
- Cite measurable RESULTS from their resume (40% reduction, 99% accuracy, etc.) when relevant
- Mention relevant TECHNICAL SKILLS that solve this company's specific problem
- NEVER reference course timestamps, syllabus metadata, or training module numbers
- Focus ONLY on what the engineer can DO and HAS DONE, not what they studied

Here is the company information:
Company Name: ${lead.name}
City: ${lead.city}
Industry: ${lead.service}
Website: ${lead.website}
What They Do: ${lead.company_summary}
Automation Opportunities Identified: ${opsJoined}

Decision Maker Name: ${dmName}
Decision Maker Title: ${dmTitle}

Here is the engineer's complete profile (use ONLY the relevant parts):
${gideonProfile}

TASK: Write two cold outreach emails as described below. Follow every rule exactly.

EMAIL 1 — To the company (company_email):
- Salutation: "Hi ${lead.name} team,"
- Reference the company name, city, what they do, and ONE specific automation opportunity from the list above
- Mention ONE relevant project from the profile that demonstrates similar work has been done before
- Explain how the problem can be solved in plain, simple terms
- Include ONE measurable result if relevant (e.g., "40% reduction in manual overhead" or "99% accuracy")
- 150-180 words. Plain text only.
- Include LinkedIn and portfolio from the profile
- Friendly, professional, warm tone

EMAIL 2 — To the decision maker personally (decision_maker_email):
${dmName !== "not found" ? `- Salutation: "Hi ${dmName.split(' ')[0]}," (first name only)
- Reference their name, title, and company. Reframe the same opportunity as a personal leadership problem they face
- Mention ONE relevant project or skill from the profile
- Include ONE measurable result if relevant
- 150-180 words. Plain text only.
- Include LinkedIn and portfolio from the profile
- Direct, peer-to-peer tone` : `- SKIP — no decision maker found. Set email2_subject and email2_body to null.`}

STRICT RULES FOR BOTH EMAILS:
1. Plain text only. No HTML, no bullet points, no markdown, no bold.
2. NEVER say "I hope this email finds you well"
3. NEVER use: synergy, leverage (as verb), touch base, circle back, bandwidth, scalable solution
4. DO NOT mention AI wrote this email
5. DO NOT reference course names, timestamps, or training module numbers from the profile
6. DO reference: specific projects (Sections 3 and 4 of profile), measurable results (Section 1), relevant skills
7. Subject lines must NOT contain: free, guaranteed, opportunity, make money, click here, limited time, exclusive, urgent, act now
8. Subject lines must use plain ASCII only — no em dashes, en dashes, smart quotes, or any special characters. Use a plain hyphen (-) if you need a dash.
9. Email body must use plain ASCII only — no em dashes, smart quotes, ellipsis characters, or any other special symbols. Use a plain hyphen (-) for dashes and ... for ellipsis.
10. On the line directly before the sign-off, add exactly: "If you'd rather not hear from me, just reply with 'unsubscribe'."
11. Sign off with "Best," or "Talk soon," — not "Best regards"
12. Both emails must be completely different from each other
13. Maximum 180 words per email body

EXAMPLE OF GOOD PROJECT REFERENCE:
"I recently built a similar system for WeSki in Israel that reduced their customer success team's manual workload by 40%"
"I built a lead routing system for a previous client that cut qualification time by 90%"
"I architected an AI agent that processes 500+ transactions monthly at 99% accuracy"

EXAMPLE OF BAD REFERENCE — DO NOT DO THIS:
"I completed the n8n AI Agent Deep Dive course (5:04:50 total runtime)"
"I learned about iterators at timestamp 1:26:53"

Respond with ONLY a valid JSON object. No explanation. No markdown. No preamble.
Use this exact structure:
{
  "email1_subject": "subject line here",
  "email1_body": "full email body here",
  "email2_subject": "subject line here or null",
  "email2_body": "full email body here or null"
}`;

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 2000,
            messages: [{ role: 'user', content: prompt }]
        });

        let respText = response.content[0].text.trim();
        if (respText.startsWith('```json')) {
            respText = respText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        } else if (respText.startsWith('```')) {
            respText = respText.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }

        const parsedEmails = JSON.parse(respText);

        if (!lead.company_email) {
            parsedEmails.email1_subject = null;
            parsedEmails.email1_body = null;
        }

        if (dmName === "not found" || !lead.decision_maker_email) {
            parsedEmails.email2_subject = null;
            parsedEmails.email2_body = null;
        }

        const mergedLead = {
            ...lead,
            email1_subject: parsedEmails.email1_subject,
            email1_body: parsedEmails.email1_body,
            email2_subject: parsedEmails.email2_subject,
            email2_body: parsedEmails.email2_body
        };

        console.log(`[draft_email] Drafted emails for ${lead.name}`);
        return mergedLead;

    } catch (error) {
        console.error(`[draft_email] Error drafting email for ${lead.name}:`, error.message);
        return null;
    }
}

module.exports = { draftEmail };
