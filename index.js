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

// 🧠 SESSION MEMORY
const sessions = {};

// 🔥 CLEAN NUMBER
function cleanNumber(val) {
  if (!val) return null;
  return Number(val.toString().replace(/[^0-9.]/g, ""));
}

// 🧠 DETECTION
function extractBudget(msg) {
  const match = msg.match(/\d{3,4}/);
  return match ? Number(match[0]) : null;
}

function detectBrand(msg) {
  const brands = ["bmw","audi","mercedes","toyota","lexus","tesla","acura","honda","hyundai"];
  return brands.find(b => msg.includes(b));
}

function detectType(msg) {
  if (msg.includes("suv")) return "suv";
  if (msg.includes("truck")) return "truck";
  if (msg.includes("sedan")) return "sedan";
  return null;
}

function isLuxury(msg) {
  return /luxury|premium/i.test(msg);
}

function wantsAll(msg) {
  return /all|everything|list|more|send it/i.test(msg);
}

// 🔥 CLASSIFY VEHICLE TYPE FROM MODEL
function classifyType(model) {
  const m = model.toLowerCase();

  if (/x\d|rx|nx|crv|rav4|cx|escape|pilot|highlander|kona|tiguan/.test(m)) return "suv";
  if (/truck|tacoma|f150|silverado|ram/.test(m)) return "truck";
  return "sedan";
}

// 🔥 LUXURY BRANDS
const luxuryBrands = ["bmw","audi","mercedes","lexus"];

// 📊 GET DEALS WITH FILTERING
async function getDeals(filters) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: "1TiMawK8HCbb-qqmxv0M09oJ6w3Zx-BWKIni7JVFAnTg",
    range: "Sheet1!A2:F",
  });

  const rows = res.data.values || [];
  let matches = [];

  for (let row of rows) {
    const make = row[0]?.toLowerCase();
    const model = row[1]?.toLowerCase();
    const monthly = cleanNumber(row[2]);

    if (!monthly) continue;

    // 🔥 FILTERS
    if (filters.budget && monthly > filters.budget) continue;

    if (filters.brand && !make.includes(filters.brand)) continue;

    if (filters.type && classifyType(model) !== filters.type) continue;

    if (filters.luxury && !luxuryBrands.includes(make)) continue;

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

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const msg = req.body.content;
  const lower = msg.toLowerCase();
  const from = req.body.number;

  if (!sessions[from]) sessions[from] = {};
  const session = sessions[from];

  // 🔥 DETECT FILTERS
  const budget = extractBudget(lower);
  const brand = detectBrand(lower);
  const type = detectType(lower);
  const luxury = isLuxury(lower);

  if (budget) session.budget = budget;
  if (brand) session.brand = brand;
  if (type) session.type = type;
  if (luxury) session.luxury = true;

  // 🔥 SHOW ALL
  if (wantsAll(lower) && session.deals) {
    const reply = session.deals
      .map(d => `${d.make} ${d.model} — $${d.monthly}/mo with ${d.due} due at signing`)
      .join("\n");

    await sendMessage(from, reply + `\n\nThat’s everything that fits.`);
    return res.sendStatus(200);
  }

  // 🔥 GET DEALS
  if (session.budget || session.brand || session.type || session.luxury) {
    const deals = await getDeals(session);

    session.deals = deals;

    if (deals.length > 0) {
      const top3 = deals.slice(0, 3);

      let reply = top3
        .map(d => `${d.make} ${d.model} — $${d.monthly}/mo with ${d.due} due at signing`)
        .join("\n");

      if (deals.length > 3) {
        reply += `\n\nI’ve got ${deals.length} options like this—want me to send the full list?`;
      }

      await sendMessage(from, reply);
      return res.sendStatus(200);
    } else {
      await sendMessage(from, "Nothing solid with that exact combo—but I can adjust it. Want me to take a look?");
      return res.sendStatus(200);
    }
  }

  // 🔥 GREETING
  if (!session.started) {
    session.started = true;
    await sendMessage(from, "Hey—what are you looking to get into?");
    return res.sendStatus(200);
  }

  // 🔥 FALLBACK
  await sendMessage(from, "Got you—give me an idea of budget or type and I’ll narrow it down.");
  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("SMART BROKER FILTER SYSTEM 🚀");
});