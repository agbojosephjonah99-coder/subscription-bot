import { createHash } from "node:crypto";

export function makeTg(token) {
  return async function tg(method, params = {}) {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
    // "message is not modified" happens when a button re-shows the same screen: harmless
    if (!j.ok && !/not modified/i.test(j.description || "")) {
      console.error(`Telegram ${method} failed:`, j.description);
    }
    return j;
  };
}

// Secret Telegram sends with every webhook call, so nobody else can post to the bot's URL
export function webhookSecret(token) {
  return createHash("sha256").update("subbot:" + token).digest("hex").slice(0, 48);
}
