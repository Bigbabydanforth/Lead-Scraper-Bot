require('dotenv').config();
const { Anthropic } = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function researchCompany(lead) {
    try {
        if (!lead.company_summary || lead.company_summary.length < 50) {
            console.log(`[research_company] Skipping ${lead.name} — insufficient summary`);
            return [];
        }

        const profilePath = path.join(__dirname, '../assets/gideon_profile.md');
        let gideonProfile;
        try {
            gideonProfile = fs.readFileSync(profilePath, 'utf8');
        } catch (fileErr) {
            console.error(`[research_company] FATAL: Cannot read gideon_profile.md — ${fileErr.message}`);
            return [];
        }

        const prompt = `You are analyzing a company to help an AI Automation Engineer identify business opportunities.

Company Name: ${lead.name}
City: ${lead.city}
Service/Industry: ${lead.service}
Website: ${lead.website}
Company Summary: ${lead.company_summary}

The engineer's skills are:
${gideonProfile}

Based ONLY on the company summary above, identify 2 to 4 specific automation
opportunities where this engineer's skills could help this company.
Each opportunity must be concrete and actionable — for example:
"Build an n8n workflow to automate their client onboarding process"
"Create a Claude API chatbot to handle first-response customer support"

If you cannot identify any real opportunities from the summary provided, return an empty array.
Do not invent or assume details not present in the summary.

Respond with ONLY a valid JSON array of strings. No explanation. No markdown. No preamble.
Example: ["Automate their lead intake with n8n", "Build an AI email responder using Claude API"]`;

        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            messages: [{ role: 'user', content: prompt }]
        });

        let respText = response.content[0].text.trim();
        // Fallback for markdown blocks if Claude includes them despite instructions
        if (respText.startsWith('\`\`\`json')) {
            respText = respText.replace(/^\`\`\`json\n?/, '').replace(/\n?\`\`\`$/, '');
        } else if (respText.startsWith('\`\`\`')) {
            respText = respText.replace(/^\`\`\`\n?/, '').replace(/\n?\`\`\`$/, '');
        }

        const opportunities = JSON.parse(respText);
        
        if (!Array.isArray(opportunities)) {
             console.error(`[research_company] Error: Expected a JSON array, got something else.`);
             return [];
        }

        console.log(`[research_company] Found ${opportunities.length} opportunities for ${lead.name}`);
        return opportunities;

    } catch (error) {
        console.error(`[research_company] Error researching company ${lead.name}:`, error.message);
        return [];
    }
}

module.exports = { researchCompany };
