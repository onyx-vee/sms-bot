require("dotenv").config();
const express = require("express");
const OpenAI = require("openai");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Twilio
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Health check
app.get("/", (req, res) => {
  res.send("Twilio bot live 🚀");
});

// 📩 MAIN WEBHOOK
app.post("/sms", async (req, res) => {
  const incomingMsg = req.body.Body;
  const from = req.body.From;

  console.log("Incoming:", incomingMsg, "from:", from);

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

    await client.messages.create({
      body: reply,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: from,
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("ERROR:", err);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});