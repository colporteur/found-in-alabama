// Phase HIP-3 — pure planning for the HipPostcard publisher. Decides, for
// every in-stock TES item, whether it is already on Hip, should be created,
// is excluded, or needs Todd's review. No DB, no network: publish.ts feeds
// it rows and acts on the result. See category-map.ts for category rules.

import { decodeEntities } from "../ebay/entities";
import { plainTextFromHtml } from "../tes/sanitize";
import { planHipListing } from "./category-map";
import { hipPrivateIdFor, type HipListingInput } from "./client";

export type PoolItem = {
  itemId: string;
  title: string;
  price: string | null;
  quantity: number | null;
  description: string | null;
  primaryImageUrl: string | null;
  imageUrls: unknown;
  siteCategoryId: string | null;
  siteCategoryName: string | null;
  listingType: string | null;
};

export type MappedHipListing = {
  hipId: number;
  externalId: string | null;
  privateId: string | null;
  title: string;
  price: string | null;
};

export type PlanRow =
  | { kind: "on_hip"; itemId: string; hipId: number; ours: boolean; priceDrift: boolean; payload: HipListingInput | null }
  | { kind: "create"; itemId: string; payload: HipListingInput; categoryName: string }
  | { kind: "exclude"; itemId: string; reason: string }
  | { kind: "review"; itemId: string; reason: string };

export const MAX_IMAGES = 12;
export const MAX_CREATE_FAILURES = 3;

const normTitle = (s: string) => decodeEntities(s).trim().toLowerCase().replace(/\s+/g, " ");
const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v);

/** Hip payload for one item, or a reason it can't be built. */
export function buildHipPayload(
  item: PoolItem,
  env: Record<string, string | undefined> = process.env
): { payload: HipListingInput; categoryName: string } | { problem: string; excluded?: boolean } {
  const plan = planHipListing(item, env);
  if (plan.action === "exclude") return { problem: plan.reason, excluded: true };
  if (plan.action === "review") return { problem: plan.reason };

  const name = decodeEntities(item.title).trim();
  if (!name) return { problem: "Title is missing" };
  const price = Number(item.price);
  if (!Number.isFinite(price) || price <= 0) return { problem: "No positive eBay price" };
  const qty = item.quantity ?? 0;
  if (qty < 1) return { problem: "Out of stock" };
  if (item.listingType && item.listingType !== "FixedPriceItem") return { problem: `eBay format is ${item.listingType}, not fixed price` };

  const gallery = Array.isArray(item.imageUrls) ? item.imageUrls.filter(isUrl) : [];
  const images = [...new Set([...gallery, ...(isUrl(item.primaryImageUrl) ? [item.primaryImageUrl] : [])])].slice(0, MAX_IMAGES);
  if (!images.length) return { problem: "No photo URL cached" };

  const description = plainTextFromHtml(decodeEntities(item.description), 8000) || name;

  return {
    categoryName: plan.categoryName,
    payload: {
      name: name.slice(0, 80),
      description,
      category_id: plan.categoryId,
      listing_type: "product",
      quantity: qty,
      buyout_price: Math.round(price * 100) / 100,
      private_id: hipPrivateIdFor(item.itemId),
      images,
    },
  };
}

export function planHipPublish(
  pool: PoolItem[],
  hipActive: MappedHipListing[],
  failedCreates: Map<string, number>,
  env: Record<string, string | undefined> = process.env
): PlanRow[] {
  const byItem = new Map<string, MappedHipListing[]>();
  const unlinkedTitles = new Set<string>();
  for (const l of hipActive) {
    if (l.externalId) byItem.set(l.externalId, [...(byItem.get(l.externalId) ?? []), l]);
    else unlinkedTitles.add(normTitle(l.title));
  }

  return pool.map((item): PlanRow => {
    const linked = byItem.get(item.itemId) ?? [];
    if (linked.length > 1) return { kind: "review", itemId: item.itemId, reason: `${linked.length} active Hip listings point at this eBay item` };
    if (linked.length === 1) {
      const l = linked[0];
      const ours = (l.privateId ?? "").startsWith("tes-ebay:");
      const built = buildHipPayload(item, env);
      const payload = "payload" in built ? built.payload : null;
      const priceDrift = payload != null && l.price != null && Math.abs(Number(l.price) - payload.buyout_price) >= 0.01;
      return { kind: "on_hip", itemId: item.itemId, hipId: l.hipId, ours, priceDrift, payload };
    }

    const built = buildHipPayload(item, env);
    if ("problem" in built) {
      return built.excluded
        ? { kind: "exclude", itemId: item.itemId, reason: built.problem }
        : { kind: "review", itemId: item.itemId, reason: built.problem };
    }
    if (unlinkedTitles.has(normTitle(item.title))) {
      return { kind: "review", itemId: item.itemId, reason: "Same title is already on Hip without an eBay link; check before creating another" };
    }
    if ((failedCreates.get(item.itemId) ?? 0) >= MAX_CREATE_FAILURES) {
      return { kind: "review", itemId: item.itemId, reason: `Hip rejected this item ${MAX_CREATE_FAILURES}+ times; see hip_actions` };
    }
    return { kind: "create", itemId: item.itemId, payload: built.payload, categoryName: built.categoryName };
  });
}

export function summarizePlan(rows: PlanRow[]) {
  const counts = { on_hip: 0, create: 0, exclude: 0, review: 0, priceDrift: 0 };
  const byCategory: Record<string, number> = {};
  const excludeReasons: Record<string, number> = {};
  const reviewReasons: Record<string, number> = {};
  for (const r of rows) {
    counts[r.kind]++;
    if (r.kind === "on_hip" && r.priceDrift) counts.priceDrift++;
    if (r.kind === "create") byCategory[r.categoryName] = (byCategory[r.categoryName] ?? 0) + 1;
    if (r.kind === "exclude") excludeReasons[r.reason] = (excludeReasons[r.reason] ?? 0) + 1;
    if (r.kind === "review") {
      const key = r.reason.startsWith("No Hip category rule") ? "No Hip category rule (non-paper eBay category)" : r.reason;
      reviewReasons[key] = (reviewReasons[key] ?? 0) + 1;
    }
  }
  return { counts, byCategory, excludeReasons, reviewReasons };
}
