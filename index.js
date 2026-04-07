require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const leads = {};

// 🔑 GOOGLE AUTH
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// 📊 GET DEALS (PRICING SHEET)
async function getDeals(query, budget) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_PRICING_SHEET_ID,
    range: "Sheet1!A2:F",
  });

  const rows = res.data.values || [];
  let matches = [];

  for (let row of rows) {
    const make = row[0]?.toLowerCase();
    const model = row[1]?.toLowerCase();
    const monthly = parseInt(row[2]);

    const match =
      query &&
      (query.includes(make) ||
        query.includes(model) ||
        model.includes(query) ||
        (query.includes("330") && model.includes("330")));

    if (match || (budget && monthly <= budget)) {
      matches.push({
        model: row[1],
        monthly: row[2],
        due: row[3],
        term: row[4],
        miles: row[5],
      });
    }
  }

  return matches.slice(0, 3);
}

// 📊 SAVE LEAD (SEPARATE SHEET)
async function saveLead(lead) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_LEADS_SHEET_ID,
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
  /bmw|330|m340|tacoma|toyota|mercedes|tesla|audi|lexus/i.test(msg);

const extractBudget = (msg) => {
  const match = msg.match(/\d{3,4}/);
  return match ? parseInt(match[0]) : null;
};

const wantsOptions = (msg) =>
  /what do you have|options|cars|inventory|under/i.test(msg);

const isReady = (msg) =>
  /ready|lets do it|lock it|im ready|do it/i.test(msg);

const hasZip = (msg) =>
  /\b\d{5}\b/.test(msg);

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const msg = req.body.content;
  const lower = msg.toLowerCase();
  const from = req.body.number;

  if (!leads[from]) {
    leads[from] = { stage: "start", phone: from };
  }

  const lead = leads[from];
  const budget = extractBudget(lower);

  // STORE
  if (!lead.car && hasCar(lower)) {
    lead.car = lower;
  }

  if (!lead.budget && budget) {
    lead.budget = budget;
  }

  // 🔥 HARD CLOSE
  if (isReady(lower)) {
    await sendMessage(from, `Perfect—call me now and I’ll lock this in.\n\n818-422-2168`);
    return res.sendStatus(200);
  }

  // 🔥 DEAL ENGINE
  if (lead.car && (wantsOptions(lower) || budget)) {
    const deals = await getDeals(lead.car, budget);

    if (deals.length > 0) {
      let reply = deals
        .map(d => `${d.model} — ${d.monthly}/mo, ${d.due} due`)
        .join("\n");

      reply += "\n\nThese are the strongest options right now.";

      if (!lead.name) {
        reply += "\n\nWhat’s your name?";
        lead.stage = "name";
      }

      await sendMessage(from, reply);
      return res.sendStatus(200);
    }
  }

  // 🔥 FUNNEL

  let reply;

  if (lead.stage === "start") {
    reply = "Hey—what are you looking to get into?";
    lead.stage = "car";
  }

  else if (lead.stage === "car") {
    reply = "What are you thinking?";
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

      reply = `Perfect—I’ll line something up. Call me and we’ll lock it in.\n\n818-422-2168`;
      lead.stage = "done";
    } else {
      reply = "What zip code are you in?";
    }
  }

  else {
    reply = "What are you looking to get into?";
  }

  await sendMessage(from, reply);
  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("2-sheet broker system running 🚀");
});