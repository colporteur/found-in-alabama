// One-off analysis: price/count stats for The Ephemeral State segment.
// Run locally:  node scripts/tes-price-stats.mjs
// Reads POSTGRES_URL from .env.local, replicates the TES segment rule
// (category flagged is_ephemeral_state OR descended from one), and prints
// a JSON summary — no writes, read-only queries.

import { readFileSync } from "node:fs";
import { sql as vercelSql, createPool } from "@vercel/postgres";

// Minimal .env.local loader (avoid extra deps).
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const pool = createPool({ connectionString: process.env.POSTGRES_URL });

const { rows: cats } = await pool.query(
  `SELECT category_id, parent_category_id, name, is_ephemeral_state
   FROM ebay_store_categories`
);

const parentOf = new Map(cats.map((c) => [c.category_id, c.parent_category_id]));
const nameOf = new Map(cats.map((c) => [c.category_id, c.name]));
const flagged = new Set(cats.filter((c) => c.is_ephemeral_state).map((c) => c.category_id));
const qualifies = new Set();
for (const c of cats) {
  let cur = c.category_id, hops = 0;
  while (cur != null && hops < 20) {
    if (flagged.has(cur)) { qualifies.add(c.category_id); break; }
    cur = parentOf.get(cur) ?? null; hops++;
  }
}
const ids = [...qualifies];

const { rows: items } = await pool.query(
  `SELECT item_id, title, price::float AS price, quantity, listing_type,
          store_category_1_id AS c1, store_category_2_id AS c2,
          site_category_name
   FROM ebay_listings
   WHERE quantity > 0
     AND (store_category_1_id = ANY($1) OR store_category_2_id = ANY($1))`,
  [ids]
);

const prices = items.map((i) => i.price).filter((p) => p != null && isFinite(p)).sort((a, b) => a - b);
const q = (p) => prices.length ? prices[Math.min(prices.length - 1, Math.floor(p * prices.length))] : null;
const buckets = { "under5": 0, "5to9.99": 0, "10to19.99": 0, "20to49.99": 0, "50plus": 0 };
for (const p of prices) {
  if (p < 5) buckets["under5"]++;
  else if (p < 10) buckets["5to9.99"]++;
  else if (p < 20) buckets["10to19.99"]++;
  else if (p < 50) buckets["20to49.99"]++;
  else buckets["50plus"]++;
}

// Per TES store category: count + median price
const byCat = {};
for (const it of items) {
  for (const c of new Set([it.c1, it.c2].filter((x) => x && qualifies.has(x)))) {
    (byCat[c] ??= []).push(it.price);
  }
}
const catStats = Object.entries(byCat)
  .map(([c, ps]) => {
    const good = ps.filter((p) => p != null && isFinite(p)).sort((a, b) => a - b);
    return {
      category: nameOf.get(c) ?? c,
      count: ps.length,
      median: good.length ? good[Math.floor(good.length / 2)] : null,
    };
  })
  .sort((a, b) => b.count - a.count);

// eBay *site* category names hint at weight class (books vs paper vs objects)
const bySite = {};
for (const it of items) {
  const k = (it.site_category_name ?? "unknown").split(":")[0];
  bySite[k] = (bySite[k] ?? 0) + 1;
}
const siteTop = Object.entries(bySite).sort((a, b) => b[1] - a[1]).slice(0, 25);

const multiQty = items.filter((i) => i.quantity > 1).length;

console.log(JSON.stringify({
  totalItems: items.length,
  withPrice: prices.length,
  priceMin: prices[0] ?? null,
  priceMax: prices[prices.length - 1] ?? null,
  mean: prices.length ? +(prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2) : null,
  p10: q(0.10), p25: q(0.25), median: q(0.5), p75: q(0.75), p90: q(0.90),
  buckets,
  multiQuantityListings: multiQty,
  topSiteCategories: siteTop,
  categories: catStats,
}, null, 1));

await pool.end();
