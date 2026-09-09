// Hip eCommerce API client (HipPostcard). Phase HIP-1.
//
// Base: https://www.hippostcard.com/api — keys are PER SITE (a HipStamp
// key does not work here). Auth is the X-ApiKey header. Limits: 10,000
// requests / 24h, 10 / second; every response carries X-RateLimit-*
// headers which we log when they get low. List endpoints return
// { count, results: [...] } and page with limit (default 25) + page.
//
// The key is not self-service: Hip issues it by email
// (admin@hipecommerce.com) on request. Until HIP_API_KEY is set every
// call throws HipNotConfigured and the poller no-ops.
//
// Reference: the OpenAPI definition embedded in
// https://hip-ecommerce.readme.io/reference/* pages ("oasDefinition").

const DEFAULT_BASE = "https://www.hippostcard.com/api";

export class HipNotConfigured extends Error {
  constructor() {
    super("Hip API not configured (HIP_API_KEY / HIP_USERNAME)");
  }
}

export class HipApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, path: string) {
    super(`Hip API ${status} on ${path}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

export function hipConfig(): { base: string; key: string; username: string } | null {
  const key = process.env.HIP_API_KEY;
  const username = process.env.HIP_USERNAME;
  if (!key || !username) return null;
  return { base: process.env.HIP_API_BASE ?? DEFAULT_BASE, key, username };
}

export function hipConfigured(): boolean {
  return hipConfig() !== null;
}

// ─── Types (seller view) ─────────────────────────────────────────────────────

export type HipListing = {
  id: number;
  name: string;
  /** eBay item id when external_id_type names eBay (set by Hip's sync). */
  external_id?: number | string | null;
  external_id_type?: string | null;
  private_id?: string | null;
  quantity?: number;
  current_price?: number;
  active?: boolean;
  closed?: boolean;
  deleted?: boolean;
  draft?: boolean;
  url?: string;
  updated_at?: string;
  created_at?: string;
  listing_type?: "auction" | "product";
};

export type HipSaleListing = {
  id: number;
  listing_id: number;
  listing_name: string;
  price: number;
  quantity: number;
  private_id?: string | null;
  sale_id: number;
};

export type HipAddress = Record<string, unknown>;

export type HipSale = {
  id: number;
  created_at: string;
  buyer_id?: number;
  buyer_username?: string;
  buyer_email?: string;
  seller_username?: string;
  currency?: string;
  total?: number;
  sales_listings_amount?: number;
  postage_amount?: number;
  tax_amount?: number;
  flag_payment?: number;
  flag_payment_name?: string;
  flag_shipping?: number;
  flag_shipping_name?: string;
  tracking_link?: string;
  gateway_transaction_code?: string;
  ShippingAddress?: HipAddress;
  SaleListings?: HipSaleListing[];
};

type ListResponse<T> = { count?: number; type?: string; results?: T[] };

// ─── Transport ───────────────────────────────────────────────────────────────

type Query = Record<string, string | number | boolean | undefined>;

async function hipFetch<T>(
  path: string,
  opts: { method?: "GET" | "PUT" | "POST" | "DELETE"; query?: Query; body?: unknown } = {}
): Promise<T> {
  const cfg = hipConfig();
  if (!cfg) throw new HipNotConfigured();

  const url = new URL(cfg.base.replace(/\/$/, "") + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      "X-ApiKey": cfg.key,
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      "User-Agent": "found-in-alabama-hip/1.0",
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining != null && Number(remaining) < 500) {
    console.warn(`[hip] rate limit remaining ${remaining} (limit ${res.headers.get("x-ratelimit-limit")})`);
  }

  const text = await res.text();
  if (!res.ok) throw new HipApiError(res.status, text, path);
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HipApiError(res.status, `non-JSON body: ${text.slice(0, 200)}`, path);
  }
}

/** Hip wants "YYYY-MM-DD HH:MM:SS"-ish date-times; ISO without ms is safe. */
function hipTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ─── Sales ───────────────────────────────────────────────────────────────────

export async function findPaidSales(opts: {
  createdFrom?: Date;
  createdTo?: Date;
  page?: number;
  limit?: number;
}): Promise<{ count: number; results: HipSale[] }> {
  const cfg = hipConfig();
  if (!cfg) throw new HipNotConfigured();
  const res = await hipFetch<ListResponse<HipSale>>(
    `/stores/${encodeURIComponent(cfg.username)}/sales/paid`,
    {
      query: {
        limit: opts.limit ?? 50,
        page: opts.page ?? 1,
        created_time_from: opts.createdFrom ? hipTime(opts.createdFrom) : undefined,
        created_time_to: opts.createdTo ? hipTime(opts.createdTo) : undefined,
      },
    }
  );
  return { count: res.count ?? res.results?.length ?? 0, results: res.results ?? [] };
}

export async function getSale(id: number): Promise<HipSale> {
  return hipFetch<HipSale>(`/sales/${id}`);
}

// ─── Listings ────────────────────────────────────────────────────────────────

export async function getListing(id: number): Promise<HipListing> {
  return hipFetch<HipListing>(`/listings/${id}`);
}

export async function findActiveStoreListings(opts: {
  page?: number;
  limit?: number;
}): Promise<{ count: number; results: HipListing[] }> {
  const cfg = hipConfig();
  if (!cfg) throw new HipNotConfigured();
  const res = await hipFetch<ListResponse<HipListing>>(
    `/stores/${encodeURIComponent(cfg.username)}/listings/active`,
    { query: { limit: opts.limit ?? 100, page: opts.page ?? 1, sort: "started_desc" } }
  );
  return { count: res.count ?? res.results?.length ?? 0, results: res.results ?? [] };
}

/**
 * Close (not delete) a Hip listing. 404 = already gone, which is the goal
 * state, so it's reported as ok with alreadyGone = true.
 */
export async function closeListing(
  id: number
): Promise<{ ok: boolean; alreadyGone: boolean; detail: string }> {
  try {
    await hipFetch(`/listings/${id}`, { method: "DELETE" });
    return { ok: true, alreadyGone: false, detail: "closed" };
  } catch (err) {
    if (err instanceof HipApiError && (err.status === 404 || err.status === 410)) {
      return { ok: true, alreadyGone: true, detail: `HTTP ${err.status}` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, alreadyGone: false, detail: msg.slice(0, 300) };
  }
}

/** Hip's external_id for an eBay-synced listing, as a string item id. */
export function ebayItemIdFromHip(l: HipListing): string | null {
  if (l.external_id == null || l.external_id === "" || l.external_id === 0) return null;
  const type = (l.external_id_type ?? "").toLowerCase();
  // Hip only syncs with eBay today; accept an unnamed type too, but
  // refuse anything that explicitly names another site.
  if (type && !type.includes("ebay")) return null;
  return String(l.external_id);
}
