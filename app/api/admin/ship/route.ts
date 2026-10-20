// POST /api/admin/ship — the to-ship queue (Phase 4a).
// Body: { action: "pick_printed" | "packed" | "shipped" | "reopen" | "cancel", ids: string[] }
//       { action: "settings", startDate: "YYYY-MM-DD" }   start the queue
//       { action: "shipped_before", date: "YYYY-MM-DD" }  first-day cleanup
//       { action: "sync" }
// Changes only FIA's own ship_orders; nothing is sent to a marketplace.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { parseSearchInput, searchPitchText } from "@/lib/shop/invoice-search";
import { searchCounter } from "@/lib/shop/invoice-search-server";
import {
  SHIP_ACTIONS,
  applyShipAction,
  markShippedBefore,
  saveFulfillmentSettings,
  setPitchShelf,
  setPitchSearch,
  syncShipQueue,
  type ShipAction,
} from "@/lib/fulfillment/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const who = session.user.email ?? "admin";

  let body: { action?: string; ids?: unknown; startDate?: string; date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (body.action === "settings") {
      const s = await saveFulfillmentSettings({ startDate: body.startDate });
      const sync = await syncShipQueue();
      return NextResponse.json({ ok: true, settings: s, sync });
    }
    if (body.action === "pitch_search") {
      const b = body as unknown as { id?: string; search?: unknown };
      const n = await setPitchSearch(String(b.id ?? ""), b.search, who);
      return NextResponse.json({ ok: true, updated: n });
    }
    if (body.action === "search_count") {
      // Live preview for "Custom search…": what it is, how many, the line.
      const b = body as unknown as { input?: string; site?: string; label?: string };
      const ps = parseSearchInput(String(b.input ?? ""), b.site === "tes" ? "tes" : "fia");
      if (!ps) return NextResponse.json({ ok: true, search: null, count: 0 });
      if (b.label?.trim()) ps.label = b.label.trim().slice(0, 60);
      const count = await searchCounter()(ps);
      return NextResponse.json({ ok: true, search: ps, count, text: searchPitchText(ps, count) });
    }
    if (body.action === "pitch_shelf") {
      const b = body as unknown as { id?: string; choice?: string | null };
      const n = await setPitchShelf(String(b.id ?? ""), b.choice ? String(b.choice) : null, who);
      return NextResponse.json({ ok: true, updated: n });
    }
    if (body.action === "sync") return NextResponse.json({ ok: true, sync: await syncShipQueue() });
    if (body.action === "shipped_before") {
      const n = await markShippedBefore(String(body.date ?? ""), who);
      return NextResponse.json({ ok: true, updated: n });
    }
    if (SHIP_ACTIONS.includes(body.action as ShipAction)) {
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      if (!ids.length) return NextResponse.json({ error: "ids is required" }, { status: 400 });
      const n = await applyShipAction(ids, body.action as ShipAction, who);
      return NextResponse.json({ ok: true, updated: n });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ error: `unknown action` }, { status: 400 });
}
