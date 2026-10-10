// eBay orders, read-only (Fulfillment API, scope sell.fulfillment.readonly).
// Gives the to-ship queue what sale detection can't: the order id, the
// buyer, the ship-to, which items eBay combined into one order, totals and
// fees, and whether the order has shipped or been cancelled.
// parseEbayOrders() is pure (tested in orders.test.mts).

import { sellApi } from "./sell-api";
import { FULFILLMENT_SCOPE, hasGrantedScope } from "./oauth";

export type EbayOrderLine = {
  lineItemId: string;
  legacyItemId: string | null;
  title: string | null;
  sku: string | null;
  quantity: number;
  /** Line cost (price × quantity) as eBay reports it. */
  lineCost: number | null;
};

export type EbayOrder = {
  orderId: string;
  createdAt: string | null;
  buyerUsername: string | null;
  buyerName: string | null;
  shipTo: {
    name: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  } | null;
  /** NOT_STARTED | IN_PROGRESS | FULFILLED */
  fulfillmentStatus: string | null;
  cancelled: boolean;
  total: number | null;
  shipping: number | null;
  fees: number | null;
  lines: EbayOrderLine[];
};

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" ? (v as J) : {});
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const num = (v: unknown): number | null => {
  const n = Number(obj(v).value ?? v);
  return v == null || !Number.isFinite(n) ? null : n;
};

export function parseEbayOrders(json: unknown): EbayOrder[] {
  const orders = (obj(json).orders ?? []) as unknown[];
  return orders
    .map((raw): EbayOrder | null => {
      const o = obj(raw);
      const orderId = str(o.orderId);
      if (!orderId) return null;
      const step = obj(obj(((o.fulfillmentStartInstructions as unknown[]) ?? [])[0]).shippingStep);
      const shipTo = obj(step.shipTo);
      const addr = obj(shipTo.contactAddress);
      const buyer = obj(o.buyer);
      const price = obj(o.pricingSummary);
      const cancelState = str(obj(o.cancelStatus).cancelState);
      return {
        orderId,
        createdAt: str(o.creationDate),
        buyerUsername: str(buyer.username),
        buyerName: str(shipTo.fullName) ?? str(obj(buyer.buyerRegistrationAddress).fullName),
        shipTo: Object.keys(shipTo).length
          ? {
              name: str(shipTo.fullName),
              line1: str(addr.addressLine1),
              line2: str(addr.addressLine2),
              city: str(addr.city),
              state: str(addr.stateOrProvince),
              postalCode: str(addr.postalCode),
              country: str(addr.countryCode),
            }
          : null,
        fulfillmentStatus: str(o.orderFulfillmentStatus),
        cancelled: cancelState === "CANCELED",
        total: num(price.total),
        shipping: num(price.deliveryCost),
        fees: num(o.totalMarketplaceFee),
        lines: ((o.lineItems as unknown[]) ?? []).map((l) => {
          const li = obj(l);
          return {
            lineItemId: String(li.lineItemId ?? ""),
            legacyItemId: str(li.legacyItemId),
            title: str(li.title),
            sku: str(li.sku),
            quantity: Number(li.quantity ?? 1) || 1,
            lineCost: num(li.lineItemCost),
          };
        }),
      };
    })
    .filter((o): o is EbayOrder => o !== null);
}

/** Orders created since `sinceIso`. Null when eBay order access hasn't been
 *  granted yet (re-connect eBay to add it). */
export async function fetchEbayOrdersSince(sinceIso: string): Promise<EbayOrder[] | null> {
  if (!(await hasGrantedScope(FULFILLMENT_SCOPE))) return null;
  const out: EbayOrder[] = [];
  const filter = encodeURIComponent(`creationdate:[${sinceIso}..]`);
  let path: string | null = `/sell/fulfillment/v1/order?filter=${filter}&limit=200`;
  for (let page = 0; path && page < 10; page++) {
    const res: J = await sellApi<J>(path);
    out.push(...parseEbayOrders(res));
    const next: string | null = str(res.next);
    path = next;
  }
  return out;
}
