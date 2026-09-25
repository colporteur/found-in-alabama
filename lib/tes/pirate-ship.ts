// Pirate Ship bridge for The Ephemeral State (Phase SHIP-1).
//
// Pirate Ship has no public API and no connector for a custom Stripe
// checkout, so the integration is spreadsheet-based both ways:
//
//   OUT  buildPirateShipCsv()  — paid, unshipped TES orders → a CSV that
//        Pirate Ship's "Upload a spreadsheet" accepts. Pirate Ship
//        remembers the column mapping after the first upload, so the
//        header names below must stay stable.
//   IN   extractTracking()     — Pirate Ship's shipment export CSV →
//        {orderId, tracking, carrier} rows. Header detection is fuzzy
//        because Pirate Ship's export column names are not documented;
//        matching falls back to recipient name + ZIP when the export has
//        no Order ID column.
//
// Pure module — no server imports — so it is unit-testable in plain Node.

import type { ShipClass } from "./shipping";

// ─── Package presets ─────────────────────────────────────────────────────────
// Starting estimates per ship class. The heaviest class on the order sets
// the box + base weight; each additional unit adds its own class's
// increment. Pirate Ship shows every weight before you buy, so these only
// need to be close — tune them here once you've weighed a few real parcels.

export type PackagePreset = {
  label: string;
  /** Packed weight of the first (governing) item, ounces. */
  baseOz: number;
  /** Added weight per additional unit of this class, ounces. */
  addOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

export const PACKAGE_PRESETS: Record<ShipClass, PackagePreset> = {
  // Rigid 6×9 mailer with a board sandwich.
  paper: { label: "Rigid mailer", baseOz: 3, addOz: 0.5, lengthIn: 9, widthIn: 6, heightIn: 0.5 },
  // Book box / padded mailer.
  media: { label: "Book box", baseOz: 16, addOz: 8, lengthIn: 10, widthIn: 8, heightIn: 2 },
  // Small box.
  bulky: { label: "Small box", baseOz: 32, addOz: 16, lengthIn: 12, widthIn: 10, heightIn: 4 },
};

const RANK: Record<ShipClass, number> = { paper: 0, media: 1, bulky: 2 };

function normClass(v: unknown): ShipClass {
  return v === "media" || v === "bulky" ? v : "paper";
}

export type PackageEstimate = {
  shipClass: ShipClass;
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

export function estimatePackage(
  lines: { shipClass: string; quantity: number }[]
): PackageEstimate {
  const units: ShipClass[] = [];
  for (const l of lines) {
    const q = Math.max(0, Math.floor(Number(l.quantity) || 0));
    for (let i = 0; i < q; i++) units.push(normClass(l.shipClass));
  }
  if (units.length === 0) units.push("paper");
  units.sort((a, b) => RANK[b] - RANK[a]);
  const gov = PACKAGE_PRESETS[units[0]];
  let oz = gov.baseOz;
  for (const u of units.slice(1)) oz += PACKAGE_PRESETS[u].addOz;
  return {
    shipClass: units[0],
    weightOz: Math.round(oz * 10) / 10,
    lengthIn: gov.lengthIn,
    widthIn: gov.widthIn,
    heightIn: gov.heightIn,
  };
}

// ─── CSV out ─────────────────────────────────────────────────────────────────

export type ExportOrder = {
  id: string;
  shippingName: string | null;
  email: string | null;
  shippingAddress: unknown;
  items: { sku: string | null; title: string; quantity: number; shipClass: string }[];
};

type StripeAddress = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

/** Header row — Pirate Ship remembers the mapping by these names. */
export const PIRATE_SHIP_HEADERS = [
  "Order ID",
  "Name",
  "Address Line 1",
  "Address Line 2",
  "City",
  "State",
  "Zipcode",
  "Country",
  "Email",
  "Weight (oz)",
  "Length (in)",
  "Width (in)",
  "Height (in)",
  "Rubber Stamp 1",
  "Rubber Stamp 2",
  "Rubber Stamp 3",
] as const;

/** Rubber stamps print in label corners — keep them short. */
export const STAMP_MAX = 40;

function clip(s: string, n = STAMP_MAX): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Neutralize spreadsheet formula injection from buyer-entered fields.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Bin numbers (SKUs) for the pick, e.g. "Bins: 12, 14×2, 31". */
export function binStamp(items: ExportOrder["items"]): string {
  const counts = new Map<string, number>();
  for (const it of items) {
    const key = (it.sku ?? "").trim() || "no SKU";
    counts.set(key, (counts.get(key) ?? 0) + Math.max(1, it.quantity));
  }
  const parts = Array.from(counts, ([k, n]) => (n > 1 ? `${k}×${n}` : k));
  return clip(`Bins: ${parts.join(", ")}`);
}

export function buildPirateShipRows(orders: ExportOrder[]): string[][] {
  return orders.map((o) => {
    const a = (o.shippingAddress ?? {}) as StripeAddress;
    const pkg = estimatePackage(o.items);
    const units = o.items.reduce((n, i) => n + Math.max(1, i.quantity), 0);
    return [
      o.id,
      o.shippingName ?? "",
      a.line1 ?? "",
      a.line2 ?? "",
      a.city ?? "",
      a.state ?? "",
      a.postal_code ?? "",
      a.country ?? "US",
      o.email ?? "",
      String(pkg.weightOz),
      String(pkg.lengthIn),
      String(pkg.widthIn),
      String(pkg.heightIn),
      binStamp(o.items),
      clip(`TES #${o.id.slice(0, 8)}`),
      clip(`${units} item${units === 1 ? "" : "s"} · ${pkg.shipClass}`),
    ];
  });
}

export function toCsv(rows: (readonly string[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function buildPirateShipCsv(orders: ExportOrder[]): string {
  return toCsv([PIRATE_SHIP_HEADERS, ...buildPirateShipRows(orders)]);
}

// ─── CSV in ──────────────────────────────────────────────────────────────────

/** RFC 4180 parser (quoted fields, doubled quotes, CRLF/LF, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export type TrackingRow = {
  /** tes_orders.id when the export carried it; else null. */
  orderId: string | null;
  tracking: string;
  carrier: string | null;
  /** Fallback match keys when orderId is null. */
  name: string | null;
  zip5: string | null;
  /** 1-based spreadsheet row, for error messages. */
  line: number;
};

function findCol(headers: string[], tests: RegExp[], avoid?: RegExp): number {
  for (const t of tests) {
    const i = headers.findIndex((h) => t.test(h) && !(avoid && avoid.test(h)));
    if (i >= 0) return i;
  }
  return -1;
}

export type TrackingParse =
  | { ok: true; rows: TrackingRow[]; voidedSkipped: number }
  | { ok: false; error: string };

export function extractTracking(text: string): TrackingParse {
  const table = parseCsv(text);
  if (table.length < 2) return { ok: false, error: "The file has no data rows." };
  const headers = table[0].map((h) => h.trim().toLowerCase());

  const iTrack = findCol(headers, [/^tracking( number| #|)$/, /tracking/], /url|link|status/);
  if (iTrack < 0) {
    return { ok: false, error: "Couldn't find a Tracking column — is this Pirate Ship's shipment export?" };
  }
  const iOrder = findCol(headers, [/^order( id| number| #)$/, /order/]);
  const iCarrier = findCol(headers, [/carrier/]);
  const iStatus = findCol(headers, [/status/]);
  const iName = findCol(headers, [/^(recipient|ship to|to)?\s*name$/, /recipient/, /name/], /company|service|user|stamp/);
  const iZip = findCol(headers, [/zip/, /postal/]);

  const rows: TrackingRow[] = [];
  let voidedSkipped = 0;
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const tracking = (cells[iTrack] ?? "").replace(/\s+/g, "");
    if (!tracking) continue;
    if (iStatus >= 0 && /void|refund|cancel/i.test(cells[iStatus] ?? "")) {
      voidedSkipped++;
      continue;
    }
    let orderId: string | null = null;
    const cand = iOrder >= 0 ? cells[iOrder] ?? "" : "";
    const m = cand.match(UUID_RE) ?? cells.join(" ").match(UUID_RE);
    if (m) orderId = m[0].toLowerCase();
    const zipRaw = iZip >= 0 ? cells[iZip] ?? "" : "";
    const zip5 = zipRaw.match(/\d{5}/)?.[0] ?? null;
    rows.push({
      orderId,
      tracking,
      carrier: (iCarrier >= 0 ? (cells[iCarrier] ?? "").trim() : "") || guessCarrier(tracking),
      name: iName >= 0 ? (cells[iName] ?? "").trim() || null : null,
      zip5,
      line: r + 1,
    });
  }
  return { ok: true, rows, voidedSkipped };
}

export function guessCarrier(tracking: string): string | null {
  if (/^1Z[0-9A-Z]{16}$/i.test(tracking)) return "UPS";
  if (/^\d{20,22}$/.test(tracking) || /^9\d{15,}$/.test(tracking)) return "USPS";
  return null;
}

/**
 * carrier value for an order Todd marked "don't ship" (test orders,
 * local pickup, refunded before shipping). shipped_at is set so every
 * shipping queue skips it; tracking stays null.
 */
export const NOT_SHIPPING = "not shipping";

export function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function trackingUrl(tracking: string, carrier: string | null): string {
  const t = encodeURIComponent(tracking);
  if ((carrier ?? guessCarrier(tracking)) === "UPS") {
    return `https://www.ups.com/track?tracknum=${t}`;
  }
  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`;
}
