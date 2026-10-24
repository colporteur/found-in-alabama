// The Ephemeral State shipping schedule — approved 2026-08-17.
//
// Three classes, cart-computed: base price = the HIGHEST class present
// in the cart (that's the package we're actually building); every item
// beyond the base item adds at its own class's add-on rate. Free
// shipping when the merchandise subtotal reaches the highest-present
// class's threshold. The free thresholds are funded by the eBay→Stripe
// fee spread (~10-13 points), not subsidy.
//
// Pure module — no server imports — so the client cart can compute the
// same numbers the server verifies at checkout.
//
// SHIP-2 (Oct 24, 2026): an item's class comes from how it actually mails
// when FIA knows, and from its store shelves otherwise (itemShipClass):
//   eBay Standard Envelope listing        → paper (envelope rate)
//   flat paper ≤ $20 that fits a 12×15 flat → flat (stamped large envelope)
//   anything else                          → the heaviest of its two shelves
// The cheaper of the mail class and the shelf class wins, so a shelf marked
// bulky for its other items (Alabama Interest) no longer makes a baseball
// card pay the box rate.

export type ShipClass = "paper" | "flat" | "media" | "bulky";

export const SHIP_CLASS_RANK: Record<ShipClass, number> = {
  paper: 0,
  flat: 1,
  media: 2,
  bulky: 3,
};

export const SHIP_SCHEDULE: Record<
  ShipClass,
  { label: string; first: number; additional: number; freeAt: number }
> = {
  paper: { label: "Paper", first: 1.99, additional: 0.25, freeAt: 25 },
  flat: { label: "Flat mail", first: 2.49, additional: 0.25, freeAt: 25 },
  media: { label: "Books & media", first: 4.99, additional: 1.99, freeAt: 50 },
  bulky: { label: "Bulky", first: 8.99, additional: 2.99, freeAt: 75 },
};

export function normalizeShipClass(v: unknown): ShipClass {
  return v === "flat" || v === "media" || v === "bulky" ? v : "paper";
}

/** eBay ShippingService codes include Standard Envelope. */
export function isStandardEnvelope(services: unknown): boolean {
  return Array.isArray(services) && services.some((c) => /StandardEnvelope/i.test(String(c)));
}

/** One item's class: how it mails (when known) or its shelves. */
export function itemShipClass(shelf1: unknown, shelf2: unknown, mail: { services?: unknown; stampOk?: boolean | null }): ShipClass {
  const a = normalizeShipClass(shelf1);
  const b = normalizeShipClass(shelf2);
  const shelf = maxShipClass(a, b);
  if (isStandardEnvelope(mail.services)) return "paper";
  if (mail.stampOk && SHIP_CLASS_RANK[shelf] > SHIP_CLASS_RANK.flat) return "flat";
  return shelf;
}

/** The heavier of two classes (bulky > media > paper). */
export function maxShipClass(a: ShipClass, b: ShipClass): ShipClass {
  return SHIP_CLASS_RANK[a] >= SHIP_CLASS_RANK[b] ? a : b;
}

export type CartShipInput = {
  shipClass: ShipClass;
  quantity: number;
  price: number;
};

export type ShippingQuote = {
  subtotal: number;
  shipping: number;
  free: boolean;
  /** Class whose schedule governs the base + free threshold. */
  governingClass: ShipClass;
  freeAt: number;
  /** >0 when adding this much more merchandise makes shipping free. */
  remainingForFree: number;
};

export function quoteShipping(items: CartShipInput[]): ShippingQuote {
  const units: ShipClass[] = [];
  let subtotal = 0;
  for (const it of items) {
    const q = Math.max(0, Math.floor(it.quantity));
    subtotal += it.price * q;
    for (let i = 0; i < q; i++) units.push(normalizeShipClass(it.shipClass));
  }
  subtotal = Math.round(subtotal * 100) / 100;

  if (units.length === 0) {
    return {
      subtotal: 0,
      shipping: 0,
      free: false,
      governingClass: "paper",
      freeAt: SHIP_SCHEDULE.paper.freeAt,
      remainingForFree: SHIP_SCHEDULE.paper.freeAt,
    };
  }

  // Governing class = heaviest present; its unit is the "first item".
  units.sort((a, b) => SHIP_CLASS_RANK[b] - SHIP_CLASS_RANK[a]);
  const governing = units[0];
  const sched = SHIP_SCHEDULE[governing];

  let shipping = sched.first;
  for (const u of units.slice(1)) shipping += SHIP_SCHEDULE[u].additional;
  shipping = Math.round(shipping * 100) / 100;

  const free = subtotal >= sched.freeAt;
  return {
    subtotal,
    shipping: free ? 0 : shipping,
    free,
    governingClass: governing,
    freeAt: sched.freeAt,
    remainingForFree: free
      ? 0
      : Math.round((sched.freeAt - subtotal) * 100) / 100,
  };
}
