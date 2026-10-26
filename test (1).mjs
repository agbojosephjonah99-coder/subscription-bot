// Simulated end-to-end test: no network. Run with `node test/test.mjs`.
import assert from "node:assert/strict";
import { handleUpdate, runReminders, emptyState, nextDue, parseDate, addMonths } from "../lib/core.js";

const CHAT = 5767935941;
const env = { TELEGRAM_CHAT_ID: String(CHAT), SIGN_NAME: "Ada Okafor" };
const VERBOSE = process.argv.includes("-v");
let log = [];
let msgId = 100;
const tg = async (method, p) => {
  log.push({ method, ...p });
  if (VERBOSE && method !== "answerCallbackQuery") {
    const kb = p.reply_markup?.inline_keyboard?.map((r) => r.map((b) => `[${b.text}]`).join(" ")).join("\n   ") || "";
    console.log(`\n🤖 ${method === "editMessageText" ? "(edit) " : ""}${p.text}${kb ? "\n   " + kb : ""}`);
  }
  return { ok: true, result: { message_id: ++msgId } };
};
const at = (iso, hour = 9) => Date.parse(`${iso}T${String(hour - 1).padStart(2, "0")}:00:00Z`); // WAT time
let now = at("2026-10-26");
let state = emptyState(env);

const type = async (text, chat = CHAT) => {
  if (VERBOSE) console.log(`\n👤 ${text}`);
  log = [];
  await handleUpdate(state, { message: { chat: { id: chat }, text } }, tg, env, now);
  return log;
};
const tap = async (data, chat = CHAT) => {
  if (VERBOSE) console.log(`\n👆 tap ${data}`);
  log = [];
  await handleUpdate(state, { callback_query: { id: "q", data, message: { chat: { id: chat }, message_id: 7 } } }, tg, env, now);
  return log;
};
const texts = (l) => l.filter((x) => x.text).map((x) => x.text).join("\n---\n");
const buttons = (l) => l.flatMap((x) => x.reply_markup?.inline_keyboard?.flat() || []);
const findBtn = (l, label) => buttons(l).find((b) => b.text.includes(label));

// --- dates
assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
assert.equal(parseDate("20/10/2026", "2026-10-26"), "2026-10-20");
assert.throws(() => parseDate("31/02/2026", "2026-10-26"));

// --- menu
let l = await type("/start");
assert.match(texts(l), /tracking 0 subscriptions/);
assert.ok(findBtn(l, "Add subscription"));

// --- step-by-step add with buttons
await tap("add");
l = await type("Netflix");
assert.match(texts(l), /When did you last pay/);
l = await type("30/09/2026");
assert.match(texts(l), /How often/);
l = await tap("ac:monthly");
assert.match(texts(l), /Which email/);
l = await type("movies@gmail.com");
assert.match(texts(l), /How much/);
l = await type("₦4,400");
assert.match(texts(l), /Netflix added/);
assert.match(texts(l), /Amount: ₦4,400/);
assert.match(texts(l), /expires in 4 days/); // immediate 5-day reminder
assert.equal(state.pending, null);

// add with skips and Today button
await tap("add");
await type("Canva");
await tap("ad:yesterday");
await tap("ac:yearly");
await tap("askip");
l = await tap("askip");
assert.match(texts(l), /Canva added/);
assert.match(texts(l), /Amount: not set/);
assert.equal(state.subs[1].last_paid, "2026-10-25");

// bad input keeps you in the step
await tap("add");
await type("DStv Compact");
l = await type("not a date");
assert.match(texts(l), /couldn't read the date/);
assert.equal(state.pending.step, "date");
await type("27/09/2026");
await type("monthly");
await tap("askip");
await type("15700");
const dstv = state.subs.find((s) => s.name === "DStv Compact");
assert.equal(nextDue(dstv), "2026-10-27");

// duplicate name rejected
await tap("add");
l = await type("netflix");
assert.match(texts(l), /already have/);
await tap("cancel");
assert.equal(state.pending, null);

// --- list & manage
l = await tap("list");
assert.ok(findBtn(l, "DStv Compact · due tomorrow"));
const nf = state.subs.find((s) => s.name === "Netflix");
l = await tap(`s:${nf.id}`);
assert.equal(l.find((x) => x.method === "editMessageText") !== undefined, true);
assert.ok(findBtn(l, "Change amount"));

// change amount
l = await tap(`c:${nf.id}`);
assert.match(texts(l), /Current amount for Netflix: ₦4,400/);
l = await type("5,000");
assert.match(texts(l), /updated to ₦5,000/);
assert.equal(nf.cost, 5000);

// edit cycle + email + name
await tap(`ec:${nf.id}`);
l = await tap(`cy:${nf.id}:quarterly`);
assert.match(texts(l), /Billing: Quarterly/);
await tap(`cy:${nf.id}:monthly`);
await tap(`ee:${nf.id}`);
await type("new@gmail.com");
assert.equal(nf.email, "new@gmail.com");

// HR number
await tap("hr");
l = await type("0803 123 4567");
assert.match(texts(l), /\+2348031234567/);

// --- reminders: tomorrow DStv(2-day already sent when added? it was due in 1 day at add)
// Reset log to test the daily job
now = at("2026-10-26");
log = [];
let n = await runReminders(state, tg, env, now);
assert.equal(n, 0, "nothing new on the same day");

// Next day: DStv expires today -> reminder + HR message with WhatsApp button
now = at("2026-10-27");
log = [];
n = await runReminders(state, tg, env, now);
assert.match(texts(log), /DStv Compact EXPIRES TODAY/);
assert.match(texts(log), /Hello HR,[\s\S]*Plan cost: ₦15,700[\s\S]*Ada Okafor/);
const wa = findBtn(log, "Send to HR on WhatsApp");
assert.ok(wa.url.startsWith("https://wa.me/2348031234567?text=Hello%20HR"));

// Price changed on expiry day -> updated HR message is offered automatically
l = await tap(`c:${dstv.id}`);
l = await type("16500");
assert.match(texts(l), /updated message for HR[\s\S]*Plan cost: ₦16,500/);

// Mark paid from the reminder button
l = await tap(`p:${dstv.id}`);
assert.match(texts(l), /DStv Compact has been subscribed![\s\S]*Next payment due: Fri 27 Nov 2026/);

// Not renewed: Netflix due 30 Oct, check 1 Nov (+2) and 4 Nov (+5)
now = at("2026-11-01");
log = []; await runReminders(state, tg, env, now);
assert.match(texts(log), /Netflix expired 2 days ago/);
now = at("2026-11-04");
log = []; await runReminders(state, tg, env, now);
assert.match(texts(log), /Netflix expired 5 days ago .* is still NOT renewed/);
log = []; await runReminders(state, tg, env, now);
assert.equal(log.length, 0, "no repeats");

// Paid on a specific date
await tap(`pd:${nf.id}`);
l = await type("03/11/2026");
assert.match(texts(l), /Paid on: Tue 03 Nov 2026/);

// Remove with confirmation
l = await tap(`r:${state.subs.find((s) => s.name === "Canva").id}`);
assert.match(texts(l), /Stop tracking Canva/);
l = await tap(buttons(l).find((b) => b.text.startsWith("Yes")).callback_data);
assert.match(texts(l), /Canva removed/);
assert.equal(state.subs.length, 2);

// Typed shortcuts still work
l = await type("/cost netflix 5200");
assert.equal(nf.cost, 5200);
l = await type("/add Spotify | 12/10/2026 | monthly | music@gmail.com | 1900");
assert.match(texts(l), /Spotify added/);

// Strangers are ignored completely
const before = JSON.stringify(state);
l = await type("/add Hack | today | monthly", 999);
l = await tap("menu", 999);
assert.equal(JSON.stringify(state), before);
assert.equal(l.filter((x) => x.method !== "answerCallbackQuery").length, 0);

// Tapping a deleted subscription's old button
l = await tap("p:zzzzzz");
assert.match(texts(l), /no longer exists/);

// --- currencies
// add with currency button
await tap("add");
await type("ChatGPT Plus");
await tap("ad:today");
await tap("ac:monthly");
await tap("askip");
l = await tap("acur:USD");
assert.match(texts(l), /in \$\?/);
l = await type("20");
assert.match(texts(l), /Amount: \$20/);
const gpt = state.subs.find((s) => s.name === "ChatGPT Plus");
assert.equal(gpt.currency, "USD");

// add by typing the sign directly
await tap("add");
await type("Figma");
await tap("ad:today");
await tap("ac:monthly");
await tap("askip");
l = await type("€15");
assert.match(texts(l), /Amount: €15/);

// change amount keeps currency, or switches via button
l = await tap(`c:${gpt.id}`);
assert.match(texts(l), /Current amount for ChatGPT Plus: \$20/);
assert.ok(findBtn(l, "€ Euro"));
await type("25");
assert.equal(gpt.cost, 25); assert.equal(gpt.currency, "USD");
await tap(`c:${gpt.id}`);
l = await tap(`cc:${gpt.id}:NGN`);
assert.match(texts(l), /amount in ₦/);
l = await type("32,000");
assert.match(texts(l), /updated to ₦32,000/);
assert.equal(gpt.currency, "NGN");
l = await type("/cost chatgpt $25");
assert.match(texts(l), /updated to \$25/);

// HR message uses the right currency
await tap(`h:${gpt.id}`);
assert.match(texts(log), /Plan cost: \$25/);

// old subscriptions without a currency default to Naira
assert.match(texts(await tap(`s:${nf.id}`)), /Amount: ₦5,200/);

// --- reports
{
  const env2 = { TELEGRAM_CHAT_ID: String(CHAT) };
  const st = emptyState(env2);
  const out = [];
  const tg2 = async (m, p) => { out.push({ method: m, ...p }); return { ok: true }; };
  const now2 = at("2026-10-26");
  const T = (t) => handleUpdate(st, { message: { chat: { id: CHAT }, text: t } }, tg2, env2, now2);
  const C = (d) => handleUpdate(st, { callback_query: { id: "q", data: d, message: { chat: { id: CHAT }, message_id: 9 } } }, tg2, env2, now2);
  await T("/add Netflix | 20/09/2026 | monthly | a@gmail.com | 4400");      // due 20 Oct -> expired 6d
  await T("/add Spotify | 24/09/2026 | monthly | | 1900");                   // due 24 Oct -> expired 2d
  await T("/add Claude | 26/09/2026 | monthly | b@gmail.com | $149.63");    // due TODAY
  await T("/add Canva | 29/10/2025 | yearly | | €110");                      // due 29 Oct -> 3 days
  await T("/add DStv | 15/10/2026 | monthly | | 15700");                     // due 15 Nov -> 20 days

  out.length = 0; await C("rx");
  let t = out.find((x) => x.text).text;
  assert.match(t, /Expired \(not yet renewed\) \(2\)/);
  assert.match(t, /1\. 🔴 Netflix — expired 6 days ago/);
  assert.match(t, /2\. 🔴 Spotify — expired 2 days ago/);
  assert.match(t, /Total to renew: ₦6,300/);
  assert.doesNotMatch(t, /Claude|Canva|DStv/);

  out.length = 0; await C("rs");
  t = out.find((x) => x.text).text;
  assert.match(t, /Due in 5 days or less \(2\)/);
  assert.match(t, /1\. 🟡 Claude — expires TODAY[\s\S]*\$149\.63/);
  assert.match(t, /2\. 🟡 Canva — 3 days left/);
  assert.match(t, /Total due soon: \$149\.63 \+ €110|Total due soon: €110 \+ \$149\.63/);
  assert.doesNotMatch(t, /Netflix|DStv/);

  out.length = 0; await C("ra");
  t = out.find((x) => x.text).text;
  assert.match(t, /Active subscriptions \(3\)/);
  assert.match(t, /🟢 DStv — 20 days left/);
  assert.doesNotMatch(t, /Netflix|Spotify/);
  const kb = out.find((x) => x.text).reply_markup.inline_keyboard.flat().map((b) => b.text);
  assert.ok(kb.includes("Claude") && kb.includes("⬅️ Menu"));

  out.length = 0; await T("/expired");
  assert.match(out.find((x) => x.text).text, /Netflix/);
  const empty = emptyState(env2); out.length = 0;
  await handleUpdate(empty, { callback_query: { id: "q", data: "rx", message: { chat: { id: CHAT }, message_id: 9 } } }, tg2, env2, now2);
  assert.match(out.find((x) => x.text).text, /Nothing has expired/);
  if (VERBOSE) for (const k of ["rx", "rs", "ra"]) { out.length = 0; await C(k); console.log("\n" + out.find((x) => x.text).text); }
}

console.log("✅ All tests passed");
