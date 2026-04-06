require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const leads = {};

// 🔑 GOOGLE SHEETS
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

// 📊 GET PRICING
async function getPricing(carQuery) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Sheet1!A2:E",
  });

  const rows = res.data.values;

  for (let row of rows) {
    const model = row[0]?.toLowerCase();
    if (carQuery.includes(model)) {
      return {
        model: row[0],
        trim: row[1],
        monthly: row[2],
        due: row[3],
        notes: row[4],
      };
    }
  }

  return null;
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
  /bmw|m340|tacoma|toyota|mercedes|tesla|audi|lexus/i.test(msg);

const hasBudget = (msg) =>
  /\d{3,4}/.test(msg);

const resetIntent = (msg) =>
  /start over|restart|hello|hi/i.test(msg);

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const msg = req.body.content.toLowerCase();
  const from = req.body.number;

  // RESET
  if (resetIntent(msg)) {
    leads[from] = { car: null, budget: null };

    await sendMessage(from, "What are you looking to get into?");
    return res.sendStatus(200);
  }

  if (!leads[from]) {
    leads[from] = { car: null, budget: null };
  }

  const lead = leads[from];

  // STORE
  if (!lead.car && hasCar(msg)) {
    lead.car = msg;
  }

  if (!lead.budget && hasBudget(msg)) {
    lead.budget = msg;
  }

  let reply;

  try {
    // 🔥 IF WE KNOW CAR → GIVE REAL PRICING
    if (lead.car) {
      const pricing = await getPricing(lead.car);

      if (pricing) {
        reply = `${pricing.model} ${pricing.trim} is running ${pricing.monthly}/mo with ${pricing.due} due.

I can usually improve on that.

Where do you want to land monthly?`;
      }

      else if (!lead.budget) {
        reply = `Got it.

Where do you want to be monthly on that?`;
      }

      else {
        reply = `I can get aggressive on that setup.

Want me to line up the best options or secure one?`;
      }
    }

    else {
      reply = "What are you looking to get into?";
    }

    await sendMessage(from, reply);
    res.sendStatus(200);

  } catch (err) {
    console.error(err);
    res.sendStatus(200);
  }
});

// START
app.listen(3000, () => {
  console.log("Final bot running 🚀");
});