require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");
const { google } = require("googleapis");

const app = express();
app.use(bodyParser.json());

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// In-memory follow-up tracking
const activeFollowUps = {};

// 📩 SEND MESSAGE (Sendblue)
async function sendMessage(to, message) {
  try {
    await axios.post(
      "https://api.sendblue.co/api/send-message",
      {
        number: to,
        content: message,
        from_number: process.env.SENDBLUE_PHONE_NUMBER,
      },
      {
        headers: {
          "sb-api-key": process.env.SENDBLUE_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Sendblue error:", error.response?.data || error.message);
  }
}

// 📊 GET DEALS FROM GOOGLE SHEETS
async function getDealsFromSheet() {
  const sheets = google.sheets({
    version: "v4",
    auth: process.env.GOOGLE_API_KEY,
  });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Sheet1!A2:D",
  });

  const rows = response.data.values;

  if (!rows || rows.length === 0) return "No deals available";

  return rows
    .map(
      (row) =>
        `${row[0]}: $${row[1]}/mo, $${row[2]} DAS (${row[3] || ""})`
    )
    .join("\n");
}

// 📊 LOG LEADS TO GOOGLE SHEETS
async function logLead(phone, message) {
  const sheets = google.sheets({
    version: "v4",
    auth: process.env.GOOGLE_API_KEY,
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Sheet1!A:C",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[new Date().toLocaleString(), phone, message]],
    },
  });
}

// ⏱ SCHEDULE FOLLOW-UP
function scheduleFollowUp(to, delay, message) {
  const timeout = setTimeout(async () => {
    try {
      await sendMessage(to, message);
    } catch (err) {
      console.error("Follow-up failed:", err);
    }
  }, delay);

  if (!activeFollowUps[to]) {
    activeFollowUps[to] = [];
  }

  activeFollowUps[to].push(timeout);
}

// 🧠 GENERATE FOLLOW-UP MESSAGE
async function generateFollowUp(originalMessage) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `
You are a high-end leasing broker from Onyx Auto Collection.

Write a short SMS follow-up message.

Rules:
- Under 2 sentences
- Casual, smooth, not pushy
- Slightly persuasive
`,
      },
      {
        role: "user",
        content: originalMessage,
      },
    ],
  });

  return response.choices[0].message.content;
}

// 🏠 HEALTH CHECK
app.get("/", (req, res) => {
  res.send("Onyx SMS bot running 🚀");
});

// 📩 MAIN WEBHOOK
app.post("/sms", async (req, res) => {
  const incomingMsg = req.body.content;
  const from = req.body.number;

  try {
    // Cancel old follow-ups
    if (activeFollowUps[from]) {
      activeFollowUps[from].forEach(clearTimeout);
      delete activeFollowUps[from];
    }

    // Log lead
    await logLead(from, incomingMsg);

    // Get live deals
    const deals = await getDealsFromSheet();

    // Generate AI response
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `
You are a premium car leasing broker for Onyx Auto Collection (Onyx).

Use this pricing:
${deals}

Rules:
- Keep responses under 3 sentences
- Sound smooth, confident, and human
- Be slightly persuasive
- Always move toward closing
`,
        },
        {
          role: "user",
          content: incomingMsg,
        },
      ],
    });

    const reply = aiResponse.choices[0].message.content;

    // Send reply
    await sendMessage(from, reply);

    // Generate follow-ups
    const followUp1 = await generateFollowUp(incomingMsg);
    const followUp2 = await generateFollowUp(incomingMsg);

    // Schedule follow-ups
    scheduleFollowUp(from, 60 * 60 * 1000, followUp1); // 1 hour
    scheduleFollowUp(from, 24 * 60 * 60 * 1000, followUp2); // 24 hours

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(200);
  }
});

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});