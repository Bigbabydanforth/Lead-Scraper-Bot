require('dotenv').config();
const { Anthropic } = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function draftEmail(lead) {
    try {
        // Read governance files first (system architecture rule)
        fs.readFileSync(path.join(__dirname, '../Instructions.md'), 'utf8');
        fs.readFileSync(path.join(__dirname, '../project_specs.md'), 'utf8');

        const oppsArray = Array.isArray(lead.automation_opportunities)
            ? lead.automation_opportunities
            : (lead.automation_opportunities || '').split('\n').filter(Boolean);
        if (oppsArray.length === 0) {
            console.log(`[draft_email] Skipping ${lead.name} — no automation opportunities`);
            return null;
        }

        const gideonProfile = fs.readFileSync(path.join(__dirname, '../assets/gideon_profile.md'), 'utf8');

        const dmName = lead.decision_maker_name || "not found";
        const dmTitle = lead.decision_maker_title || "not found";
        const opsJoined = Array.isArray(lead.automation_opportunities)
            ? lead.automation_opportunities.join(", ")
            : lead.automation_opportunities;

        const prompt = `You are writing cold outreach emails on behalf of Gideon Awotuyi, an AI Automation Engineer looking for his first client.

STEP 1 - READ THE COMPANY DETAILS:
Company Name: ${lead.name}
City: ${lead.city}
Industry: ${lead.service}
Website: ${lead.website}
What They Do: ${lead.company_summary}
Automation Opportunities: ${opsJoined}
Decision Maker Name: ${dmName}
Decision Maker Title: ${dmTitle}

STEP 2 - READ GIDEON'S PROFILE AND PICK THE MOST RELEVANT PROJECT:
${gideonProfile}

STEP 3 - WRITE TWO EMAILS FOLLOWING THIS EXACT FORMAT:

EMAIL 1 is sent to the company inbox. It must:
- Open with: "Hi ${lead.name} team,"
- Sentence 1: mention the company name, city, and what they do in one line
- Sentences 2-3: name ONE specific automation opportunity from the list and explain the problem it solves in plain human language (no jargon)
- Sentences 4-5: mention ONE project Gideon actually built that is similar, and include a real measurable result (e.g. "cut manual workload by 40%")
- Final paragraph: invite a low-pressure conversation and include Gideon's LinkedIn and portfolio link from his profile
- Second-to-last line must be exactly: "If you'd rather not hear from me, just reply with 'unsubscribe'."
- Sign off with: "Best," or "Talk soon,"
- Tone: warm, direct, peer-to-peer. NOT salesy. NOT corporate.
- Length: 150-180 words maximum

EMAIL 2 is sent directly to the decision maker:
${dmName !== "not found" ? `- Open with: "Hi ${dmName.split(' ')[0]},"
- Acknowledge their role (${dmTitle}) and the company
- Reframe the SAME automation opportunity as a PERSONAL problem they face as a leader, not a company problem
- Reference ONE different project or result from Gideon's profile (NOT the same one used in Email 1)
- Same tone: direct, peer-to-peer, not salesy
- Second-to-last line must be exactly: "If you'd rather not hear from me, just reply with 'unsubscribe'."
- Sign off with: "Best," or "Talk soon,"
- Length: 150-180 words maximum` : `- SKIP this email. Set email2_subject to null and email2_body to null.`}

ABSOLUTE RULES - NEVER BREAK THESE:
1. Plain text only. Zero HTML, zero bullet points, zero markdown, zero bold.
2. Never write "I hope this email finds you well" or any variation.
3. Never use: synergy, leverage (as verb), touch base, circle back, bandwidth, scalable solution, game-changer, revolutionize.
4. Never mention AI wrote this email.
5. Never reference course names, video timestamps, or training modules. Only reference real projects Gideon built.
6. Subject lines must NOT contain: free, guaranteed, opportunity, make money, click here, limited time, exclusive, urgent, act now.
7. Subject lines and bodies must use plain ASCII only. No em dashes (use -), no smart quotes (use '), no ellipsis character (use ...).
8. Email 1 and Email 2 must be completely different - different opening, different project reference, different angle.
9. Maximum 180 words per email body.

HERE IS A CONCRETE EXAMPLE OF WHAT A GOOD EMAIL PAIR LOOKS LIKE:

Example Email 1 subject: Automating client onboarding for Acme Staffing - quick idea

Example Email 1 body:
Hi Acme Staffing team,

I came across your agency in Austin - you're doing solid work connecting companies with great talent, and from what I can tell, your client onboarding process probably involves a lot of manual back-and-forth.

I recently built an automated onboarding workflow for a similar agency using n8n and Claude API that cut their admin team's workload by 40%. Every new client now gets a tailored intake form, automatic follow-up emails, and real-time status updates without anyone on the team touching it manually.

I think something like this could save your team real hours every week. Happy to walk you through it in 20 minutes if you're curious.

Portfolio: gideon.dev | LinkedIn: linkedin.com/in/gideonawotuyi

If you'd rather not hear from me, just reply with 'unsubscribe'.

Best,
Gideon

---

Example Email 2 subject: A thought on your team's onboarding workload

Example Email 2 body:
Hi Sarah,

As Head of Operations at Acme Staffing, you're probably the one who feels it most when client onboarding goes sideways - missed follow-ups, documents stuck in email threads, the team asking "where are we with this client?"

I built an end-to-end intake automation for a hiring firm last year. Their new clients go from first contact to fully onboarded with zero manual steps on the team's side. The operations lead told me it freed up 15 hours a week for her team.

I'm not pitching a product. Just offering a practical conversation about whether something similar would help your team at Acme.

Portfolio: gideon.dev | LinkedIn: linkedin.com/in/gideonawotuyi

If you'd rather not hear from me, just reply with 'unsubscribe'.

Talk soon,
Gideon

---

Now write the actual emails for ${lead.name} following this exact pattern. Replace the example links with the actual LinkedIn and portfolio links from Gideon's profile.

Respond with ONLY a valid JSON object. No explanation. No markdown. No preamble.
{
  "email1_subject": "subject line here",
  "email1_body": "full email body here",
  "email2_subject": "subject line here or null",
  "email2_body": "full email body here or null"
}`;

        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
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
