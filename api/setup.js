// Open https://<your-project>.vercel.app/api/setup once (and after each update) to connect Telegram.
import { makeTg, webhookSecret } from "../lib/telegram.js";

const page = (title, lines) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:0 16px;line-height:1.5">
<h2>${title}</h2>${lines.map((l) => `<p>${l}</p>`).join("")}</body>`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  try {
    // Loaded here so that any problem in these files is shown on this page instead of a bare 500
    const { MENU_KB } = await import("../lib/core.js");
    const { checkStore, getMeta, setMeta } = await import("../lib/store.js");

    const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: ownerId } = process.env;
    const problems = [];
    if (!token) problems.push("❌ Missing environment variable <b>TELEGRAM_BOT_TOKEN</b>.");
    if (!ownerId) problems.push("❌ Missing environment variable <b>TELEGRAM_CHAT_ID</b> (your own chat ID; it makes you the bot's owner).");
    try { await checkStore(); } catch (e) { problems.push("❌ " + esc(e.message)); }
    if (problems.length) {
      return res.status(200).send(page("Almost there", [...problems,
        "Fix these in Vercel → your project → Settings → Environment Variables (or Storage), then <b>Redeploy</b> and open this page again."]));
    }

    const tg = makeTg(token);
    const me = await tg("getMe");
    if (!me.ok) {
      return res.status(200).send(page("Couldn't connect to Telegram", [
        `Telegram said: ${esc(me.description || "unknown error")}`,
        "Check that TELEGRAM_BOT_TOKEN is exactly the token from @BotFather, redeploy, and try again."]));
    }
    const username = me.result.username;
    await setMeta({ ...(await getMeta().catch(() => ({}))), username });

    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || req.headers.host;
    const hook = await tg("setWebhook", {
      url: `https://${host}/api/telegram`,
      secret_token: webhookSecret(token),
      allowed_updates: ["message", "callback_query"],
    });
    if (!hook.ok) {
      return res.status(200).send(page("Couldn't connect to Telegram", [`Telegram said: ${esc(hook.description || "unknown error")}`]));
    }

    // What people see in the command menu and before they press Start
    await tg("setMyCommands", { commands: [
      { command: "menu", description: "Open the main menu" },
      { command: "list", description: "My subscriptions" },
      { command: "expired", description: "All expired subscriptions" },
      { command: "soon", description: "Due in 5 days or less" },
      { command: "active", description: "Active subscriptions with days left" },
      { command: "settings", description: "HR number, your name, delete my data" },
      { command: "help", description: "How it works" },
      { command: "cancel", description: "Cancel what I'm doing" },
    ] });
    await tg("setMyShortDescription", {
      short_description: "Reminds you before your subscriptions (Netflix, DStv, ChatGPT…) expire. ₦ $ €",
    });
    await tg("setMyDescription", {
      description:
        "Never miss a renewal again.\n\n" +
        "• Track all your subscriptions in ₦, $ or €\n" +
        "• Reminders 5 days and 2 days before expiry, and on the day\n" +
        "• See what's expired or due soon in one tap\n" +
        "• Ready-made renewal message for HR, sent via WhatsApp\n\n" +
        "Your list is private. Tap Start to begin.",
    });

    const link = `https://t.me/${username}`;
    const hello = await tg("sendMessage", {
      chat_id: ownerId,
      text: `✅ Your subscription bot is connected and open to everyone.\n\nShare this link so others can use it:\n${link}\n\nSend /stats any time to see how many people use it.`,
      reply_markup: { inline_keyboard: [...MENU_KB, [{ text: "📣 Share the bot", url: `https://t.me/share/url?url=${encodeURIComponent(link)}` }]] },
    });

    return res.status(200).send(page("✅ Connected!", [
      `Your bot: <a href="${link}">${link}</a> — share this link so others can use it.`,
      `Telegram now sends everything to <code>https://${esc(host)}/api/telegram</code>.`,
      hello.ok ? "Check Telegram: your bot just sent you a message." :
        `⚠️ I couldn't message you (${esc(hello.description)}). Check TELEGRAM_CHAT_ID and make sure you've pressed Start in the bot.`,
    ]));
  } catch (e) {
    console.error(e);
    return res.status(200).send(page("Something went wrong", [
      "The setup page hit an error. Please send this to whoever is helping you:",
      `<pre style="white-space:pre-wrap;background:#f3f3f3;padding:12px;border-radius:8px">${esc(e.stack || e.message)}</pre>`,
    ]));
  }
}
