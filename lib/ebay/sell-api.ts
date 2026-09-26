// Thin REST client for the eBay Sell APIs (Marketing, Account, Analytics).
// Always pulls a valid access token from getValidAccessToken() and adds the
// required headers. Throws a typed error when the API returns 4xx/5xx so
// callers can distinguish recoverable from fatal failures.

import { getValidAccessToken } from "./oauth";
import { promotionIdFromLocation } from "./promotion-utils";

function isSandbox(): boolean {
  return (process.env.EBAY_ENV ?? "production") === "sandbox";
}

function apiHost(): string {
  return isSandbox()
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

export class SellApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
  }
}

/** No-token sentinel — caller should redirect the user to reconnect. */
export class SellApiNoTokenError extends Error {
  constructor() {
    super(
      "No valid OAuth access token. Reconnect at /admin/ebay/sales/connect."
    );
  }
}

interface SellApiOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** JSON body — will be stringified. Omit for GET/DELETE. */
  body?: unknown;
  /** Marketplace header (default EBAY_US). */
  marketplaceId?: string;
  /** Extra headers to merge in. */
  headers?: Record<string, string>;
}

export async function sellApi<T = unknown>(
  path: string,
  opts: SellApiOptions = {}
): Promise<T> {
  const token = await getValidAccessToken();
  if (!token) throw new SellApiNoTokenError();

  const url = path.startsWith("http") ? path : `${apiHost()}${path}`;
  const method = opts.method ?? "GET";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "X-EBAY-C-MARKETPLACE-ID": opts.marketplaceId ?? "EBAY_US",
    ...opts.headers,
  };

  const init: RequestInit = { method, headers, cache: "no-store", signal: AbortSignal.timeout(25_000) };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }

  // Set EBAY_DEBUG=1 in env to log Sell API request body + response body
  // to the server console. Useful for diagnosing 5xx errors where eBay's
  // error message itself is uninformative.
  if (process.env.EBAY_DEBUG === "1") {
    console.log(`[ebay-sell:${method}] ${path}`);
    if (init.body) {
      console.log(`[ebay-sell:request-body] ${init.body}`);
    }
  }

  const res = await fetch(url, init);
  const text = await res.text();

  if (process.env.EBAY_DEBUG === "1") {
    console.log(
      `[ebay-sell:${method}:${res.status}] response body (first 2000 chars):\n${text.slice(0, 2000)}`
    );
  }

  if (!res.ok) {
    throw new SellApiError(
      `Sell API ${method} ${path} failed: HTTP ${res.status}`,
      res.status,
      text
    );
  }
  // Creation returns the resource ID in Location, often with an empty body.
  if (method === "POST" && path === "/sell/marketing/v1/item_price_markdown") {
    const body = text ? JSON.parse(text) : {};
    const promotionId = body?.promotionId ?? promotionIdFromLocation(res.headers.get("location"));
    if (!promotionId) throw new Error("eBay accepted the sale but returned no promotion ID; reconcile before retrying.");
    return { ...body, promotionId } as T;
  }
  // 204 No Content (some DELETE / PATCH endpoints).
  if (!text) return null as T;
  return JSON.parse(text) as T;
}
