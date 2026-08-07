// Shared store-category tree helpers.
//
// eBay's custom store categories are a tree, but every dropdown in this
// admin used to render them as a flat alphabetical list of leaf names.
// That's misleading in two ways once subcategories exist:
//
//   1. A leaf name like "Christmas & New Year's" reads as a holiday
//      category when it actually means "Postcards › Christmas & New
//      Year's". Whoever (or whatever) is picking can't tell.
//   2. Parent categories appear as choices even though eBay REJECTS any
//      item assigned to a category that has children — picking one is a
//      guaranteed ReviseItem failure.
//
// These helpers annotate the raw rows with full paths, depth, and leaf
// status so both the UI and the AI categorizer can be honest about shape.

export type RawCategory = {
  categoryId: string;
  parentCategoryId: string | null;
  name: string;
};

export type CategoryNode = {
  categoryId: string;
  name: string;
  /** "Postcards › Christmas & New Year's" */
  path: string;
  /** 0 for top-level. */
  depth: number;
  /** False when the category has children — eBay won't hold items there. */
  isLeaf: boolean;
};

const SEP = " › ";

/**
 * Annotate categories with path/depth/leaf, sorted so each parent is
 * immediately followed by its descendants (path-alphabetical order).
 */
export function buildCategoryTree(rows: RawCategory[]): CategoryNode[] {
  const byId = new Map(rows.map((r) => [r.categoryId, r]));
  const parentIds = new Set(
    rows.map((r) => r.parentCategoryId).filter((p): p is string => !!p)
  );

  const nodes = rows.map((r) => {
    const parts: string[] = [];
    let cursor: string | null = r.categoryId;
    const guard = new Set<string>(); // malformed trees shouldn't hang us
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      const node = byId.get(cursor);
      if (!node) break;
      parts.unshift(node.name);
      cursor = node.parentCategoryId;
    }
    return {
      categoryId: r.categoryId,
      name: r.name,
      path: parts.join(SEP),
      depth: Math.max(0, parts.length - 1),
      isLeaf: !parentIds.has(r.categoryId),
    };
  });

  return nodes.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Indented label for a <select> option: nesting shown by leading spaces,
 * parents marked as unusable so nobody picks a guaranteed failure.
 */
export function optionLabel(node: CategoryNode): string {
  const indent = "  ".repeat(node.depth);
  return `${indent}${node.name}${node.isLeaf ? "" : " (parent — can't hold items)"}`;
}
