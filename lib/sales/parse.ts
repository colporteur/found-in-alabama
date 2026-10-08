// Sale-email parsers (Phase SALES-1). Pure functions, no imports, so they
// can be unit-tested in isolation (lib/sales/parse.test.mts).
//
// Input is one email as stored in email_messages (from, subject, text/html
// body). Output is either a sale (venue + one line per item sold), a Nifty
// alert, or null for anything that isn't one of those.
//
// Only what's needed for matching is extracted: titles, venue listing ids,
// prices, the venue's order id. Buyer names and addresses are never
// extracted (they stay only in the raw stored message).

export type SaleVenue = "mercari" | "poshmark" | "depop" | "whatnot";

export type ParsedSaleLine = {
  title: string;
  /** True when the venue shortened the title (Depop "…"). Match by prefix. */
  titleTruncated: boolean;
  /** The venue's own listing id, when the email carries it (Mercari). */
  venueListingId: string | null;
  price: number | null;
};

export type ParsedSale = {
  kind: "sale";
  venue: SaleVenue;
  /** The venue's order id when present (Poshmark), for de-duplication. */
  orderRef: string | null;
  lines: ParsedSaleLine[];
};

export type ParsedNiftyAlert =
  | {
      kind: "nifty_failed_delist" | "nifty_failed_adjust";
      title: string;
      /** Venue Nifty detected the sale on, e.g. "ebay". */
      soldVenue: string | null;
      /** Venues Nifty could not update, with the reason it gave. */
      failed: { venue: string; reason: string }[];
    }
  | { kind: "nifty_reconnect"; venue: string };

export type ParsedEmail = ParsedSale | ParsedNiftyAlert | null;

export type EmailInput = {
  from: string | null;
  subject: string | null;
  text: string | null;
  html: string | null;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Very small HTML → text fallback for messages without a text part. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h\d|td)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Lowercase, collapse whitespace, strip a trailing ellipsis. Matches
 *  items.title_normalized (lower + trim + single spaces). */
export function normalizeTitle(t: string): string {
  return decodeEntities(t)
    .toLowerCase()
    .replace(/(\.\.\.|…)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function money(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function senderAddress(from: string | null): string {
  if (!from) return "";
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

function bodyText(e: EmailInput): string {
  let t = "";
  if (e.text && e.text.trim()) t = decodeEntities(e.text);
  else if (e.html) t = htmlToText(e.html);
  return t.replace(/\r\n?/g, "\n");
}

const VENUE_NAMES: Record<string, string> = {
  ebay: "ebay",
  etsy: "etsy",
  poshmark: "poshmark",
  mercari: "mercari",
  depop: "depop",
  whatnot: "whatnot",
};

function venueKey(name: string): string | null {
  return VENUE_NAMES[name.trim().toLowerCase()] ?? null;
}

// ─── venue parsers ────────────────────────────────────────────────────────────

function parseMercari(e: EmailInput, body: string): ParsedSale | null {
  const subject = decodeEntities(e.subject ?? "");
  const m = subject.match(/^You(?:'|’)ve made a sale:\s*(.+)$/i);
  if (!m) return null;
  const id = body.match(/\bID:\s*(m\d{6,})\b/);
  // "Price … $13.00" — the first dollar figure after "Price".
  const price = body.match(/Price[\s\S]{0,80}?\$\s?([\d,]+\.\d{2})/);
  return {
    kind: "sale",
    venue: "mercari",
    orderRef: id ? id[1] : null,
    lines: [
      {
        title: m[1].trim(),
        titleTruncated: false,
        venueListingId: id ? id[1] : null,
        price: money(price?.[1]),
      },
    ],
  };
}

function parsePoshmark(e: EmailInput, body: string): ParsedSale | null {
  const subject = decodeEntities(e.subject ?? "");
  // Single item: "\"<title>\" just sold to @buyer on Poshmark!"
  const single = subject.match(/^"(.+)"\s+just sold to @\S+ on Poshmark/i);
  const bundle = /just sold/i.test(subject) && /bundle/i.test(subject);
  if (!single && !bundle) return null;
  const order = body.match(/Order ID[\s|]*([0-9a-f]{20,})/i);

  // Item rows: "<title>" / "Size: …" / "Price: $24.00" (one block per item;
  // a bundle lists several).
  const rows = body
    .split("\n")
    .map((l) => l.replace(/^[\s|]+|[\s|]+$/g, "").trim())
    .filter(Boolean);
  const lines: ParsedSaleLine[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (!/^Size:/i.test(rows[i])) continue;
    const title = rows[i - 1];
    let price: number | null = null;
    for (let j = i + 1; j < Math.min(rows.length, i + 4); j++) {
      const p = rows[j].match(/^Price:\s*\$([\d,]+\.\d{2})/i);
      if (p) {
        price = money(p[1]);
        break;
      }
    }
    lines.push({ title, titleTruncated: false, venueListingId: null, price });
  }
  if (lines.length === 0 && single) {
    const p = body.match(/Price:\s*\$([\d,]+\.\d{2})/);
    lines.push({ title: single[1].trim(), titleTruncated: false, venueListingId: null, price: money(p?.[1]) });
  }
  return { kind: "sale", venue: "poshmark", orderRef: order ? order[1] : null, lines };
}

function parseWhatnot(e: EmailInput, body: string): ParsedSale | null {
  const subject = decodeEntities(e.subject ?? "");
  const m = subject.match(/^Your (.+) got sold!/i);
  if (!m) return null;
  const price = body.match(/has sold for \$([\d,]+\.\d{2})/i);
  return {
    kind: "sale",
    venue: "whatnot",
    orderRef: null,
    lines: [{ title: m[1].trim(), titleTruncated: false, venueListingId: null, price: money(price?.[1]) }],
  };
}

function parseDepop(e: EmailInput, body: string): ParsedSale | null {
  const subject = decodeEntities(e.subject ?? "");
  if (!/sale confirmation/i.test(subject) && !/You(?:'|’)ve made a sale/i.test(body)) return null;
  const start = body.search(/Order details/i);
  if (start < 0) return null;
  // Item block: pairs of "<title, often shortened with ...>" / "$7.98" lines
  // between "Order details" and the "Ship to" / "Payment details" block.
  // (The text part prefixes the title with the image alt "image ".)
  const lines = body
    .slice(start)
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ParsedSaleLine[] = [];
  let pending: string | null = null;
  for (const l of lines) {
    if (/^(Ship to|Payment details|Buyer|Item price)\b/i.test(l)) break;
    const price = l.match(/^\$([\d,]+\.\d{2})$/);
    if (price) {
      if (pending) {
        const truncated = /(\.\.\.|…)$/u.test(pending);
        out.push({
          title: pending.replace(/(\.\.\.|…)$/u, "").trim(),
          titleTruncated: truncated,
          venueListingId: null,
          price: money(price[1]),
        });
      }
      pending = null;
      continue;
    }
    pending = l.replace(/^image\s+/i, "");
  }
  if (out.length === 0) return null;
  return { kind: "sale", venue: "depop", orderRef: null, lines: out };
}

function parseNifty(e: EmailInput, body: string): ParsedNiftyAlert | null {
  const subject = decodeEntities(e.subject ?? "");
  const reconnect = subject.match(/Reconnect your (\w+) account/i);
  if (reconnect) {
    const v = venueKey(reconnect[1]);
    return v ? { kind: "nifty_reconnect", venue: v } : null;
  }
  const failedDelist = /Failed auto-delist/i.test(subject);
  const failedAdjust = /Failed auto-adjust/i.test(subject);
  if (!failedDelist && !failedAdjust) return null;
  const sale = body.match(/detected the sale of\s+"\s*\*?([\s\S]+?)\*?\s*"\s+on\s+(\w+)/i);
  if (!sale) return null;
  // Failed venues: one "<Venue>: <reason>" line each, between "…following
  // marketplaces:" and the closing paragraph.
  const failed: { venue: string; reason: string }[] = [];
  const listStart = body.search(/following marketplaces:/i);
  if (listStart >= 0) {
    const rest = body.slice(listStart).split("\n").slice(1);
    for (const raw of rest) {
      const l = raw
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*\u2022]/g, " ")
        .replace(/^\s*[-–]\s+/, "")
        .trim();
      if (!l) continue;
      if (/^(When you have a moment|Thanks|Please)/i.test(l)) break;
      const m = l.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
      if (!m) continue;
      const v = venueKey(m[1]);
      if (!v) continue;
      failed.push({ venue: v, reason: m[2].split(/(?<=\.)\s/)[0].trim() });
    }
  }
  return {
    kind: failedDelist ? "nifty_failed_delist" : "nifty_failed_adjust",
    title: sale[1].replace(/\s+/g, " ").trim(),
    soldVenue: venueKey(sale[2]),
    failed,
  };
}

// ─── entry point ──────────────────────────────────────────────────────────────

export function parseSaleEmail(e: EmailInput): ParsedEmail {
  const from = senderAddress(e.from);
  const body = bodyText(e);
  if (from.endsWith("mercari.com")) return parseMercari(e, body);
  if (from === "orders@poshmark.com") return parsePoshmark(e, body);
  if (from.endsWith("whatnot.com")) return parseWhatnot(e, body);
  if (from.endsWith("depop.com")) return parseDepop(e, body);
  if (from.endsWith("nifty.ai")) return parseNifty(e, body);
  return null;
}
