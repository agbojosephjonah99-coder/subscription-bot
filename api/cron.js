// Daily reminder job, triggered by Vercel Cron (see vercel.json).
import { runReminders } from "../lib/core.js";
import { loadState, saveState } from "../lib/store.js";
import { makeTg } from "../lib/telegram.js";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).send("Unauthorized");
  }
  try {
    const state = await loadState();
    const sent = await runReminders(state, makeTg(process.env.TELEGRAM_BOT_TOKEN), process.env);
    await saveState(state);
    return res.status(200).json({ ok: true, reminders_sent: sent });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
