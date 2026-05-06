// Verify the eBay Trading API responds with the seller's Store details.
// Read-only — no DB writes, no listing modifications. Used by the "Test
// connection" button on /admin/ebay/connect.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { tradingCall } from "@/lib/ebay/client";
import {
  fetchStoreCategoryTree,
  flattenCategoryTree,
} from "@/lib/ebay/calls";

// Node runtime — fast-xml-parser and the eBay XML payload are happier here
// than at the edge, and Trading API responses can take 5-10s on big stores.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const start = Date.now();
  try {
    // Use GetStore directly (small response) for the store name and the
    // category tree at once. fetchStoreCategoryTree pulls the categories;
    // a parallel raw call gives us the store name.
    const [tree, raw] = await Promise.all([
      fetchStoreCategoryTree(),
      tradingCall("GetStore"),
    ]);

    const flat = flattenCategoryTree(tree);
    const sampleCategoryNames = flat
      .filter((c) => c.depth === 0)
      .slice(0, 6)
      .map((c) => c.name);

    const storeName =
      ((raw as { Store?: { Name?: unknown } }).Store?.Name as
        | string
        | undefined) ?? null;

    return NextResponse.json({
      ok: true,
      storeName,
      topLevelCategoryCount: tree.length,
      totalCategoryCount: flat.length,
      sampleCategoryNames,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        durationMs: Date.now() - start,
      },
      { status: 500 }
    );
  }
}
