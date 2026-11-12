// Alabama buyers (COUPON-3): a package going to an Alabama address gets a
// Found in Alabama sticker, so the invoice says so in big print and the
// Ship page shows an "AL" chip. Its invoice code defaults to a FIA… code
// pitching foundinalabama.com (a shelf or search Todd picks still wins).
//
// Only packages FIA has an address for can be told apart: eBay, website and
// Hip orders, and Depop when the sale email carried the ship-to. Mercari,
// Poshmark and Whatnot don't give FIA the address, so those never get the
// mark — check the label by hand.

import { addressLabels } from "@/lib/labels/address";

// Alabama ZIP codes are 350xx–369xx.
const AL_ZIP = /^3(5\d|6\d)\d{2}(-\d{4})?$/;
const STATE = /(?:^|[\s,])(AL|ALA|ALABAMA)\.?(?:\s+(\d{5}(?:-\d{4})?))?\s*$/i;
const STATE_ZIP = /(?:^|[\s,])(AL|ALA|ALABAMA)\.?\s+(\d{5})(?:-\d{4})?\b/i;
const OTHER_COUNTRY = /^(?!US$|USA$|UNITED STATES)[A-Z][A-Z .'-]{2,}$/;

/** Pure: is this address in Alabama? Takes label lines (as addressLines
 *  makes them) or one flattened string (a Depop ship-to). The state must be
 *  written as AL / Ala. / Alabama after the city, or the ZIP must be an
 *  Alabama one with no other state named. */
export function isAlabamaAddress(addr: string[] | string | null | undefined): boolean {
  const lines = (Array.isArray(addr) ? addr : [addr ?? ""]).map((l) => String(l ?? "").trim()).filter(Boolean);
  if (!lines.length) return false;
  // A foreign country line at the end (addressLines drops US) rules it out.
  const last = lines[lines.length - 1].toUpperCase();
  if (lines.length > 2 && OTHER_COUNTRY.test(last) && !/\d/.test(last) && !STATE.test(last)) return false;
  for (const raw of lines) {
    // Skip the street lines' "123 Ala Moana" style matches: the state has
    // to follow a comma or sit right before a ZIP.
    const line = raw.replace(/\s+/g, " ");
    const sz = line.match(STATE_ZIP);
    if (sz) return AL_ZIP.test(sz[2]);
    const st = line.match(STATE);
    if (st && (st[2] ? AL_ZIP.test(st[2]) : /,\s*(AL|ALA|ALABAMA)\.?\s*$/i.test(line))) return true;
  }
  // No state written: an Alabama ZIP ending a city line still counts,
  // unless some other two-letter state sits in front of it.
  for (const line of lines) {
    const m = line.match(/(?:^|[\s,])([A-Z]{2})?\s*(\d{5}(?:-\d{4})?)\s*$/i);
    if (m && AL_ZIP.test(m[2]) && (!m[1] || /^AL$/i.test(m[1]))) return true;
  }
  return false;
}

/** The ship_orders ids (of those given) whose package goes to Alabama. */
export async function alabamaOrderIds(shipIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!shipIds.length) return out;
  for (const a of await addressLabels([], shipIds)) {
    if (a.lines.length > 1 && isAlabamaAddress(a.lines)) out.add(a.key.slice(2));
  }
  return out;
}
