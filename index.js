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

// 🤖 AI POLISH (TONE ONLY)
async function aiReply(context, message) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `
You are a high-end car leasing broker from Onyx Auto Collection.

Tone:
- Calm, confident, slightly selective
- Conversational, not robotic
- No emojis
- No corporate language

Rules:
- Max 2 sentences
- Never sound needy
- Always sound like you do deals daily
`,
      },
      {
        role: "user",
        content: `${context}\n\nRewrite this naturally:\n${message}`,
      },
    ],
  });

  return response.choices[0].message.content;
}

// 📩 SEND
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

const resetIntent = (msg) =>
  /start over|restart/i.test(msg);

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const msg = req.body.content;
  const lower = msg.toLowerCase();
  const from = req.body.number;

  // RESET
  if (resetIntent(lower)) {
    leads[from] = { stage: "start" };
    const reply = await aiReply("", "Hey—what’s up. What are you looking to get into right now?");
    await sendMessage(from, reply);
    return res.sendStatus(200);
  }

  if (!leads[from]) {
    leads[from] = { stage: "start", phone: from };
  }

  const lead = leads[from];
  let baseReply;

  // 🔥 CONTROLLED FUNNEL

  if (lead.stage === "start") {
    baseReply = "Hey—what’s up. What are you looking to get into right now?";
    lead.stage = "car";
  }

  else if (lead.stage === "car") {
    if (hasCar(lower)) {
      lead.car = msg;
      baseReply = "Got it. What are you leaning toward?";
      lead.stage = "budget";
    } else {
      baseReply = "What are you leaning toward?";
    }
  }

  else if (lead.stage === "budget") {
    if (hasBudget(lower)) {
      lead.budget = msg;
      baseReply = "That works. What’s your name?";
      lead.stage = "name";
    } else {
      baseReply = "Where do you want to be monthly on it?";
    }
  }

  else if (lead.stage === "name") {
    lead.name = msg;
    baseReply = `Got you ${lead.name}. What area are you in?`;
    lead.stage = "zip";
  }

  else if (lead.stage === "zip") {
    if (hasZip(lower)) {
      lead.zip = msg;

      await saveLead(lead);

      baseReply = "I’ll line something up that makes sense. Call me when you’re free and we’ll lock it in.";
      lead.stage = "done";
    } else {
      baseReply = "What zip code are you in?";
    }
  }

  else {
    baseReply = "Text me when you're ready and I’ll take care of it.";
  }

  // 🤖 AI POLISH
  const reply = await aiReply(
    `Customer: ${msg}\nCar: ${lead.car}\nBudget: ${lead.budget}`,
    baseReply
  );

  await sendMessage(from, reply);
  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("Onyx AI broker running 🚀");
});