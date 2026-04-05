require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const leads = {};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

// 🧠 BETTER DETECTION
function detectCar(msg) {
  const carKeywords = [
    "bmw", "m340", "m3", "m4",
    "toyota", "tacoma", "camry",
    "mercedes", "c300", "e350",
    "honda", "civic", "accord",
    "tesla", "model 3", "model y",
    "audi", "a4", "a5", "q5",
    "lexus", "rx", "is"
  ];

  return carKeywords.some(k => msg.includes(k));
}

function detectBudget(msg) {
  return msg.match(/\$?\d{3,4}/);
}

function detectTimeline(msg) {
  return msg.match(/now|soon|asap|week|month/);
}

// 🏠 HEALTH
app.get("/", (req, res) => {
  res.send("Onyx bot (natural flow) 🚀");
});

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const incomingMsg = req.body.content;
  const from = req.body.number;

  const msg = incomingMsg.toLowerCase();

  if (!leads[from]) {
    leads[from] = {
      car: null,
      budget: null,
      timeline: null,
      greeted: false,
    };
  }

  const lead = leads[from];

  // 🔍 STORE DATA
  if (!lead.car && detectCar(msg)) {
    lead.car = incomingMsg;
  }

  if (!lead.budget && detectBudget(msg)) {
    lead.budget = incomingMsg;
  }

  if (!lead.timeline && detectTimeline(msg)) {
    lead.timeline = incomingMsg;
  }

  let reply;

  try {
    // 👋 FIRST MESSAGE
    if (!lead.greeted) {
      lead.greeted = true;
      reply = "Hey—what car are you looking to lease?";
    }

    // 🚗 ASK CAR
    else if (!lead.car) {
      reply = "Got you—what car are you thinking?";
    }

    // 💰 ASK BUDGET
    else if (!lead.budget) {
      reply = `Nice, the ${lead.car} is a great choice. What monthly are you trying to stay around?`;
    }

    // ⏱ ASK TIMELINE
    else if (!lead.timeline) {
      reply = "Got it—when are you looking to get into something?";
    }

    // 🔥 CLOSE (AI handles tone)
    else {
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `
You are a top car leasing broker texting a client.

Context:
- Car: ${lead.car}
- Budget: ${lead.budget}
- Timeline: ${lead.timeline}

Your goal:
- Move them forward naturally
- Offer help, options, or next step
- Sound casual, confident, human

Rules:
- 1-2 sentences max
- No corporate language
- No “paperwork” talk
- Sound like a real person texting
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
    console.error(err);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});