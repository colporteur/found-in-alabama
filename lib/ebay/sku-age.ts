// SKU parsing for true inventory age.
//
// Nifty's "end and sell similar" recreates listings on a rolling basis,
// resetting eBay's StartTime — so listing age systematically understates
// true inventory age. Todd's SKUs carry the truth:
//
//  - BIN SKUs (non-media): "NA" + sequential bin number, no suffix.
//    NA59, NA60 … NA317. Lower bin = older inventory. Ordinal, not a date.
//
//  - MEDIA SKUs: optional prefix token (record speed "33"/"78", format
//    "LP", …), then a digit run containing the date the item entered
//    inventory: YYMMDD or YYYYMMDD, optionally followed by a 3-digit
//    sequence (run together), optionally followed by further tokens.
//    Verified against real samples:
//      260610          → 2026-06-10
//      33 260508       → 2026-05-08
//      33 260412 13    → 2026-04-12 (trailing "13" = item seq)
//      250302004       → 2025-03-02 (seq 004 run together)
//      LP 251205001    → 2025-12-05
//      LP 251109       → 2025-11-09
//      20251005004     → 2025-10-05 (4-digit year + seq)
//
// The parser is deliberately strict: a candidate digit run only counts
// as a date if year/month/day all validate (year 2015..now+1, real
// calendar date, not future-dated beyond ~1 month). Anything ambiguous
// returns null and the caller falls back to eBay's StartTime — a fresh
// item accidentally landing in a sale is worse than a stale item being
// missed for one cycle.

const MIN_YEAR = 2015;

/** "NA204" → 204. Strict: NA + digits only, no suffixes. */
export function parseBinNumber(sku: string | null | undefined): number | null {
  if (!sku) return null;
  const m = sku.trim().match(/^NA(\d{1,4})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function validDate(
  year: number,
  month: number,
  day: number,
  now: Date
): Date | null {
  if (year < MIN_YEAR || year > now.getFullYear() + 1) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject impossible dates that rolled over (e.g. Feb 31 → Mar 3).
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  // Allow slight future-dating (clock skew / pre-staged bins), not more.
  if (d.getTime() > now.getTime() + 31 * 86_400_000) return null;
  return d;
}

/** Try to read one digit-run token as a date (+optional 3-digit seq). */
function dateFromDigits(digits: string, now: Date): Date | null {
  // 8 or 11 digits → YYYYMMDD (+SSS)
  if (digits.length === 8 || digits.length === 11) {
    const year = parseInt(digits.slice(0, 4), 10);
    const month = parseInt(digits.slice(4, 6), 10);
    const day = parseInt(digits.slice(6, 8), 10);
    const d = validDate(year, month, day, now);
    if (d) return d;
  }
  // 6 or 9 digits → YYMMDD (+SSS)
  if (digits.length === 6 || digits.length === 9) {
    const year = 2000 + parseInt(digits.slice(0, 2), 10);
    const month = parseInt(digits.slice(2, 4), 10);
    const day = parseInt(digits.slice(4, 6), 10);
    const d = validDate(year, month, day, now);
    if (d) return d;
  }
  return null;
}

/**
 * Extract the inventory date from a media SKU, or null if no token
 * validates. Bin SKUs (NA###) never parse as dates.
 */
export function parseSkuDate(
  sku: string | null | undefined,
  now: Date = new Date()
): Date | null {
  if (!sku) return null;
  const trimmed = sku.trim();
  if (!trimmed || parseBinNumber(trimmed) !== null) return null;

  // Examine whitespace-separated all-digit tokens, left to right; the
  // date is the first token that validates.
  for (const token of trimmed.split(/\s+/)) {
    if (!/^\d+$/.test(token)) continue;
    const d = dateFromDigits(token, now);
    if (d) return d;
  }
  return null;
}
