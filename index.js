require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// 🔥 MEMORY (per phone number)
const leads = {};

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Google Sheets setup
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

// 📊 GET PRICING
async function getPricing(query) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Sheet1!A2:E",
  });

  const rows = res.data.values;

  for (let row of rows) {
    const model = row[0]?.toLowerCase();
    if (query.toLowerCase().includes(model)) {
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
        "Content-Type": "application/json",
      },
    }
  );
}

// 🏠 HEALTH
app.get("/", (req, res) => {
  res.send("Onyx AI bot (smart version) 🚀");
});

// 📩 MAIN WEBHOOK
app.post("/sms", async (req, res) => {
  const incomingMsg = req.body.content;
  const from = req.body.number;

  console.log("Incoming:", incomingMsg);

  // 🧠 INIT LEAD
  if (!leads[from]) {
    leads[from] = {
      car: null,
      budget: null,
      timeline: null,
    };
  }

  const lead = leads[from];
  const msg = incomingMsg.toLowerCase();

  // 🔍 BASIC EXTRACTION
  if (!lead.car && msg.match(/bmw|toyota|tacoma|mercedes|honda|tesla|audi|lexus/)) {
    lead.car = incomingMsg;
  }

  if (!lead.budget && msg.match(/\$?\d{3,4}/)) {
    lead.budget = incomingMsg;
  }

  if (!lead.timeline && msg.match(/now|soon|week|month|asap/)) {
    lead.timeline = incomingMsg;
  }

  let reply;

  try {
    // 📊 IF CAR KNOWN → TRY PRICING
    if (lead.car) {
      const pricing = await getPricing(lead.car);

      if (pricing && !lead.budget) {
        reply = `${pricing.model} ${pricing.trim} is running ${pricing.monthly}/mo with ${pricing.due} due (${pricing.notes}). What monthly are you trying to stay around?`;
      } else if (!lead.budget) {
        reply = `Got it—what monthly are you trying to stay around for the ${lead.car}?`;
      } else if (!lead.timeline) {
        reply = "When are you looking to get into something?";
      } else {
        // 🔥 CLOSE WITH AI
        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `
You are a high-end car leasing broker from Onyx Auto Collection.

You already know:
- Car: ${lead.car}
- Budget: ${lead.budget}
- Timeline: ${lead.timeline}

Your job:
- Push toward closing
- Offer options
- Sound confident and human
- Keep it under 2 sentences
`,
            },
            {
              role: "user",
              content: incomingMsg,
            },
          ],
        });

        reply = aiResponse.choices[0].message.content;
      }
    } else {
      // 🧠 ASK FOR CAR FIRST
      reply = "What car are you looking for?";
    }

    await sendMessage(from, reply);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(200);
  }
});

// 🚀 START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});