require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const leads = {};

// 🔑 OPENAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🔑 GOOGLE
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// 📊 SAVE LEAD
async function saveLead(lead) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Sheet1!A:F",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        lead.name,
        lead.phone,
        lead.car,
        lead.budget,
        lead.zip,
        new Date().toLocaleString()
      ]],
    },
  });
}

// 📩 SEND MESSAGE
async function sendMessage(to, message) {
  await axios.post(
    "https://api.sendblue.co/api/send-message",
    {
      number: to,
      content: message,
      from_number: process.env.SENDBLUE_PHONE_NUMBER,
    },
    {
      headers: {
        "SB-API-KEY-ID": process.env.SENDBLUE_API_KEY_ID,
        "SB-API-SECRET-KEY": process.env.SENDBLUE_API_SECRET_KEY,
      },
    }
  );
}

// 🧠 DETECTION
const hasCar = (msg) =>
  /bmw|m340|m3|m4|tacoma|toyota|mercedes|tesla|audi|lexus/i.test(msg);

const hasBudget = (msg) =>
  /\d{3,4}/.test(msg);

const hasZip = (msg) =>
  /\b\d{5}\b/.test(msg);

const isQuestion = (msg) =>
  /what|which|how|do you|can you|available|trims|models|options|inventory/i.test(msg);

const resetIntent = (msg) =>
  /start over|restart/i.test(msg);

// 📩 MAIN ROUTE
app.post("/sms", async (req, res) => {
  const msg = req.body.content;
  const lower = msg.toLowerCase();
  const from = req.body.number;

  // RESET
  if (resetIntent(lower)) {
    leads[from] = { stage: "start" };
    await sendMessage(from, "Hey—what’s up. What are you looking to get into?");
    return res.sendStatus(200);
  }

  if (!leads[from]) {
    leads[from] = { stage: "start", phone: from };
  }

  const lead = leads[from];

  // 🧠 STORE DATA EARLY
  if (!lead.car && hasCar(lower)) {
    lead.car = msg;
  }

  if (!lead.budget && hasBudget(lower)) {
    lead.budget = msg;
  }

  // 🔥 HANDLE QUESTIONS FIRST (KEY FIX)
  if (isQuestion(lower)) {
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `
You are a knowledgeable car leasing broker.

Tone:
- Casual, confident
- Not corporate
- Not robotic

Rules:
- Answer directly
- Keep it short
- Sound like a real person texting
`,
        },
        {
          role: "user",
          content: msg,
        },
      ],
    });

    let answer = aiResponse.choices[0].message.content;

    // 👉 Add natural follow-up
    if (!lead.budget) {
      answer += "\n\nWhere are you trying to land monthly?";
    } else if (!lead.name) {
      answer += "\n\nWhat’s your name?";
    }

    await sendMessage(from, answer);
    return res.sendStatus(200);
  }

  let reply;

  // 🔥 FUNNEL FLOW

  if (lead.stage === "start") {
    reply = "Hey—what’s up. What are you looking to get into?";
    lead.stage = "car";
  }

  else if (lead.stage === "car") {
    if (lead.car) {
      reply = "Got it. Where do you want to be monthly on it?";
      lead.stage = "budget";
    } else {
      reply = "What are you leaning toward?";
    }
  }

  else if (lead.stage === "budget") {
    if (lead.budget) {
      reply = "That works. What’s your name?";
      lead.stage = "name";
    } else {
      reply = "Where do you want to be monthly?";
    }
  }

  else if (lead.stage === "name") {
    lead.name = msg;
    reply = `Got you ${lead.name}. What area are you in?`;
    lead.stage = "zip";
  }

  else if (lead.stage === "zip") {
    if (hasZip(lower)) {
      lead.zip = msg;

      await saveLead(lead);

      reply = "Perfect. I’ll line something up that makes sense. Call me when you’re free and we’ll lock it in.";
      lead.stage = "done";
    } else {
      reply = "What zip code are you in?";
    }
  }

  else {
    reply = "Text me when you're ready and I’ll take care of it.";
  }

  await sendMessage(from, reply);
  res.sendStatus(200);
});

// START SERVER
app.listen(3000, () => {
  console.log("Onyx broker bot running 🚀");
});