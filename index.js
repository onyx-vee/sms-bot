require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const leads = {};

// 🔑 GOOGLE SETUP
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

  if (resetIntent(lower)) {
    leads[from] = { stage: "start" };
    await sendMessage(from, "What are you looking to get into?");
    return res.sendStatus(200);
  }

  if (!leads[from]) {
    leads[from] = { stage: "start", phone: from };
  }

  const lead = leads[from];
  let reply;

  // 🔥 FUNNEL

  if (lead.stage === "start") {
    reply = "What are you looking to get into?";
    lead.stage = "car";
  }

  else if (lead.stage === "car") {
    if (hasCar(lower)) {
      lead.car = msg;
      reply = "Solid choice. Where do you want to be monthly?";
      lead.stage = "budget";
    } else {
      reply = "What car are you thinking?";
    }
  }

  else if (lead.stage === "budget") {
    if (hasBudget(lower)) {
      lead.budget = msg;
      reply = "Got it. What’s your name?";
      lead.stage = "name";
    } else {
      reply = "What monthly payment are you trying to stay around?";
    }
  }

  else if (lead.stage === "name") {
    lead.name = msg;
    reply = "What zip code are you in?";
    lead.stage = "zip";
  }

  else if (lead.stage === "zip") {
    if (hasZip(lower)) {
      lead.zip = msg;

      // 💾 SAVE TO SHEET
      await saveLead(lead);

      reply = `Perfect. I’ll line up the best options in your area.\n\nCall me and I’ll walk you through it.\n\n818-422-2168`;

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

// START
app.listen(3000, () => {
  console.log("Lead capture bot running 🚀");
});