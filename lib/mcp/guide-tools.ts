// Expert Guide learning loop (Phase 5c), connector side.
//
// guide_results is read-only and offered on every connection: Todd's own
// sold and live items under each Expert Guide, kept apart from the guide's
// market survey. The guide_link_* tools file items under guides; they change
// only that filing (never a listing, a price or a guide) and are offered on
// connections Todd allowed to write, like the listing tools.

import { argDate, argEnum, argNum, argStr, type ToolDef } from "./protocol";
import { guideResults, guideResultsOverview } from "@/lib/guides/results";
import { linkQueue, linkQueueShelves, linkableGuides, runLinkerUntilDone, saveLinks, saveShelf } from "@/lib/guides/links";

const bool = (a: Record<string, unknown>, k: string) => a[k] === true || a[k] === "true";

export const guideReadTools: ToolDef[] = [
  {
    name: "guide_results",
    title: "Todd's own results for an Expert Guide",
    description:
      "Todd's OWN sales and unsold inventory filed under an Expert Guide — separate from the guide's market survey. With no guide_id: one row per guide (sold, median sold price, days to sell, live count, asking median, items listed over 180 days) plus how much of the inventory is filed. With guide_id: that guide in full (price quartiles, hit rates, days to sell, venue mix, by month, top and recent sales, oldest unsold). Medians use true sold prices only; sales known only by listed price are counted but not priced. Default window is the last 365 days (US Central). These samples are small: report them as Todd's results, never blend them into a guide's market numbers.",
    inputSchema: {
      type: "object",
      properties: {
        guide_id: { type: "string", description: "Guide id from listing_find_guide; omit for the overview" },
        from: { type: "string", description: "YYYY-MM-DD, default 365 days ago" },
        to: { type: "string", description: "YYYY-MM-DD inclusive, default today" },
        include_children: { type: "boolean", description: "Also count items filed under this guide's child guides", default: false },
        include_unsure: { type: "boolean", description: "Also count links still awaiting review", default: false },
        items: { type: "number", description: "How many recent sales to list (≤ 100)", default: 25 },
      },
    },
    run: async (a) => {
      const id = argStr(a, "guide_id", 120);
      const from = argDate(a, "from"), to = argDate(a, "to");
      if (!id) return guideResultsOverview({ from, to });
      return guideResults(id, {
        from, to, includeChildren: bool(a, "include_children"), includeUnsure: bool(a, "include_unsure"),
        items: argNum(a, "items", 25, 0, 100) ?? 25,
      });
    },
  },
];

export function guideLinkTools(who: string): ToolDef[] {
  return [
    {
      name: "guide_link_run",
      title: "File items under guides by keyword",
      description:
        "Run the free keyword linker: every sold or live item not yet looked at is scored against each guide's keywords, eBay category and store shelf and filed when the match is clear. Unclear ones wait in guide_link_queue. Set rescore after a guide was added or its keywords changed to re-score the linker's earlier guesses (decisions by Claude or Todd are never touched). Call again while 'remaining' is above 0.",
      readOnly: false,
      inputSchema: { type: "object", properties: { rescore: { type: "boolean", default: false } } },
      run: async (a) => runLinkerUntilDone({ rescore: bool(a, "rescore"), budgetMs: 40_000 }),
    },
    {
      name: "guide_link_queue",
      title: "Items waiting to be filed under a guide",
      description:
        "Items the keyword linker could not file with confidence, sold items first. kind 'review' (default): a guide was suggested but the match is weak — decide each. kind 'unmatched': no guide word at all; most belong to no guide. group_by_shelf lists the pile by store shelf with examples, so a whole shelf can be settled at once with guide_link_save's shelf form. The reply includes the list of guides items can be filed under (set guides false to leave it out after the first call).",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["review", "unmatched"], default: "review" },
          status: { type: "string", enum: ["sold", "live", "any"], default: "any" },
          guide_id: { type: "string", description: "Only items suggested for (or tied with) this guide" },
          shelf: { type: "string", description: "Only items on this store shelf" },
          group_by_shelf: { type: "boolean", default: false },
          guides: { type: "boolean", default: true },
          limit: { type: "number", default: 60, description: "≤ 150" },
        },
      },
      run: async (a) => {
        const kind = argEnum(a, "kind", ["review", "unmatched"] as const, "review");
        const lib = a.guides === false || a.guides === "false" ? undefined
          : (await linkableGuides()).map((g) => ({ id: g.id, name: g.name, family: g.family, parent: g.parent }));
        if (bool(a, "group_by_shelf")) return { kind, shelves: await linkQueueShelves(kind), guides: lib };
        const q = await linkQueue({
          kind, status: argEnum(a, "status", ["sold", "live", "any"] as const, "any"),
          guideId: argStr(a, "guide_id", 120), shelf: argStr(a, "shelf", 120), limit: argNum(a, "limit", 60, 1, 150) ?? 60,
        });
        return {
          ...q, guides: lib,
          how: "File an item under the most specific guide that truly covers that kind of item (the child guide over its parent). If no guide covers it, save it with guide_id null — a wrong link is worse than none. Judge from the title; do not guess.",
        };
      },
    },
    {
      name: "guide_link_save",
      title: "Save which guide items belong to",
      description:
        "Record decisions from guide_link_queue. Either 'links' (up to 300 of {item_id, guide_id}; guide_id null means no guide covers the item), or the shelf form: 'shelf' + 'guide_id' (null allowed) + 'kind' to settle every still-undecided item on one store shelf. Changes only the filing used by guide_results.",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          links: {
            type: "array", maxItems: 300,
            items: { type: "object", required: ["item_id"], properties: { item_id: { type: "string" }, guide_id: { type: ["string", "null"] } } },
          },
          shelf: { type: "string" },
          guide_id: { type: ["string", "null"], description: "With shelf: the guide for the whole shelf, or null for none" },
          kind: { type: "string", enum: ["review", "unmatched"], default: "unmatched" },
        },
      },
      run: async (a) => {
        const shelf = argStr(a, "shelf", 120);
        if (shelf) {
          const gid = a.guide_id == null || a.guide_id === "" ? null : String(a.guide_id);
          return saveShelf(shelf, gid, argEnum(a, "kind", ["review", "unmatched"] as const, "unmatched"), who);
        }
        const links = Array.isArray(a.links) ? (a.links as Array<Record<string, unknown>>) : [];
        if (!links.length) throw new Error("Give links, or a shelf with a guide_id");
        return saveLinks(
          links.map((l) => ({ itemId: String(l.item_id ?? ""), guideId: l.guide_id == null || l.guide_id === "" ? null : String(l.guide_id) })),
          who
        );
      },
    },
  ];
}
