// Pick-list ordering by bin SKU — the same rules as the Nifty Pick List
// extension (Todd's spec), so the printed list walks the shelves the same way.
//   dated      YYMMDD, optionally with a prefix ("260322", "33 260220"):
//              grouped by prefix, newest date first
//   inventory  NA### / LT###: grouped by prefix, highest number first
//   named      anything else ("Apps", "Smalls 1"): grouped by the full SKU,
//              kept in the order given
// Sections print dated → inventory → named; groups A→Z (numeric-aware).
// Pure; tested in sku.test.mts.

export type SkuClass = {
  type: "dated" | "inventory" | "named";
  group: string;
  /** dated: "YYMMDD"; inventory: the number; named: 0 */
  sortKey: string | number;
  sku: string;
};

export function classifySku(raw: string | null | undefined): SkuClass {
  const sku = (raw ?? "").trim();
  if (!sku) return { type: "named", group: "(no SKU)", sortKey: 0, sku };

  const inv = sku.match(/^(NA|LT)\s*(\d+)$/i);
  if (inv) {
    const prefix = inv[1].toUpperCase();
    return { type: "inventory", group: prefix, sortKey: parseInt(inv[2], 10), sku: prefix + inv[2] };
  }

  const dated = sku.match(/^(.*?)\s*(\d{6})$/);
  if (dated) {
    const mm = parseInt(dated[2].slice(2, 4), 10);
    const dd = parseInt(dated[2].slice(4, 6), 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return { type: "dated", group: dated[1].trim() || "(no prefix)", sortKey: dated[2], sku };
    }
  }

  return { type: "named", group: sku, sortKey: 0, sku };
}

export const SECTION_TITLES: Record<SkuClass["type"], { title: string; note: string }> = {
  dated: { title: "Dated SKUs", note: "Newest first." },
  inventory: { title: "Inventory SKUs", note: "Highest number first." },
  named: { title: "Named SKUs", note: "Grouped together." },
};

export type PickSection<T> = {
  type: SkuClass["type"];
  title: string;
  note: string;
  groups: Array<{ name: string; items: T[] }>;
  count: number;
};

/** Sections → groups → items, in walking order. Empty sections dropped. */
export function buildPickSections<T>(items: T[], skuOf: (t: T) => string | null | undefined): PickSection<T>[] {
  const order: SkuClass["type"][] = ["dated", "inventory", "named"];
  const by = new Map<SkuClass["type"], Map<string, Array<{ item: T; cls: SkuClass }>>>();
  for (const t of order) by.set(t, new Map());
  for (const item of items) {
    const cls = classifySku(skuOf(item));
    const groups = by.get(cls.type)!;
    if (!groups.has(cls.group)) groups.set(cls.group, []);
    groups.get(cls.group)!.push({ item, cls });
  }
  const out: PickSection<T>[] = [];
  for (const type of order) {
    const groups = Array.from(by.get(type)!.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    if (!groups.length) continue;
    for (const [, list] of groups) {
      if (type === "dated") list.sort((a, b) => String(b.cls.sortKey).localeCompare(String(a.cls.sortKey)));
      if (type === "inventory") list.sort((a, b) => Number(b.cls.sortKey) - Number(a.cls.sortKey));
    }
    out.push({
      type,
      ...SECTION_TITLES[type],
      groups: groups.map(([name, list]) => ({ name, items: list.map((x) => x.item) })),
      count: groups.reduce((n, [, l]) => n + l.length, 0),
    });
  }
  return out;
}
