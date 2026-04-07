require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// 🔑 OPENAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

function extractCar(msg) {
  const keywords = [
    "bmw", "330", "m340",
    "tacoma", "toyota",
    "tesla", "model 3",
    "audi", "mercedes", "lexus", "acura"
  ];

  for (let k of keywords) {
    if (msg.includes(k)) return k;
  }
  return null;
}

// 📊 GET DEALS (SMART FILTERING)
async function getDeals(car, budget) {
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

    const carMatch =
      car &&
      (make.includes(car) ||
        model.includes(car));

    const budgetMatch =
      budget && monthly && monthly <= budget;

    if (
      (budget && budgetMatch && (!car || carMatch)) ||
      (!budget && carMatch)
    ) {
      matches.push({
        make: row[0],
        model: row[1],
        monthly,
        due: row[3],
        term: row[4],
        miles: row[5],
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

// 🤖 AI POLISH
async function aiReply(dealsText, userMsg) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `
You are a high-end car leasing broker.

Tone:
- Natural
- Confident
- Short
- No fluff
- No salesy clichés

You are texting like a real broker.
`,
      },
      {
        role: "user",
        content: `Deals:\n${dealsText}\n\nUser: ${userMsg}`,
      },
    ],
  });

  return res.choices[0].message.content;
}

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const msg = req.body.content;
  const lower = msg.toLowerCase();
  const from = req.body.number;

  const budget = extractBudget(lower);
  const car = extractCar(lower);

  // 🔥 ALWAYS HANDLE DEAL REQUESTS FIRST
  if (budget || car) {
    const deals = await getDeals(car, budget);

    if (deals.length > 0) {
      const dealText = deals
        .map(d => `${d.make} ${d.model} — $${d.monthly}/mo, ${d.due} due`)
        .join("\n");

      const reply = await aiReply(dealText, msg);

      await sendMessage(from, reply);
      return res.sendStatus(200);
    }
  }

  // 🔥 GREETING (ONLY FIRST MESSAGE)
  if (!global.started) {
    global.started = true;
    await sendMessage(from, "Hey—what are you looking to get into?");
    return res.sendStatus(200);
  }

  // 🔥 SAFE FALLBACK (NO LOOP)
  await sendMessage(from, "Got you—what kind of car are you thinking?");
  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("FINAL STABLE BROKER BOT 🚀");
});