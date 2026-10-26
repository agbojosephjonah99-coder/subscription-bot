// Telegram webhook: every message and button tap arrives here instantly.
import { handleUpdate } from "../lib/core.js";
import { loadState, saveState } from "../lib/store.js";
import { makeTg, webhookSecret } from "../lib/telegram.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("Subscription bot is running.");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret(token)) {
    return res.status(401).send("Unauthorized");
  }
  try {
    const state = await loadState();
    await handleUpdate(state, req.body || {}, makeTg(token), process.env);
    await saveState(state);
  } catch (e) {
    console.error(e);
  }
  // Always 200 so Telegram doesn't keep retrying the same update
  return res.status(200).json({ ok: true });
}
