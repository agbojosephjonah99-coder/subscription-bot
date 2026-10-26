// Open https://<your-project>.vercel.app/api/setup once to connect Telegram to this bot.
import { checkStore } from "../lib/store.js";
import { makeTg, webhookSecret } from "../lib/telegram.js";

const page = (title, lines) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.5">
<h2>${title}</h2>${lines.map((l) => `<p>${l}</p>`).join("")}</body>`;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = process.env;
  const problems = [];
  if (!token) problems.push("❌ Missing environment variable <b>TELEGRAM_BOT_TOKEN</b>.");
  if (!chatId) problems.push("❌ Missing environment variable <b>TELEGRAM_CHAT_ID</b>.");
  try { await checkStore(); } catch (e) { problems.push("❌ " + e.message); }
  if (problems.length) {
    return res.status(200).send(page("Almost there", [...problems,
      "Fix these in Vercel → your project → Settings → Environment Variables (or Storage), then <b>Redeploy</b> and open this page again."]));
  }
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || req.headers.host;
  const tg = makeTg(token);
  const hook = await tg("setWebhook", {
    url: `https://${host}/api/telegram`,
    secret_token: webhookSecret(token),
    allowed_updates: ["message", "callback_query"],
  });
  if (!hook.ok) {
    return res.status(200).send(page("Couldn't connect to Telegram", [
      `Telegram said: ${hook.description || "unknown error"}`,
      "Check that TELEGRAM_BOT_TOKEN is exactly the token from @BotFather, redeploy, and try again."]));
  }
  await tg("setMyCommands", { commands: [
    { command: "menu", description: "Open the main menu" },
    { command: "list", description: "My subscriptions" },
    { command: "help", description: "How it works" },
    { command: "cancel", description: "Cancel what I'm doing" },
  ] });
  const hello = await tg("sendMessage", {
    chat_id: chatId,
    text: "✅ Your subscription bot is connected!\n\nTap ➕ Add subscription to get started.",
    reply_markup: { inline_keyboard: [
      [{ text: "➕ Add subscription", callback_data: "add" }],
      [{ text: "📋 My subscriptions", callback_data: "list" }],
      [{ text: "📞 HR WhatsApp number", callback_data: "hr" }, { text: "❓ Help", callback_data: "help" }],
    ] },
  });
  return res.status(200).send(page("✅ Connected!", [
    `Telegram now sends everything to <code>https://${host}/api/telegram</code>.`,
    hello.ok ? "Check Telegram: your bot just sent you a menu." :
      `⚠️ But I couldn't message chat ${chatId} (${hello.description}). Check TELEGRAM_CHAT_ID and make sure you've pressed Start in the bot.`,
  ]));
}
