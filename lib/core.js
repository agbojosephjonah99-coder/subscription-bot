// Subscription bot logic: dates, menus/buttons, conversations and reminders.
// Platform-independent: every function receives `state` (plain object that is
// saved afterwards) and `tg(method, params)` for Telegram API calls.

// ------------------------------------------------------------------ dates
const TZ_OFFSET_MS = 60 * 60 * 1000; // Nigeria (WAT, UTC+1)
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const CYCLES = {
  weekly: ["d", 7], monthly: ["m", 1], quarterly: ["m", 3], yearly: ["m", 12],
};

const toDate = (iso) => new Date(iso + "T00:00:00Z");
const toISO = (dt) => dt.toISOString().slice(0, 10);

export function todayISO(now = Date.now()) {
  return toISO(new Date(now + TZ_OFFSET_MS));
}

export function daysFrom(aISO, bISO) {
  return Math.round((toDate(bISO) - toDate(aISO)) / DAY_MS);
}

export function addMonths(iso, n) {
  const d = toDate(iso);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(y, m, Math.min(day, last))));
}

export function nextDue(sub) {
  const c = sub.cycle;
  const [unit, n] = CYCLES[c] || [c.slice(-1), parseInt(c, 10)];
  return unit === "d"
    ? toISO(new Date(toDate(sub.last_paid).getTime() + n * DAY_MS))
    : addMonths(sub.last_paid, n);
}

export function fmt(iso) {
  const d = toDate(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function when(days) {
  if (days === 0) return "TODAY";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function parseDate(input, today) {
  const s = String(input).trim().toLowerCase();
  if (s === "today" || s === "") return today;
  if (s === "yesterday") return toISO(new Date(toDate(today).getTime() - DAY_MS));
  let y, m, d, mt;
  if ((mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = mt;
  else if ((mt = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/))) {
    [, d, m, y] = mt;
    if (y.length === 2) y = "20" + y;
  } else throw new Error(`I couldn't read the date “${input}”. Use DD/MM/YYYY, e.g. 20/10/2026.`);
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d)
    throw new Error(`“${input}” isn't a real date. Use DD/MM/YYYY, e.g. 20/10/2026.`);
  return toISO(dt);
}

export function parseCycle(input) {
  const s = String(input).trim().toLowerCase();
  const alias = { annual: "yearly", annually: "yearly", year: "yearly", month: "monthly", week: "weekly" };
  if (CYCLES[s]) return s;
  if (alias[s]) return alias[s];
  if (/^\d+[dm]$/.test(s) && parseInt(s, 10) > 0) return s;
  throw new Error(`Unknown billing cycle “${input}”. Tap a button, or type e.g. 30d (days) or 6m (months).`);
}

export const CURRENCIES = {
  NGN: { sym: "₦", name: "Naira" },
  USD: { sym: "$", name: "Dollar" },
  EUR: { sym: "€", name: "Euro" },
};

// "₦4,400", "N4400", "$15", "15 usd", "€9.99", "9,99 eur", "4400" -> { amount, currency | null }
export function parseAmount(input) {
  const raw = String(input).trim();
  let currency = null;
  if (/₦|ngn|naira|^n\s*\d/i.test(raw)) currency = "NGN";
  else if (/\$|usd|dollar/i.test(raw)) currency = "USD";
  else if (/€|eur|euro/i.test(raw)) currency = "EUR";
  let num = raw.replace(/[^\d.,]/g, "");
  if (/^\d+,\d{1,2}$/.test(num)) num = num.replace(",", "."); // 9,99 -> 9.99
  else num = num.replace(/,/g, "");
  const amount = Number(num);
  if (!num || !isFinite(amount) || amount < 0)
    throw new Error(`I couldn't read the amount “${input}”. Type a number, e.g. 4400 or $15.`);
  return { amount, currency };
}

export function parseCost(input) {
  return parseAmount(input).amount;
}

export function money(v, currency = "NGN") {
  if (v === null || v === undefined) return null;
  const c = CURRENCIES[currency] || CURRENCIES.NGN;
  const n = Number(v);
  return c.sym + n.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2,
  });
}

const sym = (sub) => (CURRENCIES[sub.currency] || CURRENCIES.NGN).sym;
const subMoney = (sub) => money(sub.cost, sub.currency);

export function normalizePhone(input) {
  let digits = String(input).replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 11) digits = "234" + digits.slice(1);
  if (digits.length < 10 || digits.length > 15)
    throw new Error(`“${input}” doesn't look like a phone number. e.g. 08031234567`);
  return digits;
}

const cycleLabel = (c) => (CYCLES[c] ? c[0].toUpperCase() + c.slice(1)
  : c.endsWith("d") ? `Every ${parseInt(c, 10)} days` : `Every ${parseInt(c, 10)} months`);

// ------------------------------------------------------------------ state
export function emptyState(env = {}) {
  return { subs: [], hr: env.HR_WHATSAPP || "", pending: null };
}

function newId(state) {
  let id;
  do id = Math.random().toString(36).slice(2, 8);
  while (state.subs.some((s) => s.id === id));
  return id;
}

const byId = (state, id) => state.subs.find((s) => s.id === id);

function byName(state, name) {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const exact = state.subs.find((s) => s.name.toLowerCase() === n);
  if (exact) return exact;
  const starts = state.subs.filter((s) => s.name.toLowerCase().startsWith(n));
  return starts.length === 1 ? starts[0] : null;
}

function hrNumber(state, env) {
  const n = state.hr || env.HR_WHATSAPP || "";
  try { return n ? normalizePhone(n) : ""; } catch { return ""; }
}

// ------------------------------------------------------------------ views
const btn = (text, data) => ({ text, callback_data: data });

function status(sub, today) {
  const left = daysFrom(today, nextDue(sub));
  if (left < 0) return { icon: "🔴", text: `expired ${-left}d ago`, left };
  if (left <= 5) return { icon: "🟡", text: left === 0 ? "due TODAY" : `due ${when(left)}`, left };
  return { icon: "🟢", text: `due ${when(left)}`, left };
}

export const MENU_KB = [
  [btn("➕ Add subscription", "add")],
  [btn("📋 My subscriptions", "list")],
  [btn("🔴 Expired", "rx"), btn("🟡 Due in ≤5 days", "rs")],
  [btn("🟢 Active (days left)", "ra")],
  [btn("⚙️ Settings", "set"), btn("❓ Help", "help")],
];

function menuKb(env) {
  if (!env.BOT_USERNAME) return MENU_KB;
  const link = `https://t.me/${env.BOT_USERNAME}`;
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("This bot reminds me before my subscriptions expire. Try it:")}`;
  return [...MENU_KB, [{ text: "📣 Invite a friend", url: share }]];
}

// Totals per currency, e.g. "₦20,100 + $149.63"
function totals(subs) {
  const sum = {};
  for (const s of subs) if (s.cost !== null && s.cost !== undefined) {
    const c = s.currency || "NGN";
    sum[c] = (sum[c] || 0) + Number(s.cost);
  }
  const parts = Object.entries(sum).map(([c, v]) => money(Math.round(v * 100) / 100, c));
  const missing = subs.filter((s) => s.cost === null || s.cost === undefined).length;
  if (!parts.length) return null;
  return parts.join(" + ") + (missing ? ` (+${missing} without an amount)` : "");
}

// One-message reports: rx = expired, ra = active, rs = due within 5 days
function reportView(state, today, kind) {
  const rows = state.subs
    .map((s) => ({ s, due: nextDue(s), left: daysFrom(today, nextDue(s)) }))
    .filter(({ left }) => (kind === "rx" ? left < 0 : kind === "rs" ? left >= 0 && left <= 5 : left >= 0))
    .sort((a, b) => a.left - b.left);
  const title = {
    rx: "🔴 Expired (not yet renewed)",
    rs: "🟡 Due in 5 days or less",
    ra: "🟢 Active subscriptions",
  }[kind];
  const empty = {
    rx: "Nothing has expired. 🎉",
    rs: "Nothing is due in the next 5 days. 🎉",
    ra: "No active subscriptions.",
  }[kind];
  const back = [btn("⬅️ Menu", "menu"), btn("📋 All", "list")];
  if (!rows.length) return { text: `${title}

${empty}`, kb: [back] };

  const lines = rows.map(({ s, due, left }, i) => {
    const when2 = left < 0 ? `expired ${-left} day${left === -1 ? "" : "s"} ago`
      : left === 0 ? "expires TODAY" : `${left} day${left === 1 ? "" : "s"} left`;
    const icon = left < 0 ? "🔴" : left <= 5 ? "🟡" : "🟢";
    const extra = [subMoney(s), s.email].filter(Boolean).join(" · ");
    return `${i + 1}. ${icon} ${s.name} — ${when2}\n     ${fmt(due)}${extra ? " · " + extra : ""}`;
  });
  const total = totals(rows.map((r) => r.s));
  const label = { rx: "Total to renew", rs: "Total due soon", ra: "Total per cycle" }[kind];
  const text = `${title} (${rows.length})\n\n${lines.join("\n")}` + (total ? `\n\n💰 ${label}: ${total}` : "")
    + "\n\nTap one to manage it:";
  // Quick-open buttons, two per row
  const kb = [];
  for (let i = 0; i < rows.length; i += 2) {
    kb.push(rows.slice(i, i + 2).map(({ s }) => btn(s.name.slice(0, 30), `s:${s.id}`)));
  }
  kb.push(back);
  return { text, kb };
}

export const WELCOME = `👋 Welcome to Subscription Reminder!

I keep track of your subscriptions (Netflix, DStv, ChatGPT, Canva… in ₦, $ or €) and message you:
🔔 5 days and ⏰ 2 days before they expire
🚨 on the day they expire, with a ready message for HR/your boss
⚠️ if they expire and you haven't renewed

Your list is private: only you can see it.
Tap ➕ Add subscription to start.`;

function menuView(state, env = {}) {
  const n = state.subs.length;
  const text = n === 0
    ? WELCOME
    : `📋 Subscription Bot\n\nYou're tracking ${n} subscription${n === 1 ? "" : "s"}.\nWhat would you like to do?`;
  return { text, kb: menuKb(env) };
}

function settingsView(state, env) {
  const hr = hrNumber(state, env);
  return {
    text: `⚙️ Settings\n\n📞 HR WhatsApp number: ${hr ? "+" + hr : "not set"}\n✍️ Your name (end of HR messages): ${signName(state, env) || "not set"}`,
    kb: [
      [btn("📞 HR number", "hr"), btn("✍️ Your name", "nm")],
      [btn("🗑 Delete all my data", "del")],
      [btn("⬅️ Menu", "menu")],
    ],
  };
}

function signName(state, env) {
  return state.name || env.SIGN_NAME || "";
}

function listView(state, today) {
  if (!state.subs.length) {
    return { text: "You have no subscriptions yet.\nTap ➕ Add subscription to start.", kb: [[btn("➕ Add subscription", "add")], [btn("⬅️ Menu", "menu")]] };
  }
  const subs = [...state.subs].sort((a, b) => nextDue(a).localeCompare(nextDue(b)));
  const kb = subs.map((s) => {
    const st = status(s, today);
    return [btn(`${st.icon} ${s.name} · ${st.text}`, `s:${s.id}`)];
  });
  kb.push([btn("➕ Add subscription", "add"), btn("⬅️ Menu", "menu")]);
  return { text: "📋 Your subscriptions\n🟢 fine · 🟡 due within 5 days · 🔴 expired\n\nTap one to manage it:", kb };
}

function subText(sub, today) {
  const due = nextDue(sub);
  const st = status(sub, today);
  return [
    `${st.icon} ${sub.name}`,
    "",
    `Status: ${st.left < 0 ? `EXPIRED ${-st.left} day(s) ago` : st.text}`,
    `Next payment: ${fmt(due)}`,
    `Last paid: ${fmt(sub.last_paid)}`,
    `Billing: ${cycleLabel(sub.cycle)}`,
    `Amount: ${subMoney(sub) || "not set"}`,
    `Email: ${sub.email || "not set"}`,
  ].join("\n");
}

function subView(sub, today) {
  const id = sub.id;
  return {
    text: subText(sub, today),
    kb: [
      [btn("✅ Paid today", `p:${id}`), btn("📅 Paid on a date", `pd:${id}`)],
      [btn("💰 Change amount", `c:${id}`), btn("✏️ Edit details", `e:${id}`)],
      [btn("📲 Send to HR", `h:${id}`), btn("🗑 Remove", `r:${id}`)],
      [btn("⬅️ Back to list", "list")],
    ],
  };
}

function editView(sub) {
  const id = sub.id;
  return {
    text: `✏️ Edit ${sub.name}\nWhat do you want to change?`,
    kb: [
      [btn("🏷 Name", `en:${id}`), btn("📧 Email", `ee:${id}`)],
      [btn("🔁 Billing cycle", `ec:${id}`), btn("📅 Last paid date", `pd:${id}`)],
      [btn("💰 Amount", `c:${id}`)],
      [btn("⬅️ Back", `s:${id}`)],
    ],
  };
}

function cycleKb(prefix) {
  return [
    [btn("Weekly", `${prefix}weekly`), btn("Monthly", `${prefix}monthly`)],
    [btn("Quarterly", `${prefix}quarterly`), btn("Yearly", `${prefix}yearly`)],
  ];
}

const CANCEL_ROW = [btn("✖️ Cancel", "cancel")];

function currencyRow(prefix) {
  return Object.entries(CURRENCIES).map(([code, c]) => btn(`${c.sym} ${c.name}`, `${prefix}${code}`));
}

export const HELP = `❓ How to use

Quick reports from the menu:
🔴 Expired – everything that has expired, in one message
🟡 Due in ≤5 days – what needs paying soon, with the total
🟢 Active – everything still running, with days left

Tap 📋 My subscriptions to see everything, then tap any subscription to:
✅ mark it paid · 💰 change the amount · ✏️ edit details · 📲 send the HR message · 🗑 remove it

Reminders (every morning around 8–9 AM):
🔔 5 days before expiry
⏰ 2 days before
🚨 on expiry day + a ready message for HR (tap 📲 to send on WhatsApp)
⚠️ 2 days and 🔴 5 days after expiry if not renewed

Quick typing (optional):
/add Netflix | 20/10/2026 | monthly | me@gmail.com | $15.49
/paid Netflix   ·   /cost Netflix 5000   ·   /cost Spotify $12
⚙️ Settings: your HR number, your name for HR messages, or delete all your data.

/menu · /list · /expired · /soon · /active · /settings · /cancel`;

// ------------------------------------------------------------------ HR message
export function hrMessage(sub, due, today, env) {
  const lines = [
    "Hello HR,",
    "",
    `The ${sub.name} subscription is due for renewal ${due === today ? "today, " : "on "}${fmt(due)}.`,
    "",
    `• Platform: ${sub.name}`,
  ];
  if (sub.email) lines.push(`• Account email: ${sub.email}`);
  lines.push(
    `• Billing cycle: ${cycleLabel(sub.cycle)}`,
    `• Plan cost: ${subMoney(sub) || sym(sub) + "______ (to be confirmed)"}`,
    "",
    "Kindly approve/process the renewal payment so the service is not interrupted.",
    "",
    "Thank you.",
  );
  if (env.SIGN_NAME) lines.push(env.SIGN_NAME);  // the user's own name (see makeCtx)
  return lines.join("\n");
}

function hrKb(state, sub, text, env) {
  const num = hrNumber(state, env);
  const url = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  return [
    [{ text: num ? "📲 Send to HR on WhatsApp" : "📲 Share on WhatsApp", url }],
    [btn("💰 Change amount", `c:${sub.id}`), btn("✅ I've paid", `p:${sub.id}`)],
  ];
}

async function sendHr(ctx, sub) {
  const { state, env, today } = ctx;
  const text = hrMessage(sub, nextDue(sub), today, env);
  await ctx.send(text, hrKb(state, sub, text, env));
  if (!hrNumber(state, env)) {
    await ctx.send("ℹ️ Tip: save HR's number so the button opens her chat directly.", [[btn("📞 Set HR number", "hr")]]);
  }
}

// ------------------------------------------------------------------ add flow
async function askAddStep(ctx) {
  const p = ctx.state.pending;
  const name = p.draft.name;
  switch (p.step) {
    case "name":
      return ctx.send("➕ New subscription\n\nWhat's the platform called?\n(e.g. Netflix, DStv Compact, Canva)", [CANCEL_ROW]);
    case "date":
      return ctx.send(`📅 When did you last pay for ${name}?\nTap a button or type the date (DD/MM/YYYY).`,
        [[btn("Today", "ad:today"), btn("Yesterday", "ad:yesterday")], CANCEL_ROW]);
    case "cycle":
      return ctx.send(`🔁 How often do you pay for ${name}?\n(Or type e.g. 30d for every 30 days, 6m for every 6 months)`,
        [...cycleKb("ac:"), CANCEL_ROW]);
    case "email":
      return ctx.send(`📧 Which email do you use for ${name}?`, [[btn("Skip", "askip")], CANCEL_ROW]);
    case "cost":
      if (p.draft.currency) {
        return ctx.send(`💰 How much is ${name} per ${cycleLabel(p.draft.cycle).toLowerCase()} payment, in ${CURRENCIES[p.draft.currency].sym}?\nType the amount (e.g. ${p.draft.currency === "NGN" ? "4400" : "15"}):`,
          [[btn("Skip", "askip")], CANCEL_ROW]);
      }
      return ctx.send(`💰 How much is ${name} per ${cycleLabel(p.draft.cycle).toLowerCase()} payment?\nTap the currency, or type the amount with its sign (e.g. ₦4,400 · $15 · €9.99):`,
        [currencyRow("acur:"), [btn("Skip", "askip")], CANCEL_ROW]);
  }
}

const ADD_ORDER = ["name", "date", "cycle", "email", "cost"];

async function addInput(ctx, value, skipped = false) {
  const { state, today } = ctx;
  const p = state.pending;
  const v = typeof value === "string" ? value.trim() : value;
  if (!skipped) {
    switch (p.step) {
      case "name": {
        if (!v) return ctx.send("Please type a name.", [CANCEL_ROW]);
        if (state.subs.some((s) => s.name.toLowerCase() === v.toLowerCase()))
          return ctx.send(`You already have “${v}”. Type a different name, or cancel and edit the existing one.`, [CANCEL_ROW]);
        p.draft.name = v.slice(0, 60);
        break;
      }
      case "date": p.draft.last_paid = parseDate(v, today); break;
      case "cycle": p.draft.cycle = parseCycle(v); break;
      case "email": p.draft.email = v.slice(0, 100); break;
      case "cost": {
        const a = parseAmount(v);
        p.draft.cost = a.amount;
        p.draft.currency = a.currency || p.draft.currency || "NGN";
        break;
      }
    }
  }
  const next = ADD_ORDER[ADD_ORDER.indexOf(p.step) + 1];
  if (next) {
    p.step = next;
    return askAddStep(ctx);
  }
  const sub = {
    id: newId(state), name: p.draft.name, last_paid: p.draft.last_paid, cycle: p.draft.cycle,
    email: p.draft.email || "", cost: p.draft.cost ?? null, currency: p.draft.currency || "NGN", sent: [],
  };
  state.subs.push(sub);
  state.pending = null;
  const v2 = subView(sub, today);
  await ctx.send(`✅ ${sub.name} added!\n\n` + v2.text, v2.kb);
  return checkOne(ctx, sub); // e.g. added on the day it expires
}

// ------------------------------------------------------------------ actions
async function markPaid(ctx, sub, dateISO) {
  sub.last_paid = dateISO;
  sub.sent = [];
  const due = nextDue(sub);
  const text = `🎉 ${sub.name} has been subscribed!\n\nPaid on: ${fmt(dateISO)}\nNext payment due: ${fmt(due)}\nI'll remind you 5 days and 2 days before.`;
  const kb = [[btn("📋 My subscriptions", "list"), btn("⬅️ Menu", "menu")]];
  if (ctx.messageId) return ctx.edit(text, kb);
  return ctx.send(text, kb);
}

async function costUpdated(ctx, sub) {
  const { today } = ctx;
  const left = daysFrom(today, nextDue(sub));
  await ctx.send(`💰 ${sub.name} amount updated to ${subMoney(sub)}.`,
    [[btn(`⬅️ Back to ${sub.name}`.slice(0, 60), `s:${sub.id}`), btn("📋 List", "list")]]);
  if (left <= 0) {
    await ctx.send("Here's the updated message for HR 👇");
    await sendHr(ctx, sub);
  }
}

async function handlePendingText(ctx, text) {
  const { state, today } = ctx;
  const p = state.pending;
  if (p.kind === "add") return addInput(ctx, text);
  if (p.kind === "hr") {
    state.hr = normalizePhone(text);
    state.pending = null;
    return ctx.send(`✅ HR WhatsApp number saved: +${state.hr}`, [[btn("⚙️ Settings", "set"), btn("⬅️ Menu", "menu")]]);
  }
  if (p.kind === "myname") {
    const n = text.trim().slice(0, 60);
    if (!n) return ctx.send("Please type your name.", [CANCEL_ROW]);
    state.name = n;
    state.pending = null;
    return ctx.send(`✅ Saved. HR messages will be signed “${n}”.`, [[btn("⚙️ Settings", "set"), btn("⬅️ Menu", "menu")]]);
  }
  const sub = byId(state, p.id);
  if (!sub) { state.pending = null; return ctx.send("That subscription no longer exists.", menuKb(ctx.env)); }
  switch (p.kind) {
    case "cost":
      {
        const a = parseAmount(text);
        sub.cost = a.amount;
        sub.currency = a.currency || p.currency || sub.currency || "NGN";
        state.pending = null;
        return costUpdated(ctx, sub);
      }
    case "paiddate": {
      const d = parseDate(text, today); state.pending = null;
      return markPaid(ctx, sub, d);
    }
    case "email":
      sub.email = text.trim().slice(0, 100); state.pending = null;
      return ctx.send(`📧 Email for ${sub.name} updated.`, subView(sub, today).kb);
    case "name": {
      const n = text.trim().slice(0, 60);
      if (!n) return ctx.send("Please type a name.", [CANCEL_ROW]);
      sub.name = n; state.pending = null;
      return ctx.send(`🏷 Renamed to ${sub.name}.`, subView(sub, today).kb);
    }
    case "cycle":
      sub.cycle = parseCycle(text); state.pending = null;
      return ctx.send(`🔁 ${sub.name} is now billed ${cycleLabel(sub.cycle).toLowerCase()}. Next payment: ${fmt(nextDue(sub))}`, subView(sub, today).kb);
  }
}

async function handleCallback(ctx, data) {
  const { state, today } = ctx;
  const [action, id, extra] = data.split(":");
  const sub = id ? byId(state, id) : null;
  const needsSub = !["menu", "list", "rx", "rs", "ra", "set", "nm", "del", "delyes", "add", "hr", "help", "cancel", "ad", "ac", "askip", "acur"].includes(action);
  if (needsSub && !sub) return ctx.edit("That subscription no longer exists.", listView(state, today).kb);

  switch (action) {
    case "menu": state.pending = null; { const v = menuView(state, ctx.env); return ctx.edit(v.text, v.kb); }
    case "list": state.pending = null; { const v = listView(state, today); return ctx.edit(v.text, v.kb); }
    case "rx": case "rs": case "ra": state.pending = null; { const v = reportView(state, today, action); return ctx.edit(v.text, v.kb); }
    case "help": return ctx.edit(HELP, [[btn("⬅️ Menu", "menu")]]);
    case "cancel":
      state.pending = null;
      return ctx.edit("Cancelled.", menuKb(ctx.env));
    case "add":
      state.pending = { kind: "add", step: "name", draft: {} };
      return askAddStep(ctx);
    case "acur": {
      const p = state.pending;
      if (!p || p.kind !== "add" || p.step !== "cost") return ctx.send("That step has expired. Tap ➕ Add subscription to start again.", menuKb(ctx.env));
      p.draft.currency = CURRENCIES[id] ? id : "NGN";
      return askAddStep(ctx);
    }
    case "ad": case "ac": case "askip": {
      const p = state.pending;
      if (!p || p.kind !== "add") return ctx.send("That step has expired. Tap ➕ Add subscription to start again.", menuKb(ctx.env));
      if (action === "askip") {
        if (!["email", "cost"].includes(p.step)) return;
        return addInput(ctx, null, true);
      }
      if (action === "ad" && p.step === "date") return addInput(ctx, id);
      if (action === "ac" && p.step === "cycle") return addInput(ctx, id);
      return;
    }
    case "set": { state.pending = null; const v = settingsView(state, ctx.env); return ctx.edit(v.text, v.kb); }
    case "nm":
      state.pending = { kind: "myname" };
      return ctx.send(`✍️ Your name for HR messages: ${signName(state, ctx.env) || "not set"}\n\nType your name:`, [CANCEL_ROW]);
    case "del":
      return ctx.edit("🗑 Delete ALL your subscriptions and settings?\nThis can't be undone.",
        [[btn("Yes, delete everything", "delyes")], [btn("No, keep my data", "set")]]);
    case "delyes":
      state.subs = []; state.hr = ""; state.name = ""; state.pending = null;
      state.__delete = true;
      return ctx.edit("✅ All your data has been deleted. Send /start any time to begin again.");
    case "hr": {
      state.pending = { kind: "hr" };
      const cur = hrNumber(state, ctx.env);
      return ctx.send(`📞 HR WhatsApp number: ${cur ? "+" + cur : "not set"}\n\nType the new number (e.g. 08031234567):`, [CANCEL_ROW]);
    }
    case "s": { state.pending = null; const v = subView(sub, today); return ctx.edit(v.text, v.kb); }
    case "e": { const v = editView(sub); return ctx.edit(v.text, v.kb); }
    case "p": return markPaid(ctx, sub, today);
    case "pd":
      state.pending = { kind: "paiddate", id: sub.id };
      return ctx.send(`📅 When did you pay for ${sub.name}? Type the date (DD/MM/YYYY):`, [CANCEL_ROW]);
    case "c":
      state.pending = { kind: "cost", id: sub.id };
      return ctx.send(`💰 Current amount for ${sub.name}: ${subMoney(sub) || "not set"}\n\nType the new amount in ${sym(sub)} (e.g. ${(sub.currency || "NGN") === "NGN" ? "5000" : "20"}), or tap a currency to switch:`,
        [currencyRow(`cc:${sub.id}:`), CANCEL_ROW]);
    case "cc": {
      const cur = CURRENCIES[extra] ? extra : "NGN";
      state.pending = { kind: "cost", id: sub.id, currency: cur };
      return ctx.edit(`💰 ${sub.name}: type the amount in ${CURRENCIES[cur].sym} (${CURRENCIES[cur].name}):`, [CANCEL_ROW]);
    }
    case "ee":
      state.pending = { kind: "email", id: sub.id };
      return ctx.send(`📧 Type the email you use for ${sub.name}:`, [CANCEL_ROW]);
    case "en":
      state.pending = { kind: "name", id: sub.id };
      return ctx.send(`🏷 Type the new name for ${sub.name}:`, [CANCEL_ROW]);
    case "ec":
      state.pending = { kind: "cycle", id: sub.id };
      return ctx.edit(`🔁 How often do you pay for ${sub.name}?\n(Or type e.g. 30d / 6m)`, [...cycleKb(`cy:${sub.id}:`), [btn("⬅️ Back", `e:${sub.id}`)]]);
    case "cy":
      sub.cycle = parseCycle(extra); state.pending = null;
      { const v = subView(sub, today); return ctx.edit(`🔁 Billing updated.\n\n` + v.text, v.kb); }
    case "h": return sendHr(ctx, sub);
    case "r":
      return ctx.edit(`🗑 Stop tracking ${sub.name}?`, [[btn("Yes, remove", `ry:${sub.id}`), btn("No, keep it", `s:${sub.id}`)]]);
    case "ry":
      state.subs = state.subs.filter((s) => s.id !== sub.id);
      { const v = listView(state, today); return ctx.edit(`🗑 ${sub.name} removed.\n\n` + v.text, v.kb); }
  }
}

// Typed commands (optional shortcuts)
async function handleCommand(ctx, cmd, args) {
  const { state, today } = ctx;
  state.pending = null;
  switch (cmd) {
    case "start": case "menu": { const v = menuView(state, ctx.env); return ctx.send(v.text, v.kb); }
    case "list": { const v = listView(state, today); return ctx.send(v.text, v.kb); }
    case "expired": { const v = reportView(state, today, "rx"); return ctx.send(v.text, v.kb); }
    case "soon": { const v = reportView(state, today, "rs"); return ctx.send(v.text, v.kb); }
    case "active": { const v = reportView(state, today, "ra"); return ctx.send(v.text, v.kb); }
    case "help": return ctx.send(HELP, [[btn("⬅️ Menu", "menu")]]);
    case "cancel": return ctx.send("Cancelled.", menuKb(ctx.env));
    case "add": {
      if (!args.trim()) { state.pending = { kind: "add", step: "name", draft: {} }; return askAddStep(ctx); }
      const parts = args.split("|").map((x) => x.trim());
      if (parts.length < 3 || !parts[0]) return ctx.send("Usage: /add Name | DD/MM/YYYY | monthly | email | amount\nOr just tap ➕ Add subscription.", menuKb(ctx.env));
      if (state.subs.some((s) => s.name.toLowerCase() === parts[0].toLowerCase()))
        return ctx.send(`You already have “${parts[0]}”. Open it from 📋 My subscriptions to change it.`, menuKb(ctx.env));
      const sub = {
        id: newId(state), name: parts[0].slice(0, 60), last_paid: parseDate(parts[1], today),
        cycle: parseCycle(parts[2]), email: parts[3] || "", cost: parts[4] ? parseAmount(parts[4]).amount : null,
        currency: (parts[4] && parseAmount(parts[4]).currency) || "NGN", sent: [],
      };
      state.subs.push(sub);
      const v = subView(sub, today);
      await ctx.send(`✅ ${sub.name} added!\n\n` + v.text, v.kb);
      return checkOne(ctx, sub);
    }
    case "paid": {
      const toks = args.trim().split(/\s+/).filter(Boolean);
      let date = today;
      if (toks.length > 1) { try { date = parseDate(toks[toks.length - 1], today); toks.pop(); } catch {} }
      const sub = byName(state, toks.join(" "));
      if (!sub) return ctx.send("I couldn't find that one. Pick it from the list:", listView(state, today).kb);
      return markPaid(ctx, sub, date);
    }
    case "cost": {
      const toks = args.trim().split(/\s+/).filter(Boolean);
      const sub = toks.length > 1 ? byName(state, toks.slice(0, -1).join(" ")) : null;
      if (!sub) return ctx.send("Usage: /cost Netflix 5000 — or open the subscription and tap 💰 Change amount.", listView(state, today).kb);
      const a = parseAmount(toks[toks.length - 1]);
      sub.cost = a.amount;
      if (a.currency) sub.currency = a.currency;
      return costUpdated(ctx, sub);
    }
    case "settings": { const v = settingsView(state, ctx.env); return ctx.send(v.text, v.kb); }
    case "deleteme": return ctx.send("🗑 Delete ALL your subscriptions and settings?\nThis can't be undone.",
      [[btn("Yes, delete everything", "delyes")], [btn("No, keep my data", "set")]]);
    case "hr": {
      if (!args.trim()) return handleCallback(ctx, "hr");
      state.hr = normalizePhone(args);
      return ctx.send(`✅ HR WhatsApp number saved: +${state.hr}`, [[btn("⬅️ Menu", "menu")]]);
    }
    default: { const v = menuView(state, ctx.env); return ctx.send(`I don't know /${cmd}.\n\n` + v.text, v.kb); }
  }
}

// ------------------------------------------------------------------ entry points
function makeCtx(state, tg, env, now, chatId, messageId) {
  env = { ...env, SIGN_NAME: signName(state, env) };
  return {
    state, env, today: todayISO(now), chatId, messageId,
    send: (text, kb) => tg("sendMessage", {
      chat_id: chatId, text, disable_web_page_preview: true,
      ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}),
    }),
    edit: (text, kb) => messageId
      ? tg("editMessageText", {
        chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true,
        ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}),
      })
      : tg("sendMessage", { chat_id: chatId, text, ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) }),
  };
}

export async function handleUpdate(state, update, tg, env, now = Date.now()) {
  const allowed = String(env.TELEGRAM_CHAT_ID);
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    if (String(chatId) !== allowed) return;
    const ctx = makeCtx(state, tg, env, now, chatId, cq.message?.message_id);
    try { await handleCallback(ctx, cq.data || ""); }
    catch (e) { await ctx.send(`⚠️ ${e.message}`); }
    return;
  }
  const msg = update.message;
  if (!msg || String(msg.chat?.id) !== allowed) return;
  const text = (msg.text || "").trim();
  const ctx = makeCtx(state, tg, env, now, msg.chat.id, null);
  try {
    const m = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
    if (m) return await handleCommand(ctx, m[1].toLowerCase(), m[2]);
    if (state.pending) return await handlePendingText(ctx, text);
    const v = menuView(state, ctx.env);
    return await ctx.send("Tap a button below 👇", v.kb);
  } catch (e) {
    const keepGoing = state.pending ? [CANCEL_ROW] : menuKb(ctx.env);
    return ctx.send(`⚠️ ${e.message}`, keepGoing);
  }
}

// Reminder for one subscription (used by the daily job and right after adding)
async function checkOne(ctx, s) {
  const { today, state, env } = ctx;
  const due = nextDue(s);
  const left = daysFrom(today, due);
  const key = due;
  const sent = (s.sent ||= []);
  const email = s.email ? `\nEmail: ${s.email}` : "";
  const kb = [[btn("✅ I've paid", `p:${s.id}`), btn("💰 Change amount", `c:${s.id}`)]];
  const mark = (...k) => k.forEach((x) => { if (!sent.includes(`${x}:${key}`)) sent.push(`${x}:${key}`); });
  const has = (x) => sent.includes(`${x}:${key}`);

  if (left === 0 && !has("today")) {
    mark("before5", "before2", "today");
    await ctx.send(
      `🚨 ${s.name} EXPIRES TODAY (${fmt(due)}).${email}\nAmount on record: ${subMoney(s) || "not set"}\n\n` +
      `👉 Check the current plan price on ${s.name}. If it changed, tap 💰 Change amount and I'll update the HR message.\n` +
      `Then tap 📲 on the next message to send it to HR.`, kb);
    await sendHr(ctx, s);
    return true;
  }
  if (left > 0 && left <= 2 && !has("before2")) {
    mark("before5", "before2");
    await ctx.send(`⏰ ${s.name} expires ${when(left)} (${fmt(due)}).${email}\nAmount: ${subMoney(s) || "not set"}`, kb);
    return true;
  }
  if (left > 2 && left <= 5 && !has("before5")) {
    mark("before5");
    await ctx.send(`🔔 ${s.name} expires ${when(left)} (${fmt(due)}).${email}\nAmount: ${subMoney(s) || "not set"}`, kb);
    return true;
  }
  if (left <= -5 && !has("after5")) {
    mark("after2", "after5");
    await ctx.send(`🔴 ${s.name} expired ${-left} days ago (${fmt(due)}) and is still NOT renewed.${email}\nOnce you subscribe, tap ✅ I've paid.`,
      [...kb, [btn("🗑 Not using it anymore", `r:${s.id}`)]]);
    return true;
  }
  if (left <= -2 && left > -5 && !has("after2")) {
    mark("after2");
    await ctx.send(`⚠️ ${s.name} expired ${-left} days ago (${fmt(due)}) and hasn't been renewed yet.${email}\nOnce you subscribe, tap ✅ I've paid.`, kb);
    return true;
  }
  return false;
}

export async function runReminders(state, tg, env, now = Date.now()) {
  const ctx = makeCtx(state, tg, env, now, env.TELEGRAM_CHAT_ID, null);
  let count = 0;
  for (const s of state.subs) if (await checkOne(ctx, s)) count++;
  return count;
}
