require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const sessions = {};

const APP_LINK = "https://onyxautocollection.com/1745-2/";
const PHONE = "818-422-2168";

// 🔑 GOOGLE
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// 🔥 CLEAN
function cleanNumber(val) {
  if (!val) return null;
  return Number(val.toString().replace(/[^0-9.]/g, ""));
}

// 🧠 DETECT
function extractBudget(msg) {
  const match = msg.match(/\d{3,4}/);
  return match ? Number(match[0]) : null;
}

function detectBrand(msg) {
  const brands = ["toyota","bmw","audi","mercedes","lexus","nissan","honda"];
  return brands.find(b => msg.includes(b));
}

function detectType(msg) {
  if (msg.includes("truck")) return "truck";
  if (msg.includes("suv")) return "suv";
  if (msg.includes("sedan")) return "sedan";
  return null;
}

function isCheapest(msg) {
  return /cheapest|lowest|least/i.test(msg);
}

function wantsAll(msg) {
  return /all|everything|list|more|send it|yes/i.test(msg);
}

function isReady(msg) {
  return /ready|apply|lock|run it/i.test(msg);
}

// 🔥 TYPE CLASSIFIER
function classifyType(model) {
  const m = model.toLowerCase();
  if (/tacoma|f150|ram|silverado|frontier/.test(m)) return "truck";
  if (/x\d|rx|nx|rav4|crv|cx|qx|tiguan/.test(m)) return "suv";
  return "sedan";
}

// 📊 GET ROWS
async function getRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: "1TiMawK8HCbb-qqmxv0M09oJ6w3Zx-BWKIni7JVFAnTg",
    range: "Sheet1!A2:F",
  });
  return res.data.values || [];
}

// 📊 GET DEALS
async function getDeals(filters) {
  const rows = await getRows();
  let deals = [];

  for (let row of rows) {
    const make = row[0]?.toLowerCase();
    const model = row[1]?.toLowerCase();
    const monthly = cleanNumber(row[2]);

    if (!monthly) continue;

    if (filters.budget && monthly > filters.budget) continue;
    if (filters.brand && !make.includes(filters.brand)) continue;
    if (filters.type && classifyType(model) !== filters.type) continue;

    deals.push({
      make: row[0],
      model: row[1],
      monthly,
      due: row[3],
    });
  }

  deals.sort((a, b) => a.monthly - b.monthly);
  return deals;
}

// 📩 SEND
async function sendMessage(to, msg) {
  await axios.post(
    "https://api.sendblue.co/api/send-message",
    {
      number: to,
      content: msg,
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

// 🔥 FOLLOW-UP LOOP (FIXED)
setInterval(async () => {
  const now = Date.now();

  for (let user in sessions) {
    const s = sessions[user];
    if (!s.lastReply) continue;

    const diff = now - s.lastReply;

    // 15 min
    if (!s.f1 && diff > 15 * 60 * 1000) {
      await sendMessage(user, "Still want me to line something up?");
      s.f1 = true;
    }

    // 2 hr
    if (!s.f2 && diff > 2 * 60 * 60 * 1000) {
      await sendMessage(user, "I can lock something in today if timing works.");
      s.f2 = true;
    }

    // 24 hr
    if (!s.f3 && diff > 24 * 60 * 60 * 1000) {
      await sendMessage(user, "Want me to send a couple strong options?");
      s.f3 = true;
    }
  }
}, 60 * 1000);

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const msg = req.body.content.toLowerCase();
  const from = req.body.number;

  if (!sessions[from]) sessions[from] = {};
  const session = sessions[from];

  // RESET FOLLOWUPS
  session.lastReply = Date.now();
  session.f1 = session.f2 = session.f3 = false;

  // 🔥 CLOSE
  if (isReady(msg)) {
    await sendMessage(from, `Run the app here:\n${APP_LINK}`);
    return res.sendStatus(200);
  }

  // 🔥 NEW INTENT (RESET FILTERS)
  const budget = extractBudget(msg);
  const brand = detectBrand(msg);
  const type = detectType(msg);

  if (budget) session.budget = budget;
  if (brand) session.brand = brand;
  if (type) session.type = type;

  // 🔥 CHEAPEST OVERRIDE
  if (isCheapest(msg)) {
    const deals = await getDeals({});
    const d = deals[0];

    await sendMessage(
      from,
      `${d.make} ${d.model} — $${d.monthly}/mo with ${d.due} due\n\nThat’s the lowest deal available right now.`
    );
    return res.sendStatus(200);
  }

  // 🔥 GET DEALS
  if (session.budget || session.brand || session.type) {
    const deals = await getDeals(session);
    session.deals = deals;

    if (deals.length > 0) {
      const list = wantsAll(msg) ? deals : deals.slice(0, 3);

      let reply = list
        .map(d => `${d.make} ${d.model} — $${d.monthly}/mo with ${d.due} due`)
        .join("\n");

      if (!wantsAll(msg) && deals.length > 3) {
        reply += `\n\nI’ve got ${deals.length} options. Want the full list?`;
      }

      reply += `\n\nIf one works, I can lock it in today.`;

      await sendMessage(from, reply);
      return res.sendStatus(200);
    }
  }

  // 🔥 GREETING
  if (!session.started) {
    session.started = true;
    await sendMessage(from, "What are you looking to get into?");
    return res.sendStatus(200);
  }

  await sendMessage(from, "Give me a direction and I’ll dial it in.");
  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("FULLY FIXED BROKER SYSTEM 🚀");
});