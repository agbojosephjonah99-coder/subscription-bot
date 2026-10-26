# Subscription Reminder Bot — button version (Vercel)

A Telegram bot you control with **buttons** that tracks all your subscriptions (any platform,
any email) and reminds you:

- 🔔 **5 days** before a subscription expires
- ⏰ **2 days** before
- 🚨 **on the day** it expires — plus a ready message for HR with a **📲 Send to HR on WhatsApp** button
- ⚠️ **2 days** and 🔴 **5 days** after expiry if you haven't renewed
- 🎉 confirmation the moment you tap **✅ I've paid**

Buttons reply instantly. Reminders go out once every morning (between 8 and 9 AM Nigeria time).
Everything runs free on Vercel; no computer needs to stay on.

---

## Setup (about 15 minutes, one time)

You need: your bot token (from @BotFather), your chat ID (`5767935941`), a free
GitHub account and a free Vercel account.

> **Using the older GitHub version?** Delete its `.github` folder (or the whole old repo)
> first. The old version and this one can't run on the same bot at the same time.

### 1. Put the code on GitHub
1. On github.com, click **New repository** → name it `subscription-bot` → **Private** → Create.
2. Click **uploading an existing file**, drag in everything from this folder
   (`api`, `lib`, `test` folders and `package.json`, `vercel.json`, `README.md`) → **Commit changes**.

### 2. Create the project on Vercel
1. Go to **vercel.com** → sign up with your GitHub account.
2. Click **Add New… → Project**, pick your `subscription-bot` repo → **Import**.
3. Open **Environment Variables** on that same screen and add:

   | Name | Value | 
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | your bot token from @BotFather |
   | `TELEGRAM_CHAT_ID` | `5767935941` |
   | `CRON_SECRET` | any random password you make up, e.g. `pear-river-4419` |
   | `SIGN_NAME` | *(optional)* your name, for the end of HR messages |
   | `HR_WHATSAPP` | *(optional)* HR's number, e.g. `08031234567` (or set it later with a button) |

4. Click **Deploy** and wait for "Congratulations".

### 3. Add the free database
1. In your Vercel project, open the **Storage** tab → **Create Database**.
2. Choose **Upstash → Redis** (Serverless Redis), pick the **Free** plan, any region
   close to you (e.g. Frankfurt/eu-central), and **Create**.
3. When asked, **Connect** it to your `subscription-bot` project (all environments).
4. Go to **Deployments**, open the ⋯ menu on the latest one → **Redeploy**
   (so the bot picks up the database settings).

### 4. Connect Telegram
Open this in your browser (replace with your project's address, shown on the Vercel project page):

```
https://YOUR-PROJECT.vercel.app/api/setup
```

You should see **✅ Connected!** and your bot will send you a menu in Telegram.
If the page lists a problem (missing variable or database), fix it, redeploy, and open the link again.

---

## Using it

Everything is buttons. Send `/menu` anytime to bring the menu back.

**➕ Add subscription** — the bot asks one question at a time:
name → last payment date (**Today** / **Yesterday** / type a date) → billing cycle
(**Weekly / Monthly / Quarterly / Yearly**) → email (**Skip** allowed) → amount in ₦ (**Skip** allowed)

**📋 My subscriptions** — 🟢 fine · 🟡 due within 5 days · 🔴 expired. Tap one to:

| Button | What it does |
|---|---|
| ✅ Paid today | Marks it renewed and confirms "🎉 … has been subscribed!" |
| 📅 Paid on a date | Same, for a different payment date |
| 💰 Change amount | Type the new price; it's used in the next HR message |
| ✏️ Edit details | Change name, email, billing cycle or last paid date |
| 📲 Send to HR | Get the HR message with the WhatsApp button any time |
| 🗑 Remove | Stop tracking it (asks you to confirm) |

**📞 HR WhatsApp number** — set or change HR's number.

**On expiry day** you get the reminder plus the HR message. If the price changed, tap
**💰 Change amount**, type the new price, and the bot sends you an updated HR message.
Then tap **📲 Send to HR on WhatsApp**: WhatsApp opens on HR's chat with the message typed,
and you just press send.

Prefer typing? These still work: `/add Netflix | 20/10/2026 | monthly | me@gmail.com | 4400`,
`/paid Netflix`, `/cost Netflix 5000`, `/list`, `/help`, `/cancel`.

---

## Good to know
- Only your chat ID can use the bot; anyone else is ignored.
- Vercel's free plan runs the reminder job once a day, at some point between 8:00 and 8:59 AM
  Nigeria time. To change the hour, edit `vercel.json` (`"0 7 * * *"` = 07:00 UTC = 8 AM in Nigeria).
- Your data is stored in your own Upstash database.
- **Safety:** your bot token was shared in a chat. When everything works, send `/revoke` to
  @BotFather for a new token, update `TELEGRAM_BOT_TOKEN` in Vercel, redeploy, and open
  `/api/setup` again.
- To test the logic on your computer: `node test/test.mjs` (add `-v` to watch a sample conversation).
