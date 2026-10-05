export type TesCategory = {
  categoryId: string;
  parentCategoryId: string | null;
  isEphemeralState: boolean;
};

/** Shared membership rule for the storefront, feeds, and channel previews. */
export function tesQualifyingSet(cats: TesCategory[]): Set<string> {
  const parentOf = new Map(cats.map((c) => [c.categoryId, c.parentCategoryId]));
  const flagged = new Set(cats.filter((c) => c.isEphemeralState).map((c) => c.categoryId));
  const out = new Set<string>();
  for (const c of cats) {
    let cur: string | null = c.categoryId;
    let hops = 0;
    while (cur != null && hops < 20) {
      if (flagged.has(cur)) {
        out.add(c.categoryId);
        break;
      }
      cur = parentOf.get(cur) ?? null;
      hops++;
    }
  }
  return out;
}
