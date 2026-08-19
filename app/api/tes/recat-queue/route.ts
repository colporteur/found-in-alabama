// The TES recategorize queue. Auth on both verbs: Bearer <api key>
// (same keys as /admin/api-keys).
//
// POST — the storefront overlay (via the extension background worker)
//   flags an item: { itemId, slots: [{ slot: 1|2, mode: "ai"|"manual",
//   categoryId? }] }. Manual slots name their replacement; AI slots are
//   resolved HERE, at enqueue time, with the same categorizer the admin
//   tool uses (lib/ebay/categorize.ts, gateway alias fia-cheap) so the
//   queue always stores concrete category ids.
//
// GET — the extension actuator pulls pending work. Each entry carries
//   remove/add as full category PATHS in Nifty's format ("Parent >
//   Child"), ready to match against the Store categories popover.

import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings, ebayStoreCategories, tesRecatQueue } from "@/db/schema";
import { bearerFromRequest, verifyApiKey } from "@/lib/api-keys";
import { buildCategoryTree } from "@/lib/ebay/category-tree";
import { suggestCategoryForListing, type CategoryOption } from "@/lib/ebay/categorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Site paths use " › "; Nifty's popover renders " > ". */
const toNiftyPath = (p: string) => p.replace(/\s*›\s*/g, " > ");

async function auth(req: NextRequest) {
  const token = bearerFromRequest(req);
  return token ? await verifyApiKey(token) : null;
}

// ── GET: pending work for the actuator ──────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!(await auth(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(tesRecatQueue)
    .where(eq(tesRecatQueue.status, "pending"))
    .limit(15);
  if (rows.length === 0) return NextResponse.json({ ok: true, entries: [] });

  const cats = await db.select().from(ebayStoreCategories);
  const pathById = new Map(buildCategoryTree(cats).map((n) => [n.categoryId, n.path]));
  const ref = (id: string) => ({
    id,
    path: toNiftyPath(pathById.get(id) ?? id),
  });

  return NextResponse.json({
    ok: true,
    entries: rows.map((r) => {
      const oldSet = new Set([r.oldCategory1Id, r.oldCategory2Id].filter(Boolean) as string[]);
      const newSet = new Set(
        [r.newCategory1Id ?? r.oldCategory1Id, r.newCategory2Id ?? r.oldCategory2Id].filter(
          Boolean
        ) as string[]
      );
      return {
        id: r.id,
        itemId: r.itemId,
        title: r.title,
        sku: r.sku,
        // Advisory diff vs the eBay mirror. Nifty may hold DIFFERENT
        // categories (the Redistribute op revises eBay only), so the
        // actuator reconciles to `target` and ignores stale chips.
        remove: [...oldSet].filter((id) => !newSet.has(id)).map(ref),
        add: [...newSet].filter((id) => !oldSet.has(id)).map(ref),
        /** The final desired set — what Nifty's chips should be after. */
        target: [...newSet].map(ref),
        mode: r.mode,
        aiConfidence: r.aiConfidence,
      };
    }),
  });
}

// ── POST: flag an item from the storefront overlay ──────────────────────────

type SlotRequest = { slot: 1 | 2; mode: "ai" | "manual"; categoryId?: string };
type Body = { itemId?: string; slots?: SlotRequest[] };

export async function POST(req: NextRequest) {
  if (!(await auth(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const itemId = body.itemId?.trim();
  const slots = (body.slots ?? []).filter((s) => s.slot === 1 || s.slot === 2);
  if (!itemId || slots.length === 0) {
    return NextResponse.json(
      { ok: false, error: "itemId and at least one slot required" },
      { status: 400 }
    );
  }
  if (slots.length === 2 && slots[0].slot === slots[1].slot) {
    return NextResponse.json({ ok: false, error: "Duplicate slot" }, { status: 400 });
  }

  const [listing] = await db
    .select()
    .from(ebayListings)
    .where(eq(ebayListings.itemId, itemId))
    .limit(1);
  if (!listing) {
    return NextResponse.json(
      { ok: false, error: "Listing not in local mirror — run a listings sync" },
      { status: 404 }
    );
  }

  const dupe = await db
    .select({ id: tesRecatQueue.id })
    .from(tesRecatQueue)
    .where(and(eq(tesRecatQueue.itemId, itemId), eq(tesRecatQueue.status, "pending")))
    .limit(1);
  if (dupe.length > 0) {
    return NextResponse.json(
      { ok: false, error: "Item is already in the recategorize queue" },
      { status: 409 }
    );
  }

  const catRows = await db.select().from(ebayStoreCategories);
  const tree = buildCategoryTree(catRows);
  const alabamaById = new Map(catRows.map((c) => [c.categoryId, c.isAlabamaRelated]));
  const leaves = tree.filter((n) => n.isLeaf);
  const leafIds = new Set(leaves.map((n) => n.categoryId));
  const pathById = new Map(tree.map((n) => [n.categoryId, n.path]));

  const oldBySlot: Record<1 | 2, string | null> = {
    1: listing.storeCategory1Id,
    2: listing.storeCategory2Id,
  };

  // Final id per slot; starts as "unchanged".
  const finalBySlot: Record<1 | 2, string | null> = { ...oldBySlot };
  const otherOf = (s: 1 | 2): 1 | 2 => (s === 1 ? 2 : 1);

  // Manual slots first — they constrain what the AI may pick.
  for (const s of slots.filter((x) => x.mode === "manual")) {
    const id = s.categoryId?.trim();
    if (!id || !leafIds.has(id)) {
      return NextResponse.json(
        { ok: false, error: `Slot ${s.slot}: categoryId must be an assignable (leaf) category` },
        { status: 400 }
      );
    }
    if (id === oldBySlot[s.slot]) {
      return NextResponse.json(
        { ok: false, error: `Slot ${s.slot}: target equals the current category` },
        { status: 400 }
      );
    }
    finalBySlot[s.slot] = id;
  }

  // AI slots: one categorizer call covers both (primary + secondary).
  const aiSlots = slots.filter((x) => x.mode === "ai");
  let aiConfidence: string | null = null;
  let aiReasoning: string | null = null;
  if (aiSlots.length > 0) {
    const options: CategoryOption[] = leaves.map((n) => ({
      id: n.categoryId,
      name: n.name,
      path: n.path,
      isAlabama: alabamaById.get(n.categoryId) ?? false,
    }));
    let suggestion;
    try {
      suggestion = await suggestCategoryForListing({ title: listing.title, categories: options });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: `AI categorizer failed: ${(err as Error).message}` },
        { status: 502 }
      );
    }
    aiConfidence = suggestion.confidence.toFixed(3);
    aiReasoning = suggestion.reasoning || null;

    const candidates = [suggestion.primaryCategoryId, suggestion.secondaryCategoryId].filter(
      (x): x is string => !!x
    );
    for (const s of aiSlots) {
      const taken = new Set([finalBySlot[otherOf(s.slot)]].filter(Boolean) as string[]);
      const pick = candidates.find((c) => !taken.has(c) && c !== oldBySlot[s.slot]);
      if (!pick) {
        const agreed = candidates.includes(oldBySlot[s.slot] ?? "");
        return NextResponse.json(
          {
            ok: false,
            error: agreed
              ? `AI thinks the current category is right (${suggestion.reasoning})`
              : `AI couldn't pick a category for slot ${s.slot} (${suggestion.reasoning || "no fit"})`,
          },
          { status: 422 }
        );
      }
      finalBySlot[s.slot] = pick;
    }
  }

  const changed1 = finalBySlot[1] !== oldBySlot[1] ? finalBySlot[1] : null;
  const changed2 = finalBySlot[2] !== oldBySlot[2] ? finalBySlot[2] : null;
  if (!changed1 && !changed2) {
    return NextResponse.json({ ok: false, error: "Nothing would change" }, { status: 400 });
  }

  const mode =
    aiSlots.length === slots.length ? "ai" : aiSlots.length === 0 ? "manual" : "mixed";

  const [entry] = await db
    .insert(tesRecatQueue)
    .values({
      itemId,
      title: listing.title,
      sku: listing.sku,
      oldCategory1Id: oldBySlot[1],
      oldCategory2Id: oldBySlot[2],
      newCategory1Id: changed1,
      newCategory2Id: changed2,
      mode,
      aiConfidence,
      aiReasoning,
    })
    .returning();

  const label = (id: string | null) => (id ? pathById.get(id) ?? id : null);
  console.log(
    `[tes recat-queue] queued ${itemId} "${listing.title}" mode=${mode} ` +
      `slot1: ${label(oldBySlot[1])} -> ${label(finalBySlot[1])} | ` +
      `slot2: ${label(oldBySlot[2])} -> ${label(finalBySlot[2])}`
  );

  return NextResponse.json({
    ok: true,
    entry: {
      id: entry.id,
      slot1: { old: label(oldBySlot[1]), new: label(finalBySlot[1]), changed: !!changed1 },
      slot2: { old: label(oldBySlot[2]), new: label(finalBySlot[2]), changed: !!changed2 },
      mode,
      aiConfidence,
      aiReasoning,
    },
  });
}
