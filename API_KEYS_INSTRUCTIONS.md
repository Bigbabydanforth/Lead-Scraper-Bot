# Getting API Keys for the Telegram Lead Scraper Bot

To run this bot, you need two additional authentications setup:

---

## 1. Telegram Bot Token (`TELEGRAM_BOT_TOKEN`)

1. Open Telegram on your phone or computer.
2. Search for the user `@BotFather`.
3. Start a chat with `@BotFather` and type `/newbot`.
4. Follow the prompts:
    - Choose a **name** for your bot (e.g., "Gideon's Lead Finder").
    - Choose a **username** for your bot (must end in `bot`, e.g., `gideon_lead_finder_bot`).
5. After completing this, `@BotFather` will send you a message containing a **token**. It looks something like: `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`.
6. **Save this token securely.**

---

## 2. Gemini API Key (`GEMINI_API_KEY`)

1. Navigate to the Google AI Studio: [https://aistudio.google.com/](https://aistudio.google.com/)
2. Sign in with your Google account.
3. Once in the dashboard, look for the "Get API key" button in the top left or in the left sidebar menu.
4. Click **Create API key** -> **Create API key in new project**.
5. Your new API key will be displayed. It is a long string of letters and numbers.
6. **Save this key securely.**

---

## 3. How to Save the Keys Safely

### Running Locally Database
If you are running the bot locally on your own computer:
1. Open the `.env` file located in the root directory: `c:\Users\GIDEON\Desktop\Antigravity Dev\Demo Project\.env`.
2. Add the keys as new lines beneath your Airtable variables:
```env
TELEGRAM_BOT_TOKEN=paste_your_telegram_token_here
GEMINI_API_KEY=paste_your_gemini_api_key_here
```
3. Save the file.
4. Run the application from your terminal with `node bot.js`. Because the `.env` file is excluded using standard `.gitignore` practices, your keys won't be exposed when pushing to GitHub.

### Deploying to Railway (Production)
If deploying to the cloud using Railway:
1. Open your project on the [Railway Dashboard](https://railway.app/).
2. Select your `Telegram Lead Scraper Bot` service.
3. Navigate to the **Variables** tab.
4. Click **+ New Variable** and add:
    - Variable Name: `TELEGRAM_BOT_TOKEN` | Value: `paste_your_telegram_token_here`
    - Variable Name: `GEMINI_API_KEY` | Value: `paste_your_gemini_api_key_here`
5. Railway inherently keeps these secrets safe and securely passes them down into the container environment.
