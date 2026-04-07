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

// 🧠 SESSION
const sessions = {};

const APP_LINK = "https://onyxautocollection.com/1745-2/";
const PHONE = "818-422-2168";

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

function detectType(msg) {
  if (msg.includes("suv")) return "suv";
  if (msg.includes("truck")) return "truck";
  if (msg.includes("sedan")) return "sedan";
  return null;
}

function wantsAll(msg) {
  return /all|everything|list|more|send it|yes/i.test(msg);
}

function isReady(msg) {
  return /ready|lets do it|lock it|apply|run it/i.test(msg);
}

// 🔥 CLASSIFY
function classifyType(model) {
  const m = model.toLowerCase();

  if (/x\d|rx|nx|crv|rav4|cx|escape|pilot|highlander|kona|tiguan|qx|cherokee/.test(m)) return "suv";
  if (/tacoma|f150|silverado|ram|frontier/.test(m)) return "truck";
  return "sedan";
}

// 📊 GET DATA
async function getAllRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: "1TiMawK8HCbb-qqmxv0M09oJ6w3Zx-BWKIni7JVFAnTg",
    range: "Sheet1!A2:F",
  });
  return res.data.values || [];
}

// 📊 GET DEALS
async function getDeals(filters) {
  const rows = await getAllRows();
  let matches = [];

  for (let row of rows) {
    const monthly = cleanNumber(row[2]);
    const model = row[1]?.toLowerCase();

    if (!monthly) continue;
    if (filters.budget && monthly > filters.budget) continue;
    if (filters.type && classifyType(model) !== filters.type) continue;

    matches.push({
      make: row[0],
      model: row[1],
      monthly,
      due: row[3],
    });
  }

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

// 🔥 FOLLOW-UP ENGINE
function scheduleFollowUps(user) {
  const session = sessions[user];
  const now = Date.now();

  // 15 MIN
  setTimeout(async () => {
    if (sessions[user]?.lastReply === now) {
      await sendMessage(user, "Still want me to line something up for you?");
    }
  }, 15 * 60 * 1000);

  // 2 HOURS
  setTimeout(async () => {
    if (sessions[user]?.lastReply === now) {
      await sendMessage(user, "I can lock something in today if timing works.");
    }
  }, 2 * 60 * 60 * 1000);

  // NEXT DAY
  setTimeout(async () => {
    if (sessions[user]?.lastReply === now) {
      await sendMessage(user, "Want me to send a couple strong options based on what you were looking at?");
    }
  }, 24 * 60 * 60 * 1000);
}

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const msg = req.body.content;
  const lower = msg.toLowerCase();
  const from = req.body.number;

  if (!sessions[from]) sessions[from] = {};
  const session = sessions[from];

  // 🔥 UPDATE LAST REPLY (STOPS FOLLOWUPS)
  session.lastReply = Date.now();

  // 🔥 READY → CLOSE
  if (isReady(lower)) {
    await sendMessage(from, `Run the app here and I’ll take it from there:\n${APP_LINK}`);
    return res.sendStatus(200);
  }

  // 🔥 FILTERS
  const budget = extractBudget(lower);
  const type = detectType(lower);

  if (budget) session.budget = budget;
  if (type) session.type = type;

  // 🔥 FULL LIST
  if (wantsAll(lower) && session.deals) {
    let reply = session.deals
      .map(d => `${d.make} ${d.model} — $${d.monthly}/mo with ${d.due} due`)
      .join("\n");

    reply += `\n\nIf one makes sense, I can lock it in today.`;

    await sendMessage(from, reply);

    scheduleFollowUps(from);
    return res.sendStatus(200);
  }

  // 🔥 DEALS
  if (session.budget || session.type) {
    const deals = await getDeals(session);
    session.deals = deals;

    if (deals.length > 0) {
      const top3 = deals.slice(0, 3);

      let reply = top3
        .map(d => `${d.make} ${d.model} — $${d.monthly}/mo with ${d.due} due`)
        .join("\n");

      if (deals.length > 3) {
        reply += `\n\nI’ve got ${deals.length} options—want the full list?`;
      }

      reply += `\n\nIf one works, I can lock it in today.`;

      await sendMessage(from, reply);

      scheduleFollowUps(from);
      return res.sendStatus(200);
    }
  }

  // 🔥 GREETING
  if (!session.started) {
    session.started = true;
    await sendMessage(from, "What are you looking to get into?");
    return res.sendStatus(200);
  }

  // 🔥 FALLBACK
  await sendMessage(from, "Give me a budget or direction and I’ll line something up.");
  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("AUTO FOLLOW-UP SYSTEM LIVE 🚀");
});