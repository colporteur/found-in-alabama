// Phase HIP-3 — publish the TES pool to HipPostcard through Hip's API,
// replacing Hip's own "Sync with eBay" (which only ever imported postcards,
// holiday cards and generic Paper > Ephemera).
//
//   • Pool: every in-stock item in the TES selection (same rule as
//     theephemeralstate.com), price = the eBay price.
//   • Listings Hip's sync already made are ADOPTED: matched by the eBay
//     item id Hip stores in external_id, never recreated.
//   • New listings carry private_id "tes-ebay:<itemId>", so a repeat POST
//     updates instead of duplicating, and sales/closing (HIP-1/HIP-2) can
//     resolve them back to the eBay item.
//   • Each run creates at most `limit` listings (Hip allows 10,000 calls a
//     day); the workflow calls it every 10 minutes until the backlog clears.
//
// Safety rails: refuses to create anything unless HIP_PUBLISH_ENABLED=1,
// the Hip listing map was refreshed within 36 hours (so adopted listings
// are known), and the run isn't a dry run. Every write lands in
// hip_actions (create_hip / update_hip).

import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings, ebayStoreCategories, hipActions, hipListings } from "@/db/schema";
import { tesQualifyingSet } from "@/lib/tes/selection";
import { createOrUpdateListing, hipConfigured, HipApiError, updateListing, type HipListing } from "./client";
import { upsertHipListing } from "./ingest";
import { planHipPublish, summarizePlan, type MappedHipListing, type PlanRow, type PoolItem } from "./publish-plan";

const MAP_MAX_AGE_MS = 36 * 3600_000;
// Hip allows 10,000 calls/day. At 6 runs/hour: 45 creates + 15 price
// updates per run ≈ 8,640/day, leaving room for the sales poller and map walk.
const PRICE_UPDATES_PER_RUN = 15;

export type HipPublishOptions = {
  /** Max listings to create this run. */
  limit?: number;
  /** Plan only — no writes to Hip or the database. */
  dryRun?: boolean;
  /** Also push eBay price changes to listings already on Hip (max 15 per run). */
  prices?: boolean;
  /** Include up to this many sample rows per bucket in the response. */
  samples?: number;
};

export type HipPublishResult = {
  configured: boolean;
  enabled: boolean;
  dryRun: boolean;
  mapRefreshedAt: string | null;
  blocked: string | null;
  plan: ReturnType<typeof summarizePlan>;
  created: number;
  /** Hip answered 2xx but the reply had no listing id we could read. */
  createdWithoutId: number;
  updatedExisting: number;
  failed: number;
  priceUpdates: { attempted: number; ok: number; failed: number };
  errors: Array<{ itemId: string; detail: string }>;
  samples?: Record<string, Array<{ itemId: string; detail: string }>>;
};

async function loadPool(): Promise<PoolItem[]> {
  const cats = await db
    .select({
      categoryId: ebayStoreCategories.categoryId,
      parentCategoryId: ebayStoreCategories.parentCategoryId,
      isEphemeralState: ebayStoreCategories.isEphemeralState,
    })
    .from(ebayStoreCategories);
  const qualifying = [...tesQualifyingSet(cats)];
  if (!qualifying.length) return [];
  return db
    .select({
      itemId: ebayListings.itemId,
      title: ebayListings.title,
      price: ebayListings.price,
      quantity: ebayListings.quantity,
      description: ebayListings.description,
      primaryImageUrl: ebayListings.primaryImageUrl,
      imageUrls: ebayListings.imageUrls,
      siteCategoryId: ebayListings.siteCategoryId,
      siteCategoryName: ebayListings.siteCategoryName,
      listingType: ebayListings.listingType,
    })
    .from(ebayListings)
    .where(
      and(
        gt(ebayListings.quantity, 0),
        or(inArray(ebayListings.storeCategory1Id, qualifying), inArray(ebayListings.storeCategory2Id, qualifying))
      )
    )
    .orderBy(desc(ebayListings.itemId)); // newest eBay listings first
}

async function loadHipMap(): Promise<{ rows: MappedHipListing[]; refreshedAt: Date | null }> {
  const rows = await db
    .select({
      hipId: hipListings.hipId,
      externalId: hipListings.externalId,
      privateId: hipListings.privateId,
      title: hipListings.title,
      price: hipListings.price,
    })
    .from(hipListings)
    // Rows retired in the last 48h still count as "on Hip" for planning: a
    // map walk can miss a listing when others close mid-walk, and a false
    // "missing" must never turn into a duplicate listing.
    .where(sql`${hipListings.active} = true OR (${hipListings.closed} = false AND ${hipListings.lastSeenAt} > now() - interval '48 hours')`);
  // Freshness comes from rows only the map walk touches (Hip-sync
  // listings), so our own creates don't make a stale map look fresh.
  const [{ latest }] = await db
    .select({ latest: sql<Date | null>`max(${hipListings.lastSeenAt})` })
    .from(hipListings)
    .where(sql`coalesce(${hipListings.privateId}, '') not like 'tes-ebay:%'`);
  return { rows, refreshedAt: latest ? new Date(latest) : null };
}

async function loadFailedCreates(): Promise<Map<string, number>> {
  const rows = await db
    .select({ itemId: hipActions.itemId, n: sql<number>`count(*)::int` })
    .from(hipActions)
    .where(and(eq(hipActions.kind, "create_hip"), eq(hipActions.ok, false)))
    .groupBy(hipActions.itemId);
  return new Map(rows.filter((r) => r.itemId).map((r) => [r.itemId as string, Number(r.n)]));
}

async function log(kind: string, itemId: string, hipListingId: number | null, ok: boolean, detail: string) {
  await db.insert(hipActions).values({ kind, itemId, hipListingId, ok, detail: detail.slice(0, 1000) });
}

/**
 * Hip doesn't document the create response. Accept the listing at the top
 * level or under a wrapper key (listing / result / data / results[0]).
 */
export function extractHipListing(raw: unknown): (HipListing & { id: number }) | null {
  const candidates: unknown[] = [raw];
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    candidates.push(o.listing, o.Listing, o.result, o.data);
    if (Array.isArray(o.results)) candidates.push(o.results[0]);
  }
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const id = Number(o.id ?? o.listing_id ?? o.listingId);
    if (Number.isInteger(id) && id > 0) return { ...(o as HipListing), id };
  }
  return null;
}

const errText = (e: unknown) => (e instanceof HipApiError ? `HTTP ${e.status}: ${e.body.slice(0, 400)}` : e instanceof Error ? e.message : String(e));

/** Simple concurrency pool — Hip allows 10 requests/second. */
async function eachLimited<T>(items: T[], concurrency: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) {
        const t = items[i++];
        await fn(t);
        await new Promise((r) => setTimeout(r, 150));
      }
    })
  );
}

export async function runHipPublish(opts: HipPublishOptions = {}): Promise<HipPublishResult> {
  const limit = Math.max(0, Math.min(opts.limit ?? 45, 300));
  const enabled = process.env.HIP_PUBLISH_ENABLED === "1";
  const dryRun = opts.dryRun ?? !enabled;

  const [pool, map, failed] = await Promise.all([loadPool(), loadHipMap(), loadFailedCreates()]);
  const plan = planHipPublish(pool, map.rows, failed);

  const result: HipPublishResult = {
    configured: hipConfigured(),
    enabled,
    dryRun,
    mapRefreshedAt: map.refreshedAt?.toISOString() ?? null,
    blocked: null,
    plan: summarizePlan(plan),
    created: 0,
    createdWithoutId: 0,
    updatedExisting: 0,
    failed: 0,
    priceUpdates: { attempted: 0, ok: 0, failed: 0 },
    errors: [],
  };

  if (opts.samples) {
    const n = opts.samples;
    const pick = (k: PlanRow["kind"], f: (r: PlanRow) => string) => plan.filter((r) => r.kind === k).slice(0, n).map((r) => ({ itemId: r.itemId, detail: f(r) }));
    result.samples = {
      create: pick("create", (r) => (r.kind === "create" ? `${r.categoryName} — ${r.payload.name} — $${r.payload.buyout_price}` : "")),
      review: pick("review", (r) => (r.kind === "review" ? r.reason : "")),
      exclude: pick("exclude", (r) => (r.kind === "exclude" ? r.reason : "")),
      priceDrift: plan
        .filter((r): r is Extract<PlanRow, { kind: "on_hip" }> => r.kind === "on_hip" && r.priceDrift)
        .slice(0, n)
        .map((r) => ({ itemId: r.itemId, detail: `Hip $${r.hipPrice} vs eBay $${r.payload?.buyout_price} (hip #${r.hipId})` })),
    };
  }

  if (!result.configured) result.blocked = "HIP_API_KEY / HIP_USERNAME are not set";
  else if (!map.refreshedAt || map.rows.length === 0) result.blocked = "The Hip listing map is empty — run /api/cron/hip-map first";
  else if (Date.now() - map.refreshedAt.getTime() > MAP_MAX_AGE_MS) result.blocked = "The Hip listing map is older than 36 hours — run /api/cron/hip-map first";
  if (result.blocked || dryRun) return result;

  // ── Create ──────────────────────────────────────────────────────────────
  const toCreate = plan.filter((r): r is Extract<PlanRow, { kind: "create" }> => r.kind === "create").slice(0, limit);
  await eachLimited(toCreate, 3, async (r) => {
    try {
      const raw = (await createOrUpdateListing(r.payload)) as unknown;
      const listing = extractHipListing(raw);
      if (listing) {
        // Our private_id resolves to the eBay id in upsertHipListing, so
        // HIP-1 (sales) and HIP-2 (closing) see this listing immediately.
        await upsertHipListing({ ...listing, private_id: listing.private_id ?? r.payload.private_id, name: listing.name ?? r.payload.name, current_price: listing.current_price ?? r.payload.buyout_price, quantity: listing.quantity ?? r.payload.quantity });
        result.created++;
        await log("create_hip", r.itemId, listing.id, true, `${r.categoryName}`);
      } else {
        // Hip said OK but we couldn't find an id. The listing most likely
        // exists: count it as created (the private_id makes any retry an
        // update, and the next map walk links it) and keep the raw reply.
        result.created++;
        result.createdWithoutId++;
        const detail = `2xx without a recognisable id: ${JSON.stringify(raw).slice(0, 600)}`;
        if (result.errors.length < 20) result.errors.push({ itemId: r.itemId, detail });
        await log("create_hip", r.itemId, null, true, detail);
      }
    } catch (e) {
      result.failed++;
      const detail = errText(e);
      if (result.errors.length < 20) result.errors.push({ itemId: r.itemId, detail });
      await log("create_hip", r.itemId, null, false, detail);
    }
  });

  // ── Price drift (opt-in) ────────────────────────────────────────────────
  if (opts.prices) {
    const drift = plan
      .filter((r): r is Extract<PlanRow, { kind: "on_hip" }> => r.kind === "on_hip" && r.priceDrift && r.payload != null)
      .slice(0, PRICE_UPDATES_PER_RUN);
    await eachLimited(drift, 3, async (r) => {
      result.priceUpdates.attempted++;
      try {
        // Ours: re-POST (private_id makes it an update). Adopted: PUT the
        // price only, leaving Hip-sync's title/photos/category alone.
        const listing = r.ours
          ? await createOrUpdateListing(r.payload!)
          : await updateListing(r.hipId, { buyout_price: r.payload!.buyout_price });
        await db
          .update(hipListings)
          .set({ price: String(listing?.current_price ?? r.payload!.buyout_price) })
          .where(eq(hipListings.hipId, r.hipId));
        result.priceUpdates.ok++;
        await log("update_hip", r.itemId, r.hipId, true, `price → ${r.payload!.buyout_price}`);
      } catch (e) {
        result.priceUpdates.failed++;
        const detail = errText(e);
        if (result.errors.length < 20) result.errors.push({ itemId: r.itemId, detail: `price: ${detail}` });
        await log("update_hip", r.itemId, r.hipId, false, detail);
      }
    });
  }

  return result;
}
