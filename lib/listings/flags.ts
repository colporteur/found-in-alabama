// Flags on a draft Claude wrote (ai_meta.flags) are of two kinds: the ones
// Claude raised ("no photo of the back", "size is from references") and the
// ones FIA works out every time a draft is saved (weight, category, item
// specifics). When Claude revises a draft, its own earlier flags should stay
// unless it sends a new list; FIA's are worked out again by the save, so they
// are left out here to avoid stale or doubled lines.

const WORKED_OUT_BY_FIA = /^(Dropped item specifics that aren't fields in this category|eBay requires:|No eBay category from the store's list|No weight: not paper)/;

/** The earlier flags a revision should keep. Pure. */
export function carriedFlags(previous: unknown): string[] {
  if (!Array.isArray(previous)) return [];
  const out: string[] = [];
  for (const f of previous) {
    const s = String(f ?? "").trim();
    if (s && !WORKED_OUT_BY_FIA.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}
