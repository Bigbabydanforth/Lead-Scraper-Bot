require('dotenv').config();
const { Anthropic } = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function draftEmail(lead) {
    try {
        const oppsArray = Array.isArray(lead.automation_opportunities)
            ? lead.automation_opportunities
            : (lead.automation_opportunities || '').split('\n').filter(Boolean);
        if (oppsArray.length === 0) {
            console.log(`[draft_email] Skipping ${lead.name} — no automation opportunities`);
            return null;
        }

        let gideonProfile;
        try {
            gideonProfile = fs.readFileSync(path.join(__dirname, '../assets/gideon_profile.md'), 'utf8');
        } catch (fileErr) {
            console.error(`[draft_email] FATAL: Cannot read gideon_profile.md — ${fileErr.message}`);
            return null;
        }

        const dmName = lead.decision_maker_name || "not found";
        const dmTitle = lead.decision_maker_title || "not found";
        const opsJoined = Array.isArray(lead.automation_opportunities)
            ? lead.automation_opportunities.join(", ")
            : lead.automation_opportunities;

        const prompt = `You are writing cold outreach emails on behalf of Gideon Awotuyi, a freelance AI Automation Engineer building his client base.

STEP 1 - READ THE COMPANY DETAILS:
Company Name: ${lead.name}
City: ${lead.city}
Industry: ${lead.service}
Website: ${lead.website}
What They Do: ${lead.company_summary}
Automation Opportunities: ${opsJoined}
Decision Maker Name: ${dmName}
Decision Maker Title: ${dmTitle}

STEP 2 - READ GIDEON'S PROFILE FOR CONTEXT:
${gideonProfile}

STEP 3 - WRITE TWO EMAILS USING THE WINNING FORMAT BELOW.

THE WINNING EMAIL STRUCTURE (this exact format got a real CEO to reply and book a meeting the same day):

Paragraph 1 - PAIN FIRST: Open by naming a specific, real operational pain this type of person faces in their role. Make it feel like you read their mind. No compliments. No "I came across you." Just the pain, stated plainly.

Paragraph 2 - WHO I AM: "My name is Gideon. I'm a freelance AI Automation Engineer and I work with [describe their type of company or role] to remove exactly that kind of friction."

Paragraph 3 - THE PROPOSAL: Start with "For [Company Name], I'd build [very specific thing]." Then write 2-3 short punchy sentences. Each sentence = one concrete outcome. Write outcomes, not features. Make the reader picture their life after the thing is built.

Paragraph 4 - REASSURANCE: "It connects directly to whatever tools your team already uses, so nothing changes about how you work - it just removes the manual steps that slow things down."

Closing: One soft CTA line. Then LinkedIn and portfolio on one line. Then the unsubscribe line. Then sign-off.

---

EMAIL 1 goes to the company general inbox:
- Salutation: "Hi ${lead.name} team,"
- Use the winning structure above, addressed to the whole team
- Pick ONE automation opportunity from the list that has the most visible day-to-day impact on the team
- Tone: warm, direct, peer-to-peer. Sounds like a real person. NOT a pitch. NOT corporate.
- Length: 130-160 words. Every word must earn its place.

EMAIL 2 goes directly to the decision maker (${dmName !== "not found" ? dmName : "N/A"}):
${dmName !== "not found" ? `- Salutation: "Hi ${dmName.split(' ')[0]},"
- Use the winning structure above, but frame it as THEIR personal leadership pain, not a company problem
- Pick a DIFFERENT automation opportunity from the list than Email 1
- Reference a different project or result from Gideon's profile than Email 1
- Tone: peer-to-peer. One professional talking to another.
- Length: 130-160 words. Tighter and more personal than Email 1.` : `- SKIP. Set email2_subject to null and email2_body to null.`}

ABSOLUTE RULES - NEVER BREAK THESE:
1. Plain text only. Zero HTML, zero bullet points, zero markdown, zero bold.
2. Never write "I hope this email finds you well" or any variation of it.
3. Never use: synergy, leverage (as verb), touch base, circle back, bandwidth, scalable solution, game-changer.
4. Never mention AI wrote this email.
5. Never reference course names, video timestamps, or training modules from the profile. Real projects only.
6. Subject lines must NOT contain: free, guaranteed, opportunity, make money, click here, limited time, exclusive, urgent, act now.
7. Subject lines and bodies: plain ASCII only. No em dashes (use -), no smart quotes (use '), no ellipsis character (use ...).
8. The second-to-last line before the sign-off must be exactly: "If you'd rather not hear from me, just reply with 'unsubscribe'."
9. Sign off with "Best," or "Talk soon," then "Gideon" on the next line.
10. Email 1 and Email 2 must use different opportunities, different angles, different project references.
11. Maximum 160 words per email body.

HERE IS THE ACTUAL WINNING EMAIL THAT GOT A REAL CEO TO REPLY AND BOOK A MEETING. MATCH THIS STRUCTURE AND VOICE EXACTLY:

Subject: Quick idea for Starfish

Hi David,

As CEO of a full-service branding agency in New York, you're probably very aware of how much time gets lost before a project even kicks off - collecting briefs, following up on intake details, manually getting information into the right places.

My name is Gideon. I'm a freelance AI Automation Engineer and I work with agency founders to remove exactly that kind of friction.

For Starfish, I'd build a Claude API-powered chatbot for your website that qualifies incoming leads and gathers brand discovery information before you ever get on a call. Your team shows up prepared. Prospects feel heard. And the back-and-forth before kickoff drops significantly.

It connects directly to whatever tools your team already uses, so nothing changes about how you work - it just removes the manual steps that slow things down.

Worth a 20-minute call to see if it fits?

LinkedIn: linkedin.com/in/gideon-awotuyi-84518b310 | Portfolio: bit.ly/Gideon-Awotuyi

If you'd rather not hear from me, just reply with 'unsubscribe'.

Talk soon,
Gideon

---

Now write the actual emails for ${lead.name} using this exact structure and voice. Use the real LinkedIn and portfolio links from Gideon's profile.

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
