import { decodeEntities } from "../ebay/entities";
import { plainTextFromHtml } from "../tes/sanitize";

export const STATUS_LABELS = {
  listed: "Already on Hip",
  ready: "Ready for pilot review",
  unchecked: "Needs Hip comparison",
  needs_category: "Needs category decision",
  needs_data: "Needs listing details",
  needs_review: "Needs manual review",
  excluded: "Outside initial scope",
} as const;
export type ReadinessStatus = keyof typeof STATUS_LABELS;

export type InventoryCandidate = {
  itemId: string;
  title: string;
  sku: string | null;
  price: string | null;
  quantity: number | null;
  description: string | null;
  primaryImageUrl: string | null;
  imageUrls: unknown;
  siteCategoryId: string | null;
  siteCategoryName: string | null;
  listingType: string | null;
  lastSyncedAt: Date | string;
  storeCategories: string[];
};
export type HipReadinessListing = {
  id: number;
  name: string;
  externalId: string | null;
  privateId: string | null;
  url?: string;
};
export type HipInventoryReview = HipReadinessListing & {
  inventoryStatus?: "zero_quantity" | "unknown_quantity" | "outside_selection" | "not_in_mirror" | "no_item_link";
  inventoryQuantity?: number | null;
  inventoryLastSyncedAt?: string;
};
export type HipSnapshot = {
  state: "not_connected" | "not_checked" | "complete" | "partial" | "error";
  listings: HipReadinessListing[];
  pages: number;
  checkedAt: string | null;
  message: string;
};
export type CategorySuggestion = { id: number; name: string; reason: string };
export type ReadinessRow = {
  itemId: string;
  title: string;
  sku: string | null;
  price: string | null;
  quantity: number;
  image: string | null;
  imageCount: number;
  descriptionPreview: string;
  siteCategory: string;
  storeCategories: string[];
  lastSyncedAt: string;
  category: CategorySuggestion | null;
  status: ReadinessStatus;
  reasons: string[];
  hipIds: number[];
  possibleHipIds: number[];
};
export type ReadinessReport = {
  generatedAt: string;
  connectionConfigured: boolean;
  snapshot: Omit<HipSnapshot, "listings"> & { listingCount: number };
  counts: Record<ReadinessStatus, number>;
  rows: ReadinessRow[];
  hipUnmatched: HipInventoryReview[];
};

// Verified against https://www.hippostcard.com/api-field-values/?filter=categories
// on 2026-09-17. These are preview suggestions, not authorization to publish.
// Category 0 and 2056 are Hip's documented automatic postcard categories.
export function suggestHipCategory(item: Pick<InventoryCandidate, "siteCategoryId" | "siteCategoryName">): CategorySuggestion | null {
  const path = decodeEntities(item.siteCategoryName).toLowerCase();
  if (item.siteCategoryId === "262042") return { id: 0, name: "Postcards · automatic location", reason: "eBay topographical postcard category" };
  if (item.siteCategoryId === "262043") return { id: 2056, name: "Postcards · automatic topic", reason: "eBay non-topographical postcard category" };
  if (path.includes(":vintage greeting cards:")) return { id: 36513, name: "Ephemera · Vintage Greeting Cards", reason: "eBay vintage greeting card category" };
  if (path.includes(":paper:ephemera:")) return { id: 36453, name: "Ephemera · Other / Unsorted", reason: "eBay ephemera category; a more specific Hip category may be preferable" };
  if (path.includes(":maps & atlases:maps:")) return { id: 36438, name: "Ephemera · Maps", reason: "eBay map category" };
  if (path.includes(":sheet music & song books:vintage & antique")) return { id: 36441, name: "Ephemera · Scores", reason: "eBay vintage sheet music category" };
  return null;
}

function excludedReason(path: string): string | null {
  // A deliberately narrow first pilot, not a claim that Hip forbids all other goods.
  if (/^(music|movies & tv|clothing, shoes & accessories|jewelry & watches):/i.test(path)) return "Outside the initial postcard and paper pilot.";
  if (/sports trading cards|collectible card games/i.test(path)) return "Trading cards are outside the initial postcard and paper pilot.";
  if (/^books & magazines:(books|audiobooks|textbooks, education & reference)(:|$)/i.test(path)) return "General books and audiobooks are outside the initial pilot.";
  return null;
}

function identity(l: HipReadinessListing): string | null {
  if (l.externalId && /^\d+$/.test(l.externalId)) return l.externalId;
  // Reserved for our future publisher. Never match a shared storage/bin SKU.
  return /^tes-ebay:(\d+)$/.exec(l.privateId ?? "")?.[1] ?? null;
}

const normalizeTitle = (s: string) => decodeEntities(s).trim().toLowerCase().replace(/\s+/g, " ");
const validImage = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v);

export function buildReadinessReport(inventory: InventoryCandidate[], snapshot: HipSnapshot, connectionConfigured: boolean, now = new Date()): ReadinessReport {
  const byItem = new Map<string, HipReadinessListing[]>();
  const byTitle = new Map<string, HipReadinessListing[]>();
  for (const l of snapshot.listings) {
    const id = identity(l);
    if (id) byItem.set(id, [...(byItem.get(id) ?? []), l]);
    const title = normalizeTitle(l.name);
    if (title) byTitle.set(title, [...(byTitle.get(title) ?? []), l]);
  }
  const rows = inventory.map((item): ReadinessRow => {
    const title = decodeEntities(item.title).trim();
    const siteCategory = decodeEntities(item.siteCategoryName);
    const category = suggestHipCategory(item);
    const images = [...new Set([...(Array.isArray(item.imageUrls) ? item.imageUrls : []), item.primaryImageUrl].filter(validImage))];
    const description = plainTextFromHtml(decodeEntities(item.description), 8001);
    const exact = byItem.get(item.itemId) ?? [];
    const possible = (byTitle.get(normalizeTitle(title)) ?? []).filter((l) => !exact.some((m) => m.id === l.id));
    const reasons: string[] = [];
    const dataIssues: string[] = [];
    const reviewIssues: string[] = [];
    if (!title) dataIssues.push("Title is missing.");
    if (title.length > 80) dataIssues.push("Title exceeds Hip's 80-character limit.");
    if (!description) dataIssues.push("Description is missing from the inventory cache.");
    if (description.length > 8000) dataIssues.push("Plain-text description exceeds Hip's 8,000-character limit.");
    if (!images.length) dataIssues.push("No image URL is cached.");
    if (!item.price || !Number.isFinite(Number(item.price)) || Number(item.price) <= 0) dataIssues.push("A positive price is required.");
    if ((item.quantity ?? 0) !== 1) reviewIssues.push("The initial pilot supports single-quantity listings only.");
    if (item.listingType !== "FixedPriceItem") reviewIssues.push("Confirm the selling format before including this item.");
    const synced = new Date(item.lastSyncedAt);
    if (!Number.isFinite(synced.getTime()) || now.getTime() - synced.getTime() > 36 * 3600_000) reviewIssues.push("Inventory has not been refreshed within 36 hours.");
    if (exact.length > 1) reviewIssues.push("Multiple active Hip listings link to this eBay item.");
    if (possible.length) reviewIssues.push("A matching title exists on Hip; verify its identity before creating another listing.");
    const exclusion = excludedReason(siteCategory);
    let status: ReadinessStatus;
    if (exact.length === 1 && !possible.length) status = "listed";
    else if (exact.length > 1 || possible.length) status = "needs_review";
    else if (exclusion) status = "excluded";
    else if (!category) status = "needs_category";
    else if (dataIssues.length) status = "needs_data";
    else if (reviewIssues.length) status = "needs_review";
    else status = snapshot.state === "complete" ? "ready" : "unchecked";
    if (exact.length) reasons.push("Matched by an exact item identifier in the current Hip scan.");
    if (exclusion) reasons.push(exclusion);
    if (!category) reasons.push("Choose an appropriate Hip category after reviewing the item type.");
    reasons.push(...dataIssues, ...reviewIssues);
    if (category) reasons.push(category.reason);
    if (!exact.length && snapshot.state !== "complete") reasons.push("Hip coverage is unknown until a complete comparison succeeds.");
    if (status === "ready") reasons.push("Not found in the completed Hip scan. Review availability, pricing, and shipping before a pilot.");
    return {
      itemId: item.itemId, title, sku: item.sku, price: item.price, quantity: item.quantity ?? 0,
      image: images[0] ?? null, imageCount: images.length, descriptionPreview: description.slice(0, 260),
      siteCategory, storeCategories: item.storeCategories, lastSyncedAt: Number.isFinite(synced.getTime()) ? synced.toISOString() : "",
      category, status, reasons, hipIds: exact.map((l) => l.id), possibleHipIds: possible.map((l) => l.id),
    };
  });
  const counts = Object.fromEntries(Object.keys(STATUS_LABELS).map((key) => [key, 0])) as Record<ReadinessStatus, number>;
  for (const row of rows) counts[row.status]++;
  const candidateIds = new Set(inventory.map((i) => i.itemId));
  const { listings, ...scan } = snapshot;
  return { generatedAt: now.toISOString(), connectionConfigured, snapshot: { ...scan, listingCount: listings.length }, counts, rows,
    hipUnmatched: listings.filter((l) => !candidateIds.has(identity(l) ?? "")),
  };
}

/** Spreadsheet-safe CSV; prefixes formula-like values before quoting. */
export function readinessCsv(rows: ReadinessRow[]): string {
  const cell = (v: unknown) => {
    const text = String(v ?? "");
    const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return "\uFEFF" + [
    ["eBay item", "Title", "Status", "Reasons", "Hip listings", "Possible Hip matches", "Suggested Hip category", "Hip category ID", "Price", "Quantity", "Bin", "Last inventory refresh"],
    ...rows.map((r) => [r.itemId, r.title, STATUS_LABELS[r.status], r.reasons.join(" "), r.hipIds.join(";"), r.possibleHipIds.join(";"), r.category?.name, r.category?.id, r.price, r.quantity, r.sku, r.lastSyncedAt]),
  ].map((r) => r.map(cell).join(",")).join("\r\n");
}
