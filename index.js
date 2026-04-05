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

// DETECTION
function hasCar(msg) {
  return msg.match(/bmw|m340|m3|m4|tacoma|toyota|mercedes|tesla|audi|lexus/);
}

function hasBudget(msg) {
  return msg.match(/\d{3,4}/);
}

function wantsToMoveForward(msg) {
  return msg.match(/lock|deal|yes|do it|ready/);
}

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const msg = req.body.content.toLowerCase();
  const from = req.body.number;

  if (!leads[from]) {
    leads[from] = {
      stage: "start",
      car: null,
      budget: null,
    };
  }

  const lead = leads[from];

  let reply;

  // 🔥 STATE MACHINE

  switch (lead.stage) {

    case "start":
      reply = "What car are you looking for?";
      lead.stage = "car";
      break;

    case "car":
      if (hasCar(msg)) {
        lead.car = msg;
        reply = "Got it—what monthly are you trying to stay around?";
        lead.stage = "budget";
      } else {
        reply = "Which car are you looking for?";
      }
      break;

    case "budget":
      if (hasBudget(msg)) {
        lead.budget = msg;
        reply = `Perfect. I can work with that.

Want me to lock something in or show you a couple solid options?`;
        lead.stage = "close";
      } else {
        reply = "What monthly payment are you trying to stay around?";
      }
      break;

    case "close":
      if (wantsToMoveForward(msg)) {
        reply = `Perfect—call me right now and I’ll lock it in.

📞 818-422-2168`;
        lead.stage = "done";
      } else {
        reply = "Do you want me to lock something in or show options?";
      }
      break;

    case "done":
      reply = `Call me and I’ll take care of everything.

📞 818-422-2168`;
      break;

    default:
      reply = "What car are you looking for?";
  }

  await sendMessage(from, reply);
  res.sendStatus(200);
});

// START
app.listen(3000, () => {
  console.log("State machine bot running 🚀");
});