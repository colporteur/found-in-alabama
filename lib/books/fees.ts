// Venue fees and profit math for the books (Phase 4e). Pure; tested in
// fees.test.mts. Real fees win when FIA has them (eBay orders carry
// totalMarketplaceFee); otherwise these ESTIMATES apply, editable at
// /admin/books/settings because venues change their rates.

export type FeeRule = {
  /** Percent of the sale (item price + shipping the buyer paid, when known). */
  pct: number;
  /** Flat fee per order. */
  fixed: number;
  /** Poshmark-style: a flat fee instead of the percent below this price. */
  flatUnder?: { below: number; fee: number } | null;
};

export type BooksSettings = {
  fees: Record<string, FeeRule>;
  /** Venues whose shipping label the buyer pays (postage cost to Todd = $0). */
  buyerPaidLabel: string[];
};

export const DEFAULT_BOOKS_SETTINGS: BooksSettings = {
  fees: {
    ebay: { pct: 13.6, fixed: 0.4 },
    mercari: { pct: 10, fixed: 0.5 },
    poshmark: { pct: 20, fixed: 0, flatUnder: { below: 15, fee: 2.95 } },
    depop: { pct: 3.3, fixed: 0.45 },
    whatnot: { pct: 10.9, fixed: 0.3 },
    hip: { pct: 0, fixed: 0 },
    tes: { pct: 2.9, fixed: 0.3 },
    fia: { pct: 2.9, fixed: 0.3 },
  },
  buyerPaidLabel: ["poshmark", "mercari", "depop", "whatnot"],
};

const num = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

export function parseBooksSettings(raw: unknown): BooksSettings {
  const v = (raw ?? {}) as Record<string, unknown>;
  const fees: Record<string, FeeRule> = {};
  const rawFees = (v.fees ?? {}) as Record<string, Record<string, unknown>>;
  for (const [venue, def] of Object.entries(DEFAULT_BOOKS_SETTINGS.fees)) {
    const r = rawFees[venue] ?? {};
    const fu = (r.flatUnder ?? def.flatUnder ?? null) as Record<string, unknown> | null;
    fees[venue] = {
      pct: Math.min(num(r.pct, def.pct), 100),
      fixed: num(r.fixed, def.fixed),
      flatUnder: fu ? { below: num(fu.below, 0), fee: num(fu.fee, 0) } : null,
    };
  }
  const paid = Array.isArray(v.buyerPaidLabel)
    ? v.buyerPaidLabel.map(String).filter((x) => x in DEFAULT_BOOKS_SETTINGS.fees)
    : DEFAULT_BOOKS_SETTINGS.buyerPaidLabel;
  return { fees, buyerPaidLabel: paid };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Estimated venue fee for one order. */
export function estimateFee(venue: string, saleAmount: number, s: BooksSettings): number {
  const rule = s.fees[venue];
  if (!rule || saleAmount <= 0) return 0;
  if (rule.flatUnder && saleAmount < rule.flatUnder.below) return r2(rule.flatUnder.fee);
  return r2((saleAmount * rule.pct) / 100 + rule.fixed);
}

export type ProfitInput = {
  venue: string;
  itemsTotal: number;
  shippingPaid: number | null;
  actualFees: number | null;
  shippingCost: number | null;
  /** Known item costs summed; `unknownCostLines` counts lines without one. */
  itemCost: number;
  unknownCostLines: number;
};

export type Profit = {
  revenue: number;
  fees: number;
  feesEstimated: boolean;
  shippingCost: number | null;
  itemCost: number;
  profit: number;
  /** True when shipping cost or an item cost is missing (profit is an upper bound). */
  incomplete: boolean;
};

export function orderProfit(o: ProfitInput, s: BooksSettings): Profit {
  const revenue = r2(o.itemsTotal + (o.shippingPaid ?? 0));
  const feesEstimated = o.actualFees == null;
  const fees = feesEstimated ? estimateFee(o.venue, revenue, s) : r2(o.actualFees!);
  const shippingCost = o.shippingCost ?? (s.buyerPaidLabel.includes(o.venue) ? 0 : null);
  const profit = r2(revenue - fees - (shippingCost ?? 0) - o.itemCost);
  return {
    revenue,
    fees,
    feesEstimated,
    shippingCost,
    itemCost: r2(o.itemCost),
    profit,
    incomplete: shippingCost == null || o.unknownCostLines > 0,
  };
}
