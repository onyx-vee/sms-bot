require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 📩 SEND MESSAGE (Sendblue - BODY AUTH)
async function sendMessage(to, message) {
  try {
    const response = await axios.post(
      "https://api.sendblue.co/api/send-message",
      {
        api_key: process.env.SENDBLUE_API_KEY, // ✅ KEY IN BODY
        to_number: to,
        content: message,
        from_number: process.env.SENDBLUE_PHONE_NUMBER,
      }
    );

    console.log("✅ Send success:", response.data);
  } catch (error) {
    console.error("❌ Sendblue ERROR:");
    console.error(error.response?.data || error.message);
  }
}

// 🧪 TEST ROUTE
app.get("/test", async (req, res) => {
  console.log("API KEY:", process.env.SENDBLUE_API_KEY);

  try {
    await sendMessage("+18184222168", "Test message from Onyx 🚀");
    res.send("Test sent");
  } catch (err) {
    console.error(err);
    res.send("Error sending test");
  }
});

// 🏠 HEALTH
app.get("/", (req, res) => {
  res.send("Bot is live 🚀");
});

// 📩 WEBHOOK
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
          content:
            "You are a premium car leasing broker from Onyx Auto Collection. Keep replies short and confident.",
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});