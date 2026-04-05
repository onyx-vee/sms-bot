require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 📩 SEND MESSAGE FUNCTION (Sendblue working version)
async function sendMessage(to, message) {
  try {
    const response = await axios.post(
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

    console.log("✅ Send success:", response.data);
  } catch (error) {
    console.error("❌ Sendblue ERROR:");
    console.error(error.response?.data || error.message);
  }
}

// 🏠 HEALTH CHECK
app.get("/", (req, res) => {
  res.send("Onyx AI SMS bot live 🚀");
});

// 📩 MAIN WEBHOOK
app.post("/sms", async (req, res) => {
  console.log("Incoming:", req.body);

  const incomingMsg = req.body.content;
  const from = req.body.number;

  try {
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `
You are a high-end car leasing broker from Onyx Auto Collection.

Your goals:
- Qualify the lead
- Get their budget, car interest, and timeline
- Guide them toward a deal
- Keep responses short, confident, and natural (like texting)

Tone:
- Friendly but professional
- Slightly persuasive
- Never robotic

Rules:
- Always ask a follow-up question
- Keep replies under 2-3 sentences
- Sound like a real salesperson
- Move the conversation toward locking a deal

Flow:
1. Ask what car they want
2. Ask budget/monthly payment
3. Ask timeline (when they need it)
4. Offer to send options or secure a deal

Do NOT:
- Write long paragraphs
- Over-explain
- Mention you are AI
`
        },
        {
          role: "user",
          content: incomingMsg,
        },
      ],
    });

    const reply = aiResponse.choices[0].message.content;

    await sendMessage(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ AI ERROR:", err);
    res.sendStatus(200);
  }
});

// 🚀 START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});