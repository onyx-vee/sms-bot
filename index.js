require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const sessions = {};

const APP_LINK = "https://onyxautocollection.com/1745-2/";

// 🔑 GOOGLE AUTH
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// 🔥 HELPERS
function cleanNumber(val) {
  if (!val) return null;
  return Number(val.toString().replace(/[^0-9.]/g, ""));
}

// 🧠 DETECTORS
function extractBudget(msg) {
  const match = msg.match(/\d{3,4}/);
  return match ? Number(match[0]) : null;
}

function detectBrand(msg) {
  const brands = ["toyota","bmw","audi","mercedes","lexus","nissan","honda","mazda","hyundai","kia"];
  return brands.find(b => msg.includes(b));
}

function detectType(msg) {
  if (msg.includes("truck")) return "truck";
  if (msg.includes("suv")) return "suv";
  if (msg.includes("sedan")) return "sedan";
  return null;
}

function detectTerm(msg) {
  const match = msg.match(/(13|18|24|36|39|48)/);
  return match ? match[0] : null;
}

function detectMiles(msg) {
  if (/7\.?5|7500/.test(msg)) return "7500";
  if (/10k|10000/.test(msg)) return "10000";
  if (/12k|12000/.test(msg)) return "12000";
  if (/15k|15000/.test(msg)) return "15000";
  return null;
}

function isCheapest(msg) {
  return /cheapest|lowest/i.test(msg);
}

function isBest(msg) {
  return /best|recommend/i.test(msg);
}

function wantsAll(msg) {
  return /all|everything|list|more|send it|yes/i.test(msg);
}

function isReady(msg) {
  return /ready|apply|lock|run it/i.test(msg);
}

// 🧠 PERSONALITY
function detectPersonality(msg) {
  if (/price|best|deal|ready|apply|cheapest/.test(msg)) return "buyer";
  if (/term|miles|details|how/.test(msg)) return "analytical";
  if (/options|what do you have/.test(msg)) return "explorer";
  if (/maybe|not sure|thinking/.test(msg)) return "hesitant";
  return "neutral";
}

function formatResponse(text, personality) {
  switch (personality) {
    case "buyer":
      return text + "\n\nIf that works, I can lock it in today.";
    case "analytical":
      return text + "\n\nWant me to break anything down further?";
    case "explorer":
      return text + "\n\nI can narrow this down if you want.";
    case "hesitant":
      return text + "\n\nNo rush—happy to walk through it.";
    default:
      return text;
  }
}

// 🧠 OBJECTIONS
function detectObjection(msg) {
  if (/expensive|too much|high/.test(msg)) return "price";
  if (/shopping|comparing/.test(msg)) return "shopping";
  if (/wait|later/.test(msg)) return "delay";
  return null;
}

function handleObjection(type) {
  switch (type) {
    case "price":
      return "Got it. Are you trying to stay lower monthly or upfront?";
    case "shopping":
      return "Makes sense—most options out there won’t beat these numbers.";
    case "delay":
      return "All good—just keep in mind programs change month to month.";
  }
}

// 🔥 NEGOTIATION
function detectNegotiation(msg) {
  if (/0 down|zero down/.test(msg)) return { type: "zero_down" };

  const match = msg.match(/(\d{3,5})\s?(down|due)/);
  if (match) return { type: "custom_down", amount: Number(match[1]) };

  if (/lower|better|deal|work with me/.test(msg)) return { type: "improve" };

  return null;
}

function adjustPayment(deal, newDown) {
  const currentDown = cleanNumber(deal.due) || 0;
  const term = deal.term?.toString();

  const rates = {
    "13": 77,
    "18": 56,
    "24": 42,
    "36": 28,
    "39": 26,
    "48": 21,
  };

  const ratePer1k = rates[term] || 30;

  const diff = newDown - currentDown;
  const monthlyChange = (diff / 1000) * ratePer1k;

  const newMonthly = Math.round(deal.monthly - monthlyChange);

  return { newMonthly, newDown };
}

// 🔥 TYPE CLASSIFIER
function classifyType(model) {
  const m = model.toLowerCase();
  if (/tacoma|f150|ram|silverado|frontier/.test(m)) return "truck";
  if (/x\d|rx|nx|rav4|crv|cx|qx|tiguan/.test(m)) return "suv";
  return "sedan";
}

// 📊 GET DATA
async function getRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: "1TiMawK8HCbb-qqmxv0M09oJ6w3Zx-BWKIni7JVFAnTg",
    range: "Sheet1!A2:F",
  });
  return res.data.values || [];
}

// 📊 GET DEALS
async function getDeals(filters) {
  const rows = await getRows();
  let deals = [];

  for (let row of rows) {
    const make = row[0]?.toLowerCase();
    const model = row[1]?.toLowerCase();
    const monthly = cleanNumber(row[2]);
    const term = row[4];
    const miles = row[5];

    if (!monthly) continue;
    if (filters.budget && monthly > filters.budget) continue;
    if (filters.brand && !make.includes(filters.brand)) continue;
    if (filters.type && classifyType(model) !== filters.type) continue;
    if (filters.term && term !== filters.term) continue;
    if (filters.miles && !miles.includes(filters.miles)) continue;

    deals.push({
      make: row[0],
      model: row[1],
      monthly,
      due: row[3],
      term,
      miles,
    });
  }

  deals.sort((a, b) => a.monthly - b.monthly);
  return deals;
}

// 📩 SEND
async function sendMessage(to, msg) {
  await axios.post(
    "https://api.sendblue.co/api/send-message",
    {
      number: to,
      content: msg,
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

// 🔁 FOLLOW-UP LOOP
setInterval(async () => {
  const now = Date.now();

  for (let user in sessions) {
    const s = sessions[user];
    if (!s.lastReply) continue;

    const diff = now - s.lastReply;

    if (!s.f1 && diff > 15 * 60 * 1000) {
      await sendMessage(user, "Still want me to line something up?");
      s.f1 = true;
    }

    if (!s.f2 && diff > 2 * 60 * 60 * 1000) {
      await sendMessage(user, "I can lock something in today if timing works.");
      s.f2 = true;
    }

    if (!s.f3 && diff > 24 * 60 * 60 * 1000) {
      await sendMessage(user, "Want me to send a couple strong options?");
      s.f3 = true;
    }
  }
}, 60000);

// 📩 MAIN
app.post("/sms", async (req, res) => {
  const msg = req.body.content.toLowerCase();
  const from = req.body.number;

  if (!sessions[from]) sessions[from] = {};
  const session = sessions[from];

  session.lastReply = Date.now();
  session.f1 = session.f2 = session.f3 = false;

  const personality = detectPersonality(msg);

  // OBJECTION
  const objection = detectObjection(msg);
  if (objection) {
    return sendMessage(from, formatResponse(handleObjection(objection), personality));
  }

  // CLOSE
  if (isReady(msg)) {
    return sendMessage(from, `Run the app here:\n${APP_LINK}`);
  }

  // UPDATE FILTERS
  const budget = extractBudget(msg);
  const brand = detectBrand(msg);
  const type = detectType(msg);
  const term = detectTerm(msg);
  const miles = detectMiles(msg);

  if (budget) session.budget = budget;
  if (brand) session.brand = brand;
  if (type) session.type = type;
  if (term) session.term = term;
  if (miles) session.miles = miles;

  const deals = await getDeals(session);
  session.deals = deals;

  // NEGOTIATION
  const negotiation = detectNegotiation(msg);
  if (negotiation && deals.length) {
    const deal = deals[0];

    if (negotiation.type === "zero_down") {
      const r = adjustPayment(deal, 0);
      return sendMessage(from, `${deal.make} ${deal.model}\n\n$0 down → ~$${r.newMonthly}/mo (${deal.term} mo)`);
    }

    if (negotiation.type === "custom_down") {
      const r = adjustPayment(deal, negotiation.amount);
      return sendMessage(from, `${deal.make} ${deal.model}\n\n$${negotiation.amount} down → ~$${r.newMonthly}/mo`);
    }

    if (negotiation.type === "improve") {
      return sendMessage(from, `${deal.make} ${deal.model}\n\nI can tighten this up—want me to structure it better?`);
    }
  }

  // BEST
  if (isBest(msg) && deals.length) {
    const best = deals[0];
    return sendMessage(from, formatResponse(`${best.make} ${best.model} — $${best.monthly}/mo`, personality));
  }

  // CHEAPEST
  if (isCheapest(msg) && deals.length) {
    const d = deals[0];
    return sendMessage(from, formatResponse(`${d.make} ${d.model} — $${d.monthly}/mo`, personality));
  }

  // DEAL LIST
  if (deals.length) {
    const list = wantsAll(msg) ? deals : deals.slice(0, 3);

    let reply = list.map(d =>
      `${d.make} ${d.model} — $${d.monthly}/mo (${d.term}mo / ${d.miles})`
    ).join("\n");

    return sendMessage(from, formatResponse(reply, personality));
  }

  // GREETING
  if (!session.started) {
    session.started = true;
    return sendMessage(from, "Hey—what are you looking at right now?");
  }

  return sendMessage(from, "Give me a budget or direction and I’ll dial it in.");
});

// START
app.listen(3000, () => {
  console.log("ELITE BROKER SYSTEM LIVE 🚀");
});