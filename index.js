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

// 📊 GET DEALS
async function getDeals(query, budget) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: "1TiMawK8HCbb-qqmxv0M09oJ6w3Zx-BWKIni7JVFAnTg",
    range: "Sheet1!A2:F",
  });

  const rows = res.data.values || [];

  console.log("📊 SHEET ROWS:", rows);

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
        make: row[0],
        model: row[1],
        monthly,
        due: row[3],
        term: row[4],
        miles: row[5],
      });
    }
  }

  console.log("🔥 MATCHES:", matches);

  return matches.slice(0, 3);
}

// 📊 SAVE LEAD
async function saveLead(lead) {
  if (lead.saved) return;

  await sheets.spreadsheets.values.append({
    spreadsheetId: "1u_BwXG8zcGnlhnx6GyMBsFMYffphq0K2jbdsHMJOglg",
    range: "Sheet1!A:F",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        lead.name || "",
        lead.phone || "",
        lead.car || "",
        lead.budget || "",
        lead.zip || "",
        new Date().toLocaleString()
      ]],
    },
  });

  lead.saved = true;
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
const extractBudget = (msg) => {
  const match = msg.match(/\d{3,4}/);
  return match ? parseInt(match[0]) : null;
};

const extractZip = (msg) => {
  const match = msg.match(/\b\d{5}\b/);
  return match ? match[0] : null;
};

const isReady = (msg) =>
  /ready|lets do it|lock it|im ready/i.test(msg);

const wantsDeals = (msg) =>
  /what do you have|options|cars|inventory|available|under/i.test(msg);

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
- No corporate language
`,
      },
      {
        role: "user",
        content: `Context:\n${context}\n\nUser: ${userMsg}`,
      },
    ],
  });

  return res.choices[0].message.content;
}

// 🧪 TEST ROUTE (CRITICAL)
app.get("/test-pricing", async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: "1TiMawK8HCbb-qqmxv0M09oJ6w3Zx-BWKIni7JVFAnTg",
      range: "Sheet1!A2:F",
    });

    const rows = response.data.values;

    console.log("✅ RAW SHEET DATA:", rows);

    res.json({
      success: true,
      rows: rows,
    });
  } catch (err) {
    console.error("❌ SHEET ERROR:", err.message);
    res.json({
      success: false,
      error: err.message,
    });
  }
});

// 📩 MAIN SMS
app.post("/sms", async (req, res) => {
  const msg = req.body.content;
  const lower = msg.toLowerCase();
  const from = req.body.number;

  if (!leads[from]) {
    leads[from] = { phone: from };
  }

  const lead = leads[from];

  // 🔥 CAPTURE
  const budget = extractBudget(lower);
  const zip = extractZip(lower);

  if (budget) lead.budget = budget;
  if (zip) lead.zip = zip;

  // 🔥 CLOSE
  if (isReady(lower)) {
    await sendMessage(from, `Perfect—call me now and I’ll lock it in.\n\n818-422-2168`);
    return res.sendStatus(200);
  }

  // 🔥 DEAL ENGINE (PRIORITY)
  if (wantsDeals(lower) || budget) {
    const deals = await getDeals(lower, budget);

    if (deals.length > 0) {
      let dealText = deals
        .map(d => `${d.model} — $${d.monthly}/mo, ${d.due} due`)
        .join("\n");

      let reply = await aiReply(dealText, msg);

      await sendMessage(from, reply);
      return res.sendStatus(200);
    }
  }

  // 🔥 FALLBACK
  const reply = await aiReply("", msg);
  await sendMessage(from, reply);

  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("FINAL broker system running 🚀");
});