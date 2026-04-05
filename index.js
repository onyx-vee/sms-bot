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

// Sendblue send function
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
        "sb-api-key": process.env.SENDBLUE_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );
}

// Health check
app.get("/", (req, res) => {
  res.send("Bot is live 🚀");
});

// MAIN WEBHOOK
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
          content: "You are a car leasing expert from Onyx Auto Collection. Keep replies short and helpful.",
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
    console.error(err);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});