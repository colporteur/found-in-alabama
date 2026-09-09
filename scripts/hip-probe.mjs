// One-off Hip API probe (Phase HIP-0/1). Run locally on Windows:
//
//   node scripts/hip-probe.mjs
//
// Reads HIP_API_KEY / HIP_USERNAME from .env.local (never prints the key),
// then shows: rate-limit headers, the first page of your active store
// listings with the fields the sync depends on (id, external_id,
// external_id_type, private_id, quantity, active/closed), how many of
// them carry an external_id, and your paid sales from the last 30 days
// with their SaleListings. Read-only — no writes.

import { readFileSync } from "node:fs";

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no file */
  }
}
loadEnv(".env.local");
loadEnv(".env");

const key = process.env.HIP_API_KEY;
const user = process.env.HIP_USERNAME;
const base = process.env.HIP_API_BASE ?? "https://www.hippostcard.com/api";
if (!key || !user) {
  console.error("HIP_API_KEY and HIP_USERNAME must be set in .env.local");
  process.exit(1);
}

async function call(path, query = {}) {
  const url = new URL(base.replace(/\/$/, "") + path);
  for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "X-ApiKey": key, Accept: "application/json" } });
  const text = await res.text();
  console.log(`\n=== ${res.status} ${path}  (rate limit ${res.headers.get("x-ratelimit-remaining")}/${res.headers.get("x-ratelimit-limit")})`);
  if (!res.ok) {
    console.log(text.slice(0, 500));
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    console.log("non-JSON:", text.slice(0, 300));
    return null;
  }
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));

// 1. Active store listings, first page.
const listings = await call(`/stores/${encodeURIComponent(user)}/listings/active`, { limit: 100, page: 1 });
if (listings) {
  const rows = listings.results ?? [];
  console.log(`count reported: ${listings.count}, rows on page 1: ${rows.length}`);
  console.log("top-level keys of a listing:", Object.keys(rows[0] ?? {}).join(", "));
  for (const l of rows.slice(0, 5)) {
    console.log(pick(l, ["id", "name", "external_id", "external_id_type", "private_id", "quantity", "current_price", "active", "closed", "listing_type"]));
  }
  const withExt = rows.filter((l) => l.external_id != null && l.external_id !== "" && l.external_id !== 0).length;
  console.log(`\nexternal_id present on ${withExt} of ${rows.length} listings on this page`);
  const types = {};
  for (const l of rows) types[l.external_id_type ?? "(none)"] = (types[l.external_id_type ?? "(none)"] ?? 0) + 1;
  console.log("external_id_type breakdown:", types);
}

// 2. Paid sales, last 30 days.
const from = new Date(Date.now() - 30 * 86400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const sales = await call(`/stores/${encodeURIComponent(user)}/sales/paid`, { limit: 50, page: 1, created_time_from: from });
if (sales) {
  const rows = sales.results ?? [];
  console.log(`paid sales since ${from}: count ${sales.count}, rows ${rows.length}`);
  if (rows[0]) console.log("top-level keys of a sale:", Object.keys(rows[0]).join(", "));
  for (const s of rows.slice(0, 5)) {
    console.log(pick(s, ["id", "created_at", "buyer_username", "total", "sales_listings_amount", "postage_amount", "flag_payment_name", "flag_shipping_name"]));
    for (const sl of s.SaleListings ?? []) console.log("   line:", pick(sl, ["id", "listing_id", "listing_name", "price", "quantity", "private_id"]));
  }
}

// 3. All sales (incl. unpaid) — just the count, to see the shape of the other endpoint.
const all = await call(`/stores/${encodeURIComponent(user)}/sales/all`, { limit: 5, page: 1, created_time_from: from });
if (all) console.log(`all sales since ${from}: count ${all.count}`);

console.log("\nDone. Paste this output (it contains no secrets) back to Cowork.");
