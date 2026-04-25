require('dotenv').config();
const { Telegraf } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

bot.start((ctx) => ctx.reply('Welcome! I am the Lead Scraper Bot. Send me a prompt like "Find 5 plumbers in Miami".'));

const { scrapeGoogleMaps } = require('./execution/scrape_google_maps');
const { saveLeadsToAirtable } = require('./execution/airtable_save_leads');
const { searchLeadsInAirtable } = require('./execution/airtable_search_leads');

bot.on('text', async (ctx) => {
    const userMessage = ctx.message.text;
    const msg = await ctx.reply("Thinking...");

    try {
        const prompt = `You are an AI assistant for a Lead Generation Bot named "LeadFinder".
Your personality is natural, professional, and helpful.
The user might just be chatting with you, or they might be asking you to perform a task.

The available tasks are:
1. "scrape": Scrape new leads from Google Maps and save them to Airtable.
2. "search": Search existing leads in Airtable.

User Message: "${userMessage}"

Analyze the message. If the user wants to perform a task, output ONLY a valid JSON object with the following structure:
{
  "workflow": "scrape" or "search",
  "arguments": {
     // If workflow is "scrape", include:
     "service": string (e.g. "plumbers"),
     "city": string (e.g. "Miami"),
     "count": number (Always default to 5 if the user does not specify a number)

     // If workflow is "search", include any of these that apply:
     "name": string (optional, e.g. "Onyx"),
     "service": string (optional),
     "city": string (optional),
     "minimum_rating": number (optional),
     "status": string (optional),
     "count": number (e.g. 5, default to 5)
  }
}

If the user is just chatting or asking a question that doesn't strictly match the tasks, output ONLY a valid JSON object with the following structure:
{
  "workflow": "chat",
  "response": "Your natural, professional response to the user."
}

Do not include markdown blocks like \`\`\`json or any other text outside the JSON object. Output ONLY the raw JSON.`;

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }]
        });

        let respText = response.content[0].text.trim();
        if (respText.startsWith('\`\`\`json')) {
            respText = respText.replace(/^\`\`\`json\n?/, '').replace(/\n?\`\`\`$/, '');
        }

        const plan = JSON.parse(respText);

        if (plan.workflow === 'scrape') {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
                `Gathering ${plan.arguments.count} ${plan.arguments.service} in ${plan.arguments.city}... This may take a minute.`);

            const leads = await scrapeGoogleMaps(plan.arguments.service, plan.arguments.city, plan.arguments.count);

            if (leads.length === 0) {
                await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, "I couldn't find any leads matching your criteria.");
                return;
            }

            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Found ${leads.length} leads. Saving to Airtable...`);
            await saveLeadsToAirtable(leads);

            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
                `✅ Successfully scraped ${leads.length} ${plan.arguments.service} and saved them to Airtable!\n\nHere are the full details:`);

            let messageChunk = "";
            for (let i = 0; i < leads.length; i++) {
                const l = leads[i];
                const leadText = `${i + 1}. ${l.name}\n⭐ Rating: ${l.rating || 'N/A'}\n📍 Address: ${l.address || 'N/A'}\n🌐 Website: ${l.website || 'N/A'}\n📧 Email: ${l.email || 'N/A'}\n\n`;

                if ((messageChunk.length + leadText.length) > 3500) {
                    await ctx.reply(messageChunk);
                    messageChunk = "";
                }
                messageChunk += leadText;
            }
            if (messageChunk.length > 0) {
                await ctx.reply(messageChunk);
            }
        }
        else if (plan.workflow === 'search') {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Searching Airtable for your leads...`);

            const results = await searchLeadsInAirtable(plan.arguments);

            if (results.length === 0) {
                await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, "No leads found matching your criteria in Airtable.");
                return;
            }

            let messageChunk = `Found ${results.length} leads in Airtable:\n\n`;
            for (let i = 0; i < results.length; i++) {
                const l = results[i];
                const leadText = `${i + 1}. ${l.name}\n⭐ Rating: ${l.rating || 'N/A'}\n📍 Address: ${l.address || 'N/A'}\n🌐 Website: ${l.website || 'N/A'}\n📧 Email: ${l.email || 'N/A'}\n\n`;

                if ((messageChunk.length + leadText.length) > 3500) {
                    await ctx.reply(messageChunk);
                    messageChunk = "";
                }
                messageChunk += leadText;
            }
            if (messageChunk.length > 0) {
                // If the first chunk is exactly the same length as the string we were going to assign to editMessageText
                // we can just edit the "Thinking..." message instead of replying anew.
                await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, messageChunk);
            }
        } else if (plan.workflow === 'chat') {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, plan.response);
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, "I didn't understand what you wanted to do.");
        }

    } catch (e) {
        console.error(e);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `An error occurred: ${e.message}`);
    }
});

// Railway provides process.env.PORT, otherwise default to 3000
const port = process.env.PORT || 3000;

// Always use long polling to prevent Telegram Webhook timeout loops on long scrapes.
// We explicitly drop pending updates so crashes don't cause infinite retry loops!
bot.launch({ dropPendingUpdates: true }).then(() => {
    console.log(`Bot is running in Long Polling mode. Old pending messages dropped.`);
}).catch(err => {
    console.error("Failed to start bot:", err);
});

// Since Railway expects an HTTP server to bind to the PORT if a public domain is assigned,
// we spin up a dummy server that just returns HTTP 200 OK.
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Telegram Scraper Bot is healthy and polling in the background.\n');
});

server.listen(port, () => {
    console.log(`Dummy HTTP server listening on port ${port} for Railway health checks`);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
