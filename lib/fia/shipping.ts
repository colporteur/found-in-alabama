// Found in Alabama direct-sale shipping (Phase FIA-SHOP-1).
//
// Weight-based, not class-based like The Ephemeral State. Every eBay
// listing on calculated shipping carries its PACKED weight (and usually
// dimensions) in ShippingPackageDetails; the full sweep copies those into
// ebay_listings.pkg_*. A cart's shipping is:
//
//   1. total weight = Σ (unit weight × qty) − a packaging credit for every
//      unit after the first (one box instead of several), never less than
//      the heaviest single unit;
//   2. service = USPS Media Mail when EVERY line is Media-Mail-eligible
//      (the eBay listing itself ships Media Mail), else Ground Advantage;
//   3. price = the first rate-table row whose maxOz covers the weight,
//      plus a per-order handling amount; free above an optional threshold.
//
// Items heavier or bigger than the caps are eBay-only (no Add to cart).
// Items without an eBay weight use a per-ship-class fallback weight and
// are flagged "estimated" so the admin coverage report can find them.
//
// Pure module — no server imports — so the quote is unit-testable and the
// same code runs in the quote API and at checkout.

export type ShipClass = "paper" | "media" | "bulky";
export type ShipService = "media" | "ground";

export type RateRow = { maxOz: number; price: number };

export type FiaShipSettings = {
  /** USPS Ground Advantage, ascending by maxOz. */
  groundTable: RateRow[];
  /** USPS Media Mail, ascending by maxOz. */
  mediaTable: RateRow[];
  /** Added to every non-free order (box, tape, filler). */
  handling: number;
  /** Merchandise subtotal at which shipping is free; 0 = never. */
  freeAt: number;
  /** Units heavier than this are eBay-only. */
  maxItemWeightOz: number;
  /** Units with any side longer than this are eBay-only. */
  maxItemSideIn: number;
  /** Packaging weight saved per additional unit packed in the same box. */
  combineCreditOz: number;
  /** Weight used when eBay has none for a listing, by ship class. */
  fallbackOz: Record<ShipClass, number>;
};

// Starter tables. Media Mail = the 2026 USPS retail prices (the same
// $4.39 / $5.13 / $5.86 … your eBay book buyers already pay). Ground
// Advantage = an approximate mid-zone (zone 5) commercial price from
// Lineville from published 2026 tables, which disagree with each other
// under 1 lb — CHECK them against Pirate Ship's rate calculator (from
// 36266 to a mid-distance ZIP) and edit them at /admin/fia-shop.
export const DEFAULT_FIA_SHIP_SETTINGS: FiaShipSettings = {
  groundTable: [
    { maxOz: 4, price: 5.25 },
    { maxOz: 8, price: 5.95 },
    { maxOz: 12, price: 6.75 },
    { maxOz: 15.99, price: 7.65 },
    { maxOz: 32, price: 9.95 },
    { maxOz: 48, price: 11.6 },
    { maxOz: 64, price: 12.85 },
    { maxOz: 80, price: 13.5 },
    { maxOz: 96, price: 14.3 },
    { maxOz: 112, price: 14.9 },
    { maxOz: 128, price: 15.5 },
    { maxOz: 144, price: 16.1 },
    { maxOz: 160, price: 16.8 },
    { maxOz: 240, price: 21.15 },
    { maxOz: 320, price: 24.95 },
    { maxOz: 480, price: 33.0 },
  ],
  mediaTable: [
    { maxOz: 16, price: 4.39 },
    { maxOz: 32, price: 5.13 },
    { maxOz: 48, price: 5.86 },
    { maxOz: 64, price: 6.6 },
    { maxOz: 80, price: 7.34 },
    { maxOz: 96, price: 8.08 },
    { maxOz: 112, price: 8.81 },
    { maxOz: 128, price: 9.55 },
    { maxOz: 144, price: 10.29 },
    { maxOz: 160, price: 11.02 },
    { maxOz: 240, price: 14.71 },
    { maxOz: 320, price: 18.39 },
    { maxOz: 480, price: 25.75 },
  ],
  handling: 0,
  freeAt: 0,
  maxItemWeightOz: 320, // 20 lb
  maxItemSideIn: 24,
  combineCreditOz: 2,
  fallbackOz: { paper: 3, media: 24, bulky: 40 },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function cleanTable(v: unknown, fallback: RateRow[]): RateRow[] {
  if (!Array.isArray(v)) return fallback;
  const rows = v
    .map((r) => ({
      maxOz: Number((r as RateRow)?.maxOz),
      price: Number((r as RateRow)?.price),
    }))
    .filter((r) => Number.isFinite(r.maxOz) && r.maxOz > 0 && Number.isFinite(r.price) && r.price >= 0)
    .sort((a, b) => a.maxOz - b.maxOz);
  return rows.length > 0 ? rows : fallback;
}

function num(v: unknown, fallback: number, min = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** Merge a stored (possibly partial or stale) settings blob over the defaults. */
export function normalizeFiaShipSettings(v: unknown): FiaShipSettings {
  const d = DEFAULT_FIA_SHIP_SETTINGS;
  const o = (v && typeof v === "object" ? v : {}) as Partial<FiaShipSettings>;
  const fb = (o.fallbackOz ?? {}) as Partial<Record<ShipClass, number>>;
  return {
    groundTable: cleanTable(o.groundTable, d.groundTable),
    mediaTable: cleanTable(o.mediaTable, d.mediaTable),
    handling: round2(num(o.handling, d.handling)),
    freeAt: round2(num(o.freeAt, d.freeAt)),
    maxItemWeightOz: num(o.maxItemWeightOz, d.maxItemWeightOz, 1),
    maxItemSideIn: num(o.maxItemSideIn, d.maxItemSideIn, 1),
    combineCreditOz: num(o.combineCreditOz, d.combineCreditOz),
    fallbackOz: {
      paper: num(fb.paper, d.fallbackOz.paper, 0.1),
      media: num(fb.media, d.fallbackOz.media, 0.1),
      bulky: num(fb.bulky, d.fallbackOz.bulky, 0.1),
    },
  };
}

// ─── Per-item facts ──────────────────────────────────────────────────────────

export type FiaShipItem = {
  /** eBay packed weight per unit (oz); null = unknown. */
  weightOz: number | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  depthIn?: number | null;
  shipClass: ShipClass;
  /** The eBay listing offers USPS Media Mail. */
  mediaEligible: boolean;
};

/** eBay ShippingService codes that mean Media Mail (e.g. "USPSMedia"). */
export function isMediaService(codes: unknown): boolean {
  if (!Array.isArray(codes)) return false;
  return codes.some((c) => /media/i.test(String(c)));
}

export function normalizeShipClass(v: unknown): ShipClass {
  return v === "media" || v === "bulky" ? v : "paper";
}

/** Weight the quote will use for one unit, and whether it was a guess. */
export function unitWeight(
  item: FiaShipItem,
  s: FiaShipSettings
): { oz: number; estimated: boolean } {
  if (item.weightOz != null && item.weightOz > 0) {
    return { oz: item.weightOz, estimated: false };
  }
  return { oz: s.fallbackOz[item.shipClass], estimated: true };
}

export type DirectSaleCheck =
  | { ok: true }
  | { ok: false; reason: "too_heavy" | "too_big" };

/** Can this item be bought on foundinalabama.com, or is it eBay-only? */
export function directSaleCheck(
  item: FiaShipItem,
  s: FiaShipSettings
): DirectSaleCheck {
  if (item.weightOz != null && item.weightOz > s.maxItemWeightOz) {
    return { ok: false, reason: "too_heavy" };
  }
  const sides = [item.lengthIn, item.widthIn, item.depthIn].filter(
    (n): n is number => n != null && n > 0
  );
  if (sides.some((n) => n > s.maxItemSideIn)) {
    return { ok: false, reason: "too_big" };
  }
  return { ok: true };
}

// ─── Cart quote ──────────────────────────────────────────────────────────────

export type FiaQuoteLine = FiaShipItem & { quantity: number; price: number };

export type FiaShippingQuote =
  | {
      ok: true;
      subtotal: number;
      shipping: number;
      free: boolean;
      service: ShipService;
      /** Weight the price was looked up at (oz). */
      weightOz: number;
      /** Units whose weight was a class fallback, not eBay's. */
      estimatedUnits: number;
      freeAt: number;
      remainingForFree: number;
    }
  | { ok: false; error: string; subtotal: number };

function lookup(table: RateRow[], oz: number): number | null {
  for (const r of table) if (oz <= r.maxOz + 1e-9) return r.price;
  return null;
}

export function quoteFiaShipping(
  lines: FiaQuoteLine[],
  s: FiaShipSettings
): FiaShippingQuote {
  let subtotal = 0;
  let total = 0;
  let heaviest = 0;
  let units = 0;
  let estimatedUnits = 0;
  let allMedia = true;

  for (const l of lines) {
    const q = Math.max(0, Math.floor(l.quantity));
    if (q === 0) continue;
    subtotal += l.price * q;
    const w = unitWeight(l, s);
    total += w.oz * q;
    heaviest = Math.max(heaviest, w.oz);
    units += q;
    if (w.estimated) estimatedUnits += q;
    if (!l.mediaEligible) allMedia = false;
  }
  subtotal = round2(subtotal);

  if (units === 0) {
    return { ok: false, error: "Cart is empty.", subtotal: 0 };
  }

  const combined = Math.max(heaviest, total - s.combineCreditOz * (units - 1));
  const weightOz = round2(combined);
  const service: ShipService = allMedia ? "media" : "ground";
  const table = service === "media" ? s.mediaTable : s.groundTable;
  const base = lookup(table, weightOz);
  if (base == null) {
    return {
      ok: false,
      error:
        "This order is too heavy to ship as one package — please split it into two orders, or buy the heavier pieces on eBay.",
      subtotal,
    };
  }

  const free = s.freeAt > 0 && subtotal >= s.freeAt;
  const shipping = free ? 0 : round2(base + s.handling);
  return {
    ok: true,
    subtotal,
    shipping,
    free,
    service,
    weightOz,
    estimatedUnits,
    freeAt: s.freeAt,
    remainingForFree:
      s.freeAt > 0 && !free ? round2(s.freeAt - subtotal) : 0,
  };
}

/** Shopper-facing label for the service. */
export function serviceLabel(service: ShipService): string {
  return service === "media" ? "USPS Media Mail" : "USPS Ground Advantage";
}

/** One-item shipping price shown on a product page ("ships for $X"). */
export function singleItemShipping(
  item: FiaShipItem,
  price: number,
  s: FiaShipSettings
): FiaShippingQuote {
  return quoteFiaShipping([{ ...item, quantity: 1, price }], s);
}

// ─── Settings text format (admin editor) ─────────────────────────────────────

/** "4 5.25\n8 5.95" ⇄ RateRow[] — one "maxOz price" pair per line. */
export function tableToText(rows: RateRow[]): string {
  return rows.map((r) => `${r.maxOz} ${r.price.toFixed(2)}`).join("\n");
}

export function textToTable(text: string): RateRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [a, b] = line.split(/[\s,;]+/);
      return { maxOz: Number(a), price: Number(String(b ?? "").replace(/^\$/, "")) };
    })
    .filter((r) => Number.isFinite(r.maxOz) && r.maxOz > 0 && Number.isFinite(r.price) && r.price >= 0)
    .sort((x, y) => x.maxOz - y.maxOz);
}
