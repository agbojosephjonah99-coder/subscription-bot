// Upstash Redis (Vercel Marketplace → Storage) via its REST API. No packages needed.
import { emptyState } from "./core.js";

const KEY = "subbot:state";

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

export async function loadState() {
  const raw = await redis(["GET", KEY]);
  return raw ? JSON.parse(raw) : emptyState(process.env);
}

export async function saveState(state) {
  await redis(["SET", KEY, JSON.stringify(state)]);
}

export async function checkStore() {
  await redis(["PING"]);
}
