require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// 🔑 GOOGLE AUTH
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// 🔥 CLEAN NUMBER
function cleanNumber(val) {
  if (!val) return null;
  return Number(val.toString().replace(/[^0-9.]/g, ""));
}

// 📊 GET DEALS
async function getDeals(budget) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: "1TiMawK8HCbb-qqmxv0M09oJ6w3Zx-BWKIni7JVFAnTg",
    range: "Sheet1!A2:F",
  });

  const rows = res.data.values || [];
  let matches = [];

  for (let row of rows) {
    const monthly = cleanNumber(row[2]);

    if (monthly && monthly <= budget) {
      matches.push({
        make: row[0],
        model: row[1],
        monthly,
        due: row[3],
      });
    }
  }

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

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const msg = req.body.content;
  const lower = msg.toLowerCase();
  const from = req.body.number;

  const budgetMatch = lower.match(/\d{3,4}/);
  const budget = budgetMatch ? Number(budgetMatch[0]) : null;

  // 🔥 DEALS
  if (budget) {
    const deals = await getDeals(budget);

    if (deals.length > 0) {
      let reply = deals
        .map(d => `${d.make} ${d.model} — $${d.monthly}/mo with ${d.due} due at signing`)
        .join("\n");

      reply += "\n\nThese are solid options right now—want me to narrow it down for you?";

      await sendMessage(from, reply);
      return res.sendStatus(200);
    } else {
      await sendMessage(from, "Nothing strong under that exact number, but I can get close—want me to check?");
      return res.sendStatus(200);
    }
  }

  // 🔥 FIRST MESSAGE
  if (!global.started) {
    global.started = true;
    await sendMessage(from, "Hey—what are you looking to get into?");
    return res.sendStatus(200);
  }

  // 🔥 FALLBACK
  await sendMessage(from, "Got you—what kind of car are you thinking?");
  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("CLEAN BROKER BOT RUNNING 🚀");
});