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
  let stage = "init";

  try {
    // Step 1: simplest possible Trading API call. GeteBayOfficialTime takes
    // no parameters and authenticates with the same headers/token as every
    // other call. If this fails, the issue is auth/headers, not XML format.
    stage = "GeteBayOfficialTime";
    const time = await tradingCall("GeteBayOfficialTime");
    const officialTime =
      (time as { Timestamp?: unknown }).Timestamp != null
        ? String((time as { Timestamp?: unknown }).Timestamp)
        : null;

    // Step 2: the actual GetStore call. If step 1 worked but this fails,
    // the issue is something specific to this call's request body.
    stage = "GetStore";
    const raw = await tradingCall("GetStore", {
      CategoryStructureOnly: "true",
    });
    const storeName =
      ((raw as { Store?: { Name?: unknown } }).Store?.Name as
        | string
        | undefined) ?? null;

    // Step 3: parse the category tree out of the GetStore response.
    stage = "fetchStoreCategoryTree";
    const tree = await fetchStoreCategoryTree();
    const flat = flattenCategoryTree(tree);
    const sampleCategoryNames = flat
      .filter((c) => c.depth === 0)
      .slice(0, 6)
      .map((c) => c.name);

    return NextResponse.json({
      ok: true,
      storeName,
      officialTime,
      topLevelCategoryCount: tree.length,
      totalCategoryCount: flat.length,
      sampleCategoryNames,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        stage,
        error: (err as Error).message,
        durationMs: Date.now() - start,
      },
      { status: 500 }
    );
  }
}
