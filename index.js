require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// 🧠 MEMORY STORE (per phone number)
const leads = {};

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 📩 SEND MESSAGE
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
          "SB-API-KEY-ID": process.env.SENDBLUE_API_KEY_ID,
          "SB-API-SECRET-KEY": process.env.SENDBLUE_API_SECRET_KEY,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("❌ Sendblue ERROR:");
    console.error(error.response?.data || error.message);
  }
}

// 🏠 HEALTH CHECK
app.get("/", (req, res) => {
  res.send("Onyx AI bot (loop fixed) 🚀");
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

  // 🔍 EXTRACT INFO (simple but effective)
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
    // 🎯 CONTROLLED FLOW (NO LOOPING)
    if (!lead.car) {
      reply = "What car are you looking for?";
    } else if (!lead.budget) {
      reply = `Got it—what monthly are you trying to stay around for the ${lead.car}?`;
    } else if (!lead.timeline) {
      reply = "When are you looking to get into something?";
    } else {
      // 🔥 USE AI ONLY AFTER QUALIFIED
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
- Keep it short (1-2 sentences)
- Sound confident and human
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

    await sendMessage(from, reply);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ ERROR:", err);
    res.sendStatus(200);
  }
});

// 🚀 START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});