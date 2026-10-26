// Multi-user test through the Vercel endpoints, with fake Telegram + Redis. Run: node test/multiuser.test.mjs
import assert from "node:assert/strict";

const OWNER = "5767935941", AMAKA = "1111", TUNDE = "2222";
Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: "123:ABC", TELEGRAM_CHAT_ID: OWNER, SIGN_NAME: "Joseph",
  HR_WHATSAPP: "08031234567", KV_REST_API_URL: "https://fake-redis", KV_REST_API_TOKEN: "t",
  CRON_SECRET: "pw", VERCEL_PROJECT_PRODUCTION_URL: "subscription-bot-phi.vercel.app",
});

const db = {}; const sets = {}; const sent = [];
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const ok = (result) => ({ json: async () => ({ result }) });
  if (url === "https://fake-redis") {
    const [cmd, k, v] = body;
    switch (cmd) {
      case "GET": return ok(db[k] ?? null);
      case "SET": db[k] = v; return ok("OK");
      case "DEL": delete db[k]; return ok(1);
      case "SADD": (sets[k] ||= new Set()).add(v); return ok(1);
      case "SREM": sets[k]?.delete(v); return ok(1);
      case "SMEMBERS": return ok([...(sets[k] || [])]);
      case "SCARD": return ok((sets[k] || new Set()).size);
      default: return ok("PONG");
    }
  }
  const method = url.split("/").pop();
  sent.push({ method, ...body });
  if (method === "getMe") return { json: async () => ({ ok: true, result: { username: "SubRemindBot" } }) };
  return { json: async () => ({ ok: true, result: {} }) };
};

const res = () => { const r = { code: 0, out: null, headers: {} };
  r.status = (c) => (r.code = c, r); r.send = (x) => (r.out = x, r); r.json = (x) => (r.out = x, r);
  r.setHeader = (k, v) => (r.headers[k] = v); return r; };
const root = new URL("..", import.meta.url).pathname;
const { webhookSecret } = await import(root + "lib/telegram.js");
const webhook = (await import(root + "api/telegram.js")).default;
const cron = (await import(root + "api/cron.js")).default;
const setup = (await import(root + "api/setup.js")).default;
const H = { "x-telegram-bot-api-secret-token": webhookSecret("123:ABC") };

const say = async (from, text, type = "private") => {
  sent.length = 0;
  await webhook({ method: "POST", headers: H, body: { message: { chat: { id: +from, type }, text } } }, res());
  return sent.filter((m) => m.text).map((m) => m.text).join("\n---\n");
};
const tap = async (from, data) => {
  sent.length = 0;
  await webhook({ method: "POST", headers: H, body: { callback_query: { id: "q", data, message: { chat: { id: +from, type: "private" }, message_id: 4 } } } }, res());
  return sent.filter((m) => m.text).map((m) => m.text).join("\n---\n");
};
const toChat = (id) => sent.filter((m) => String(m.chat_id) === id && m.text).map((m) => m.text).join("\n");

// Existing single-user data from the previous version belongs to the owner
db["subbot:state"] = JSON.stringify({ subs: [{ id: "abc123", name: "Netflix", last_paid: "2026-09-26", cycle: "monthly",
  email: "movies@gmail.com", cost: 4400, currency: "NGN", sent: [] }], hr: "", pending: null });

// Setup page: connects, sets profile, stores username, messages the owner
let r = res(); await setup({ headers: {} }, r);
assert.match(r.out, /Connected/); assert.match(r.out, /t\.me\/SubRemindBot/);
assert.ok(sent.find((m) => m.method === "setMyDescription"));
assert.ok(sent.find((m) => m.method === "setMyShortDescription").short_description.length <= 120);
assert.match(toChat(OWNER), /open to everyone[\s\S]*t\.me\/SubRemindBot/);

// Owner keeps their old list
let t = await say(OWNER, "/list");
assert.match(sent.find((m) => m.text).reply_markup.inline_keyboard.flat().map((b) => b.text).join(), /Netflix/);
assert.ok(db[`subbot:u:${OWNER}`] && sets["subbot:users"].has(OWNER));

// A new person gets a welcome and an empty, separate list
t = await say(AMAKA, "/start");
assert.match(t, /Welcome to Subscription Reminder/);
const kb = sent[0].reply_markup.inline_keyboard.flat();
assert.ok(kb.find((b) => b.text === "📣 Invite a friend" && b.url.includes("t.me%2FSubRemindBot")));
assert.match(await say(AMAKA, "/add Spotify | 24/09/2026 | monthly | amaka@gmail.com | $11.99"), /Spotify expired 2 days ago/);
t = await say(AMAKA, "/list");
assert.doesNotMatch(JSON.stringify(sent), /Netflix/);
t = await say(OWNER, "/expired");
assert.doesNotMatch(t, /Spotify/);

// Amaka sets her own HR number and name; owner's env values don't leak to her
await tap(AMAKA, "nm"); await say(AMAKA, "Amaka Obi");
await tap(AMAKA, "hr"); await say(AMAKA, "08099998888");
t = await tap(AMAKA, "set");
assert.match(t, /\+2348099998888[\s\S]*Amaka Obi/);
const amakaSub = JSON.parse(db[`subbot:u:${AMAKA}`]).subs[0];
sent.length = 0; await tap(AMAKA, `h:${amakaSub.id}`);
const hr = sent.find((m) => /Hello HR/.test(m.text || ""));
assert.match(hr.text, /Amaka Obi/); assert.doesNotMatch(hr.text, /Joseph/);
assert.match(hr.reply_markup.inline_keyboard[0][0].url, /wa\.me\/2348099998888/);

// Tunde has no settings: no owner HR number or name
assert.match(await say(TUNDE, "/add Canva | 26/10/2025 | yearly"), /Canva EXPIRES TODAY/);
sent.length = 0; const tSub = JSON.parse(db[`subbot:u:${TUNDE}`]).subs[0];
await tap(TUNDE, `h:${tSub.id}`);
const thr = sent.find((m) => /Hello HR/.test(m.text || ""));
assert.doesNotMatch(thr.text, /Joseph/);
assert.match(thr.reply_markup.inline_keyboard[0][0].url, /^https:\/\/wa\.me\/\?text=/);

// Owner's HR settings from Vercel still work for the owner
sent.length = 0; await tap(OWNER, "h:abc123");
assert.match(sent.find((m) => /Hello HR/.test(m.text || "")).text, /Joseph/);

// Daily job reminds each user in their own chat; Canva/Spotify were already reminded when added
sent.length = 0; r = res(); await cron({ headers: { authorization: "Bearer pw" } }, r);
assert.equal(r.out.users, 3);
assert.match(toChat(OWNER), /Netflix EXPIRES TODAY/);
assert.match(toChat(OWNER), /Hello HR[\s\S]*Joseph/);
assert.equal(toChat(TUNDE), ""); assert.equal(toChat(AMAKA), "");
sent.length = 0; await cron({ headers: { authorization: "Bearer pw" } }, res());
assert.equal(sent.length, 0, "no repeats");

// Stats for the owner only
assert.match(await say(OWNER, "/stats"), /3 people use your bot/);
assert.doesNotMatch(await say(AMAKA, "/stats"), /people use/);

// Groups are refused politely
assert.match(await say("-100555", "/start", "group"), /message me privately/);
assert.ok(!sets["subbot:users"].has("-100555"));

// Delete my data
await tap(TUNDE, "del");
t = await tap(TUNDE, "delyes");
assert.match(t, /deleted/);
assert.equal(db[`subbot:u:${TUNDE}`], undefined);
assert.ok(!sets["subbot:users"].has(TUNDE));
assert.match(await say(TUNDE, "/start"), /Welcome/);

// Setup page shows a readable error instead of a 500
delete process.env.TELEGRAM_BOT_TOKEN;
r = res(); await setup({ headers: {} }, r);
assert.equal(r.code, 200); assert.match(r.out, /Missing environment variable <b>TELEGRAM_BOT_TOKEN/);

console.log("✅ Multi-user tests passed");
