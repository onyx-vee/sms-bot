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

// 🧠 DETECT
function extractBudget(msg) {
  const match = msg.match(/\d{3,4}/);
  return match ? Number(match[0]) : null;
}

function wantsAll(msg) {
  return /all|everything|list|more/i.test(msg);
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

  // 🔥 SORT CHEAPEST FIRST (IMPORTANT)
  matches.sort((a, b) => a.monthly - b.monthly);

  return matches;
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

  const budget = extractBudget(lower);

  if (budget) {
    const deals = await getDeals(budget);

    if (deals.length > 0) {
      const showAll = wantsAll(lower);

      const list = showAll ? deals : deals.slice(0, 3);

      let reply = list
        .map(d => `${d.make} ${d.model} — $${d.monthly}/mo with ${d.due} due at signing`)
        .join("\n");

      // 🔥 DIFFERENT ENDINGS
      if (!showAll && deals.length > 3) {
        reply += `\n\nI’ve got ${deals.length} total options under $${budget}. Want me to send the full list?`;
      } else {
        reply += `\n\nThese are everything I have under $${budget} right now.`;
      }

      await sendMessage(from, reply);
      return res.sendStatus(200);
    }

    await sendMessage(from, "Nothing strong under that exact number, but I can get close—want me to check?");
    return res.sendStatus(200);
  }

  // 🔥 GREETING
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
  console.log("SMART DEAL LISTING RUNNING 🚀");
});