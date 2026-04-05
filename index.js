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

// 📩 SEND MESSAGE FUNCTION (Sendblue)
async function sendMessage(to, message) {
  try {
    const response = await axios({
      method: "post",
      url: "https://api.sendblue.co/api/send-message",
      headers: {
        "sb-api-key": process.env.SENDBLUE_API_KEY,
      },
      data: {
        number: to,
        content: message,
        from_number: process.env.SENDBLUE_PHONE_NUMBER,
      },
    });

    console.log("Send success:", response.data);
  } catch (error) {
    console.error("❌ Sendblue ERROR:");
    console.error(error.response?.data || error.message);
  }
}

// 🧪 TEST ROUTE (VERY IMPORTANT)
app.get("/test", async (req, res) => {
  console.log("API KEY:", process.env.SENDBLUE_API_KEY);
  console.log("PHONE:", process.env.SENDBLUE_PHONE_NUMBER);

  try {
    await sendMessage("+18184222168", "Test message from Onyx 🚀");
    res.send("Test sent");
  } catch (err) {
    console.error(err);
    res.send("Error sending test");
  }
});

// 🏠 HEALTH CHECK
app.get("/", (req, res) => {
  res.send("Bot is live 🚀");
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
          content:
            "You are a premium car leasing broker from Onyx Auto Collection. Keep replies short, confident, and helpful.",
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