// Telegram webhook: every message and button tap from every user arrives here instantly.
import { handleUpdate } from "../lib/core.js";
import { loadUser, saveUser, getMeta, countUsers, isOwner } from "../lib/store.js";
import { makeTg, webhookSecret } from "../lib/telegram.js";
import { userEnv } from "../lib/env.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("Subscription bot is running.");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret(token)) {
    return res.status(401).send("Unauthorized");
  }
  const update = req.body || {};
  const tg = makeTg(token);
  try {
    const chat = update.message?.chat || update.callback_query?.message?.chat;
    if (!chat) return res.status(200).json({ ok: true });
    if (chat.type !== "private") {
      if (update.callback_query) await tg("answerCallbackQuery", { callback_query_id: update.callback_query.id });
      else if (/^\/start/.test(update.message?.text || "")) {
        await tg("sendMessage", { chat_id: chat.id, text: "Please message me privately to track your subscriptions." });
      }
      return res.status(200).json({ ok: true });
    }
    const id = String(chat.id);

    // Owner-only: how many people use the bot
    if (isOwner(id) && /^\/stats\b/.test(update.message?.text || "")) {
      const n = await countUsers();
      await tg("sendMessage", { chat_id: id, text: `📊 ${n} ${n === 1 ? "person uses" : "people use"} your bot.` });
      return res.status(200).json({ ok: true });
    }

    const [state, meta] = await Promise.all([loadUser(id), getMeta().catch(() => ({}))]);
    await handleUpdate(state, update, tg, userEnv(id, meta));
    await saveUser(id, state);
  } catch (e) {
    console.error(e);
  }
  // Always 200 so Telegram doesn't keep retrying the same update
  return res.status(200).json({ ok: true });
}
