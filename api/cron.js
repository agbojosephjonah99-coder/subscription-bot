// Daily reminder job for every user, triggered by Vercel Cron (see vercel.json).
import { runReminders } from "../lib/core.js";
import { loadUser, saveUser, listUsers, getMeta } from "../lib/store.js";
import { makeTg } from "../lib/telegram.js";
import { userEnv } from "../lib/env.js";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).send("Unauthorized");
  }
  try {
    const tg = makeTg(process.env.TELEGRAM_BOT_TOKEN);
    const [listed, meta] = await Promise.all([listUsers(), getMeta().catch(() => ({}))]);
    // Include you (the owner) even before your first message to the new version
    const owner = process.env.TELEGRAM_CHAT_ID;
    const users = owner && !listed.includes(String(owner)) ? [...listed, String(owner)] : listed;
    let reminders = 0, failed = 0;
    // A few users at a time keeps us well under Telegram's sending limits
    for (let i = 0; i < users.length; i += 10) {
      await Promise.all(users.slice(i, i + 10).map(async (id) => {
        try {
          const state = await loadUser(id);
          if (state.__fresh && !state.subs.length) return; // nothing to remind
          reminders += await runReminders(state, tg, userEnv(id, meta));
          await saveUser(id, state);
        } catch (e) {
          failed++;
          console.error(`User ${id}:`, e.message);
        }
      }));
    }
    return res.status(200).json({ ok: true, users: users.length, reminders_sent: reminders, failed });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
