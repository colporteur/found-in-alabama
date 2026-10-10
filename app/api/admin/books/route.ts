// POST /api/admin/books — books (Phase 4e). FIA tables only.
// { action: "settings", settings }
// { action: "haul", id?, name, acquiredOn?, kind?, totalCost?, notes? }
// { action: "item_cost", ids: registryItemIds[], acquisitionId?: id|null, unitCost?: n|null }
// { action: "postage", orderId, cost: n|null }

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveAcquisition, saveBooksSettings, setItemCost, setShippingCost } from "@/lib/books/books";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    switch (b.action) {
      case "settings":
        return NextResponse.json({ ok: true, settings: await saveBooksSettings(b.settings) });
      case "haul":
        return NextResponse.json({
          ok: true,
          id: await saveAcquisition({
            id: (b.id as string) || null,
            name: b.name as string,
            acquiredOn: (b.acquiredOn as string) || null,
            kind: (b.kind as string) || null,
            totalCost: (b.totalCost as string | number | null) ?? null,
            notes: (b.notes as string) || null,
          }),
        });
      case "item_cost": {
        const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
        const edit: { acquisitionId?: string | null; unitCost?: number | string | null } = {};
        if ("acquisitionId" in b) edit.acquisitionId = (b.acquisitionId as string) || null;
        if ("unitCost" in b) edit.unitCost = (b.unitCost as string | number | null) ?? null;
        return NextResponse.json({ ok: true, updated: await setItemCost(ids, edit) });
      }
      case "postage":
        return NextResponse.json({ ok: true, updated: await setShippingCost(String(b.orderId ?? ""), (b.cost as string | number | null) ?? null) });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
