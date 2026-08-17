// Buy-time eBay live check. The mirror is at most ~15 minutes stale, so
// before taking money we ask eBay directly whether each cart item is
// still Active with enough available quantity. This is the guard against
// the crosslisting oversell window (item sells on Poshmark → Nifty ends
// the eBay listing → mirror catches up on the next delta tick).
//
// One GetItem call per line (carts are capped at 20 lines; typical carts
// are far smaller). Failures of the eBay API itself are treated as
// "unknown" — checkout proceeds on mirror data rather than blocking a
// sale on an eBay hiccup; the webhook decrement + delist flow still
// reconciles reality afterward.

import { tradingCall } from "@/lib/ebay/client";

export type LiveCheckResult = {
  /** Item ids confirmed unavailable (ended, or not enough quantity). */
  unavailable: string[];
  /** Item ids we couldn't verify (eBay error) — treated as available. */
  unverified: string[];
};

type GetItemResponse = {
  Item?: {
    Quantity?: unknown;
    SellingStatus?: {
      QuantitySold?: unknown;
      ListingStatus?: unknown;
    };
  };
};

export async function liveCheckAvailability(
  lines: { itemId: string; quantity: number }[]
): Promise<LiveCheckResult> {
  const unavailable: string[] = [];
  const unverified: string[] = [];

  await Promise.all(
    lines.map(async (line) => {
      try {
        const res = await tradingCall<GetItemResponse>("GetItem", {
          ItemID: line.itemId,
          DetailLevel: "ReturnAll",
          OutputSelector:
            "Item.Quantity,Item.SellingStatus.QuantitySold,Item.SellingStatus.ListingStatus",
        });
        const item = res.Item;
        if (!item) {
          unverified.push(line.itemId);
          return;
        }
        const status = String(item.SellingStatus?.ListingStatus ?? "");
        const total = Number(item.Quantity ?? NaN);
        const sold = Number(item.SellingStatus?.QuantitySold ?? 0);
        const available = Number.isFinite(total)
          ? Math.max(0, total - (Number.isFinite(sold) ? sold : 0))
          : NaN;
        if (status !== "Active" || !Number.isFinite(available) || available < line.quantity) {
          unavailable.push(line.itemId);
        }
      } catch (err) {
        // eBay 17 "Item cannot be accessed" / ended-item errors mean gone;
        // anything else (timeout, 503) is unknown — don't block the sale.
        const msg = (err as Error).message || "";
        if (/\[17\]|\[1076\]|invalid item/i.test(msg)) {
          unavailable.push(line.itemId);
        } else {
          console.warn(`[tes live-check] unverified ${line.itemId}: ${msg}`);
          unverified.push(line.itemId);
        }
      }
    })
  );

  return { unavailable, unverified };
}
