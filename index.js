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

// 🔑 GOOGLE AUTH
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// 🔥 CLEAN NUMBER
function cleanNumber(val) {
  if (!val) return null;
  return parseInt(val.toString().replace(/[^0-9]/g, ""));
}

// 📊 GET DEALS (FIXED LOGIC)
async function getDeals(query, budget) {
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

    // 🔥 PRIORITY: BUDGET MATCH
    if (budget && monthly && monthly <= budget) {
      matches.push({
        make: row[0],
        model: row[1],
        monthly,
        due: row[3],
        term: row[4],
        miles: row[5],
      });
      continue;
    }

    // 🔥 SECONDARY: CAR MATCH
    if (
      query &&
      (query.includes(make) ||
        query.includes(model) ||
        model.includes(query))
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

// 🧠 DETECTION
const extractBudget = (msg) => {
  const match = msg.match(/\d{3,4}/);
  return match ? parseInt(match[0]) : null;
};

const wantsDeals = (msg) =>
  /what do you have|options|cars|inventory|available|under/i.test(msg);

const isReady = (msg) =>
  /ready|lets do it|lock it|im ready/i.test(msg);

// 🤖 AI RESPONSE
async function aiReply(context, userMsg) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `
You are a high-end car broker.

Tone:
- Natural
- Confident
- Human
- No fluff
- Short responses
`,
      },
      {
        role: "user",
        content: `Deals:\n${context}\n\nUser: ${userMsg}`,
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

  if (!leads[from]) {
    leads[from] = { phone: from };
  }

  const budget = extractBudget(lower);

  // 🔥 CLOSE
  if (isReady(lower)) {
    await sendMessage(from, `Perfect—call me now and I’ll lock it in.\n\n818-422-2168`);
    return res.sendStatus(200);
  }

  // 🔥 DEAL ENGINE (NOW ALWAYS WORKS)
  if (wantsDeals(lower) || budget) {
    const deals = await getDeals(lower, budget);

    if (deals.length > 0) {
      let dealText = deals
        .map(d => `${d.model} — $${d.monthly}/mo, ${d.due} due`)
        .join("\n");

      const reply = await aiReply(dealText, msg);

      await sendMessage(from, reply);
      return res.sendStatus(200);
    }
  }

  // 🔥 FALLBACK
  await sendMessage(from, "Hey—what are you looking to get into?");
  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("FINAL FIXED broker running 🚀");
});