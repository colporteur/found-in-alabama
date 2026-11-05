// eBay Browse API (public search) with an application token — no user
// consent needed, just EBAY_APP_ID + EBAY_CERT_ID. Used by /admin/bolo for
// thumbnails and live-listing counts. Responses are cached in Next's data
// cache for 12h so a page view doesn't spend Browse quota (5,000/day).

const SCOPE = "https://api.ebay.com/oauth/api_scope";

let appToken: { token: string; exp: number } | null = null;

function apiBase(): string {
  return process.env.EBAY_ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

async function getAppToken(): Promise<string | null> {
  if (appToken && appToken.exp - Date.now() > 60_000) return appToken.token;
  const id = process.env.EBAY_APP_ID;
  const secret = process.env.EBAY_CERT_ID;
  if (!id || !secret) return null;
  const res = await fetch(`${apiBase()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }),
    cache: "no-store",
  });
  if (!res.ok) {
    console.warn(`[ebay:browse] app token HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  appToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return appToken.token;
}

export type BrowseHit = { title: string; price: number | null; image: string | null; url: string };
export type BrowseResult = { total: number; items: BrowseHit[] };

/** Active-listing search. Returns null when eBay isn't configured or fails. */
export async function browseSearch(q: string, limit = 12): Promise<BrowseResult | null> {
  try {
    const token = await getAppToken();
    if (!token) return null;
    const params = new URLSearchParams({ q, limit: String(limit) });
    const res = await fetch(`${apiBase()}/buy/browse/v1/item_summary/search?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        Accept: "application/json",
      },
      next: { revalidate: 60 * 60 * 12 },
    });
    if (!res.ok) {
      console.warn(`[ebay:browse] search HTTP ${res.status} for "${q}"`);
      return null;
    }
    const j = (await res.json()) as {
      total?: number;
      itemSummaries?: Array<{
        title?: string;
        price?: { value?: string };
        image?: { imageUrl?: string };
        thumbnailImages?: Array<{ imageUrl?: string }>;
        itemWebUrl?: string;
      }>;
    };
    const items = (j.itemSummaries ?? []).map((s) => ({
      title: s.title ?? "",
      price: s.price?.value ? Number(s.price.value) : null,
      image: s.image?.imageUrl ?? s.thumbnailImages?.[0]?.imageUrl ?? null,
      url: s.itemWebUrl ?? "",
    }));
    return { total: j.total ?? items.length, items };
  } catch (err) {
    console.warn(`[ebay:browse] ${(err as Error).message}`);
    return null;
  }
}

/** eBay search links (no API) — sold comps and live listings. */
export function ebaySoldUrl(q: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1&_sop=13`;
}
export function ebayLiveUrl(q: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&_sop=15`;
}
