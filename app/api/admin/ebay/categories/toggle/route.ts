// PATCH /api/admin/ebay/categories/toggle
// Body: { categoryId: string, field: "isAlabamaRelated" | "isOtherBucket" | "isEphemeralState", value: boolean }
//
// Flips a single boolean flag on a stored eBay category row. Used by the
// per-row toggles on /admin/ebay/categories. For "isOtherBucket" we enforce
// at most one category at a time — flipping it on for X clears it on every
// other row.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { ebayStoreCategories } from "@/db/schema";
import { eq, ne } from "drizzle-orm";

export const runtime = "nodejs";

type ToggleField =
  | "isAlabamaRelated"
  | "isOtherBucket"
  | "isEphemeralState"
  | "shipClass";

interface ToggleBody {
  categoryId?: string;
  field?: ToggleField;
  /** boolean for the flag fields; "paper" | "media" | "bulky" for shipClass */
  value?: boolean | string;
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: ToggleBody;
  try {
    body = (await req.json()) as ToggleBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { categoryId, field, value } = body;

  if (!categoryId || typeof categoryId !== "string") {
    return NextResponse.json({ ok: false, error: "categoryId required" }, { status: 400 });
  }
  if (
    field !== "isAlabamaRelated" &&
    field !== "isOtherBucket" &&
    field !== "isEphemeralState" &&
    field !== "shipClass"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "field must be isAlabamaRelated, isOtherBucket, isEphemeralState, or shipClass",
      },
      { status: 400 }
    );
  }
  if (field === "shipClass") {
    if (value !== "paper" && value !== "media" && value !== "bulky") {
      return NextResponse.json(
        { ok: false, error: "shipClass must be paper, media, or bulky" },
        { status: 400 }
      );
    }
  } else if (typeof value !== "boolean") {
    return NextResponse.json({ ok: false, error: "value must be boolean" }, { status: 400 });
  }

  try {
    if (field === "isOtherBucket" && value === true) {
      // Single-winner enforcement: only one row can be the "Other" bucket.
      // Clear it on every other row first, then set it on this one.
      await db
        .update(ebayStoreCategories)
        .set({ isOtherBucket: false })
        .where(ne(ebayStoreCategories.categoryId, categoryId));
    }

    const setClause =
      field === "shipClass"
        ? { shipClass: value as string }
        : field === "isAlabamaRelated"
        ? { isAlabamaRelated: value as boolean }
        : field === "isEphemeralState"
        ? { isEphemeralState: value as boolean }
        : { isOtherBucket: value as boolean };

    await db
      .update(ebayStoreCategories)
      .set(setClause)
      .where(eq(ebayStoreCategories.categoryId, categoryId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
