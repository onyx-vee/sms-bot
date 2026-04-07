require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const leads = {};

// 🔑 GOOGLE
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// 🔥 CLEAN NUMBER FUNCTION
function cleanNumber(val) {
  if (!val) return null;
  return parseInt(val.toString().replace(/[^0-9]/g, ""));
}

// 📊 GET DEALS (FIXED)
async function getDeals(query, budget) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_PRICING_SHEET_ID,
    range: "Sheet1!A2:F",
  });

  const rows = res.data.values || [];

  console.log("📊 SHEET ROWS:", rows); // DEBUG

  let matches = [];

  for (let row of rows) {
    const make = row[0]?.toLowerCase();
    const model = row[1]?.toLowerCase();
    const monthly = cleanNumber(row[2]);

    const carMatch =
      query &&
      (query.includes(make) ||
        query.includes(model) ||
        model.includes(query));

    const budgetMatch = budget && monthly && monthly <= budget;

    if (carMatch || budgetMatch) {
      matches.push({
        model: row[1],
        monthly: monthly,
        due: row[3],
        term: row[4],
        miles: row[5],
      });
    }
  }

  console.log("🔥 MATCHES:", matches); // DEBUG

  return matches.slice(0, 3);
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
const extractBudget = (msg) => {
  const match = msg.match(/\d{3,4}/);
  return match ? parseInt(match[0]) : null;
};

const wantsOptions = (msg) =>
  /what do you have|options|cars|inventory|available|under/i.test(msg);

const isReady = (msg) =>
  /ready|lets do it|lock it|im ready|do it/i.test(msg);

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

  // 🔥 HARD CLOSE
  if (isReady(lower)) {
    await sendMessage(from, `Perfect—call me now and I’ll lock this in.\n\n818-422-2168`);
    return res.sendStatus(200);
  }

  // 🔥 DEAL ENGINE (FIXED)
  if (wantsOptions(lower) || budget) {
    const deals = await getDeals(lower, budget);

    if (deals.length > 0) {
      let reply = deals
        .map(d => `${d.model} — $${d.monthly}/mo, ${d.due} due`)
        .join("\n");

      reply += "\n\nThese are the strongest options right now.";

      await sendMessage(from, reply);
      return res.sendStatus(200);
    }
  }

  // 🔥 FALLBACK (CLEAN)
  await sendMessage(from, "Hey—what are you looking to get into?");
  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("FIXED sheet parsing running 🚀");
});