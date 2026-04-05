require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const leads = {};

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

// 🧠 DETECTION
function hasNumber(msg) {
  return msg.match(/\d{3,4}/);
}

function hasCar(msg) {
  return msg.match(/bmw|m340|m3|m4|tacoma|toyota|mercedes|c300|tesla|audi|lexus/);
}

function isReadyNow(msg) {
  return msg.match(/now|im free|ready|lets do it|call now/);
}

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const msg = req.body.content.toLowerCase();
  const from = req.body.number;

  if (!leads[from]) {
    leads[from] = {
      car: null,
      budget: null,
      ready: false,
    };
  }

  const lead = leads[from];

  // STORE DATA
  if (!lead.car && hasCar(msg)) {
    lead.car = msg;
  }

  if (!lead.budget && hasNumber(msg)) {
    lead.budget = msg;
  }

  if (isReadyNow(msg)) {
    lead.ready = true;
  }

  let reply;

  // FLOW

  if (!lead.car) {
    reply = "What car are you looking for?";
  }

  else if (!lead.budget) {
    reply = `Got it—what monthly are you trying to stay around for that?`;
  }

  // 🔥 IF THEY ASK PRICING
  else if (msg.includes("price") || msg.includes("pricing")) {
    reply = `M340s are usually in the ${lead.budget}–$750 range depending on spec. I can get you the best deal available—want me to pull options for you?`;
  }

  // 🔥 IF THEY ARE READY → HARD CLOSE
  else if (lead.ready) {
    reply = `Perfect—call me right now and I’ll lock this in for you.

📞 818-422-2168`;
  }

  // 🔥 DEFAULT CLOSE PUSH
  else {
    reply = `I can get you a solid deal on that. Want me to line up options or lock something in for you?`;
  }

  await sendMessage(from, reply);
  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("Closer bot running 🚀");
});