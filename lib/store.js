// Upstash Redis (Vercel Marketplace → Storage) via its REST API. No packages needed.
// Each Telegram user has their own record: subbot:u:<chatId>. subbot:users lists everyone.
import { emptyState } from "./core.js";

const USERS = "subbot:users";
const META = "subbot:meta";
const OLD_SINGLE_USER_KEY = "subbot:state"; // data from the single-user version
const userKey = (id) => `subbot:u:${id}`;

function creds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Database not connected. In Vercel: Storage → Upstash Redis → Connect to this project, then redeploy.");
  return { url, token };
}

async function redis(args) {
  const { url, token } = creds();
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const j = await r.json();
  if (j.error) throw new Error("Database error: " + j.error);
  return j.result;
}

export const isOwner = (id) => String(id) === String(process.env.TELEGRAM_CHAT_ID || "");

export async function loadUser(id) {
  let raw = await redis(["GET", userKey(id)]);
  let fresh = !raw;
  if (!raw && isOwner(id)) raw = await redis(["GET", OLD_SINGLE_USER_KEY]); // carry over your old list
  const state = raw ? JSON.parse(raw) : emptyState({});
  Object.defineProperty(state, "__fresh", { value: fresh, enumerable: false, writable: true });
  return state;
}

export async function saveUser(id, state) {
  if (state.__delete) {
    await redis(["DEL", userKey(id)]);
    await redis(["SREM", USERS, String(id)]);
    if (isOwner(id)) await redis(["DEL", OLD_SINGLE_USER_KEY]);
    return;
  }
  await redis(["SET", userKey(id), JSON.stringify(state)]);
  if (state.__fresh) await redis(["SADD", USERS, String(id)]);
}

export async function listUsers() {
  return (await redis(["SMEMBERS", USERS])) || [];
}

export async function countUsers() {
  return (await redis(["SCARD", USERS])) || 0;
}

export async function getMeta() {
  const raw = await redis(["GET", META]);
  return raw ? JSON.parse(raw) : {};
}

export async function setMeta(meta) {
  await redis(["SET", META, JSON.stringify(meta)]);
}

export async function checkStore() {
  await redis(["PING"]);
}
