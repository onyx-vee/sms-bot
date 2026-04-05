require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const leads = {};

// 📩 SEND
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
      },
    }
  );
}

// 🧠 DETECTION
const hasCar = (msg) =>
  /bmw|m340|tacoma|toyota|mercedes|tesla|audi|lexus/i.test(msg);

const hasBudget = (msg) =>
  /\d{3,4}/.test(msg);

const wantsOptions = (msg) =>
  /options|cars|what do you have|show/i.test(msg);

const wantsClose = (msg) =>
  /lock|deal|ready|lets do it|yes/i.test(msg);

const resetIntent = (msg) =>
  /start over|restart|hello|hi/i.test(msg);

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const msg = req.body.content.toLowerCase();
  const from = req.body.number;

  // RESET LOGIC 🔥
  if (resetIntent(msg)) {
    leads[from] = {
      car: null,
      budget: null,
    };

    await sendMessage(from, "What car are you looking for?");
    return res.sendStatus(200);
  }

  if (!leads[from]) {
    leads[from] = { car: null, budget: null };
  }

  const lead = leads[from];

  // STORE DATA
  if (!lead.car && hasCar(msg)) {
    lead.car = msg;
  }

  if (!lead.budget && hasBudget(msg)) {
    lead.budget = msg;
  }

  let reply;

  // 🔥 INTENT OVERRIDES FIRST (THIS FIXES EVERYTHING)

  if (wantsOptions(msg)) {
    reply = `Got you—what car are you leaning toward and I’ll show you the best options under your budget.`;
  }

  else if (wantsClose(msg)) {
    reply = `Perfect—call me right now and I’ll lock it in for you.

📞 818-422-2168`;
  }

  // 🔁 NORMAL FLOW

  else if (!lead.car) {
    reply = "What car are you looking for?";
  }

  else if (!lead.budget) {
    reply = `Nice—what monthly are you trying to stay around for the ${lead.car}?`;
  }

  else {
    reply = `I can get you a solid deal on that.

Want me to line up options or lock something in?`;
  }

  await sendMessage(from, reply);
  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("Smart bot running 🚀");
});