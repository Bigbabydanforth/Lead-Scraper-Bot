Railway Setup Instructions for Antigravity
Goal: Deploy a persistent Node.js webhook to the cloud in 5-10 minutes.

What You'll Get: A cloud-hosted API that can be called from anywhere (n8n, APIs, browsers, etc.)

Prerequisites
Before starting, you'll need:

Railway Account - Sign up at https://railway.app (Trial credits available)

Railway CLI - Installed on your local machine

GitHub Account - For seamless deployments and version control

🔒 Important: Each user must create their own Railway account and authenticate. API tokens and environment variables are managed via the Railway dashboard or CLI and are never hardcoded.

Step 1: Install Railway CLI
Ask Antigravity to run:

Bash
npm install -g @railway/cli
Expected Output: Railway CLI installed successfully

Step 2: Authenticate with Railway
Ask Antigravity to run:

Bash
railway login
What Happens:

A browser window will open

You'll be asked to log in to Railway

Once authorized, the CLI will save your session locally

Expected Output:

Logged in as [Your Email]
Step 3: Create Your First Webhook
Create a folder, run npm init -y, and create a file called index.js:

JavaScript
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Main Webhook Endpoint
app.all('/', (req, res) => {
  const name = req.query.name || req.body.name || "World";
  
  res.json({
    message: `Hi ${name}`,
    status: "success"
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
Step 4: Deploy to the Cloud
Ask Antigravity to run:

Bash
railway up
What Happens:

Railway packages your code into a container.

It detects the Node.js environment automatically.

It provides a live deployment URL.

Copy your generated domain - You can find this in the Railway Dashboard under Settings > Networking!

Step 5: Test Your Webhook
Ask Antigravity to run (replace with your actual Railway URL):

Bash
curl "https://your-project-production.up.railway.app?name=Test"
Expected Output:

JSON
{"message":"Hi Test","status":"success"}
🎉 Success! Your JavaScript webhook is now live on Railway!

Common Issues & Solutions
Issue 1: Error: Cannot find module 'express'
Problem: Express is not listed in your package.json

Solution: Install it locally before deploying:

Bash
npm install express
Issue 2: Webhook is unreachable (404 or Timeout)
Problem: No public domain assigned or wrong port.

Solution:

Go to Settings > Networking in Railway and click Generate Domain.

Ensure your code uses process.env.PORT (Railway assigns the port dynamically).

Issue 3: Deployment fails on "Start Command"
Problem: Railway doesn't know how to start your app.

Solution: Add a start script to your package.json:

JSON
"scripts": {
  "start": "node index.js"
}
Issue 4: Timeout Issues with n8n
Problem: Railway handles long requests better than Modal, but n8n might still timeout if the response takes >30s.

Solution: Return a 202 "Accepted" immediately and process in the background.

JavaScript
app.post('/process', (req, res) => {
  const city = req.query.city || "Lagos";

  // 1. Respond immediately to n8n
  res.status(202).json({
    status: "started",
    message: `Processing ${city} in the background`
  });

  // 2. Continue execution (Background task)
  setTimeout(() => {
    console.log(`Finished processing for ${city}`);
    // Here you could trigger an n8n webhook back with the result
  }, 10000);
});
Adding a Schedule (Cron Job)
Railway doesn't use modal.Cron. Instead, you have two options:

Node-Cron: Keep the app running 24/7 and use a library.

Railway Cron Jobs: Use the Railway dashboard to trigger a specific service.

Example using node-cron:

JavaScript
const cron = require('node-cron');

// Runs every day at 9 AM
cron.schedule('0 9 * * *', () => {
  console.log('Running daily report...');
});
Security Best Practices
Adding API Key Authentication
JavaScript
app.post("/secure", (req, res) => {
  const apiKey = req.headers['x-api-key'];
  
  if (apiKey !== process.env.MY_API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  
  res.json({ status: "authenticated" });
});
Using Railway Variables
Go to your project in the Railway Dashboard.

Click Variables.

Add MY_API_KEY or GOOGLE_TOKEN_JSON.

Access them in JS via process.env.VARIABLE_NAME.

Pro-Tip: Bulk Upload Variables
You can use the Railway CLI to upload a .env file directly:

Bash
railway variables --set < .env
Costs & Limits
Trial/Hobby Tier:

Uses "Execution Units" or a fixed monthly credit.

Pay-as-you-go after credits are exhausted.

Typical Usage:

A simple Express bot usually stays within the free tier limits for small/personal projects.

Essential Commands
Bash
# Setup
npm install -g @railway/cli
railway login

# Deploy current folder
railway up

# View live logs
railway logs

# Open dashboard
railway dashboard

# List projects
railway list