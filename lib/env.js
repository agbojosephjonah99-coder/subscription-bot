// Settings for one user. Your own SIGN_NAME / HR_WHATSAPP from Vercel apply only to you;
// everyone else sets theirs in the bot under ⚙️ Settings.
import { isOwner } from "./store.js";

export function userEnv(chatId, meta = {}) {
  const owner = isOwner(chatId);
  return {
    TELEGRAM_CHAT_ID: String(chatId),
    SIGN_NAME: owner ? process.env.SIGN_NAME || "" : "",
    HR_WHATSAPP: owner ? process.env.HR_WHATSAPP || "" : "",
    BOT_USERNAME: meta.username || "",
  };
}
