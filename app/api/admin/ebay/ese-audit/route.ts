// GET /api/admin/ebay/ese-audit — Phase ESE-1 read-only audit.
//
// Walks the ebay_listings mirror and triages every listing that ships on
// an eBay Standard Envelope policy (lib/enhance/ese.ts):
//   recategorize — card-type item in an ineligible category (keep envelope,
//                  fix the eBay category)
//   reship       — everything else in an ineligible category (→ Calculated
//                  Shipping, 4oz)
//   ok           — envelope + eligible category
//
// Query params:
//   format=csv        CSV download (default JSON summary + rows)
//   action=<a>        only rows with that action (recategorize|reship|ok)
//   limit=<n>         cap JSON rows (default 5000; CSV is never capped)
//
// Needs the shipping-profile columns filled by the full listing sweep
// (lib/ebay/listing-sync.ts) — until a sweep has run since the ESE-1
// migration, `coverage.withProfile` is 0 and the audit is meaningless.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, ebayListings } from "@/db";
import { asc, sql } from "drizzle-orm";
import { triageListing, eseList, type EseAction } from "@/lib/enhance/ese";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIONS: EseAction[] = ["recategorize", "reship", "ok", "n/a"];

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const format = sp.get("format") === "csv" ? "csv" : "json";
  const actionFilter = sp.get("action");
  const onlyAction =
    actionFilter && (ACTIONS as string[]).includes(actionFilter)
      ? (actionFilter as EseAction)
      : null;
  const limitRaw = Number(sp.get("limit") ?? "");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 5000;

  const rows = await db
    .select({
      itemId: ebayListings.itemId,
      sku: ebayListings.sku,
      title: ebayListings.title,
      price: ebayListings.price,
      quantity: ebayListings.quantity,
      siteCategoryId: ebayListings.siteCategoryId,
      siteCategoryName: ebayListings.siteCategoryName,
      shippingProfileId: ebayListings.shippingProfileId,
      shippingProfileName: ebayListings.shippingProfileName,
      shippingServices: ebayListings.shippingServices,
      lastSyncedAt: ebayListings.lastSyncedAt,
    })
    .from(ebayListings)
    .where(sql`${ebayListings.listingType} IS DISTINCT FROM 'Chinese'`)
    .orderBy(asc(ebayListings.sku), asc(ebayListings.itemId));

  const list = eseList();
  let withProfile = 0;
  const counts: Record<EseAction, number> = { recategorize: 0, reship: 0, ok: 0, "n/a": 0 };
  const byGroup: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byProfile: Record<string, number> = {};

  type Out = {
    itemId: string;
    sku: string;
    title: string;
    price: string;
    quantity: number | null;
    category: string;
    categoryId: string;
    profile: string;
    profileId: string;
    services: string;
    group: string;
    action: EseAction;
    reason: string;
  };
  const out: Out[] = [];

  for (const r of rows) {
    if (r.shippingProfileName || r.shippingProfileId) withProfile++;
    byProfile[r.shippingProfileName ?? "(none)"] =
      (byProfile[r.shippingProfileName ?? "(none)"] ?? 0) + 1;
    const services = Array.isArray(r.shippingServices)
      ? (r.shippingServices as unknown[]).map(String)
      : null;
    const t = triageListing(
      {
        title: r.title,
        siteCategoryName: r.siteCategoryName,
        shippingProfileName: r.shippingProfileName,
        shippingServices: services,
        price: r.price,
      },
      list
    );
    counts[t.action]++;
    if (t.action === "n/a") continue;
    if (t.action !== "ok") {
      byGroup[t.group || "(none)"] = (byGroup[t.group || "(none)"] ?? 0) + 1;
      const cat = r.siteCategoryName ?? "(none)";
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }
    if (onlyAction && t.action !== onlyAction) continue;
    if (!onlyAction && t.action === "ok" && format === "json") continue;
    out.push({
      itemId: r.itemId,
      sku: r.sku ?? "",
      title: r.title,
      price: r.price ?? "",
      quantity: r.quantity,
      category: r.siteCategoryName ?? "",
      categoryId: r.siteCategoryId ?? "",
      profile: r.shippingProfileName ?? "",
      profileId: r.shippingProfileId ?? "",
      services: services?.join("|") ?? "",
      group: t.group,
      action: t.action,
      reason: t.reason,
    });
  }

  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([category, n]) => ({ category, n }));

  if (format === "csv") {
    const header =
      "item_id,sku,title,price,quantity,ebay_category,ebay_category_id,shipping_profile,shipping_profile_id,services,card_group,action,reason";
    const lines = [header];
    for (const o of out) {
      lines.push(
        [
          o.itemId,
          csvEscape(o.sku),
          csvEscape(o.title),
          o.price,
          o.quantity == null ? "" : String(o.quantity),
          csvEscape(o.category),
          o.categoryId,
          csvEscape(o.profile),
          o.profileId,
          csvEscape(o.services),
          o.group,
          o.action,
          csvEscape(o.reason),
        ].join(",")
      );
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(lines.join("\n") + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ese-audit-${onlyAction ?? "all"}-${stamp}.csv"`,
      },
    });
  }

  return NextResponse.json({
    coverage: {
      listings: rows.length,
      withProfile,
      note:
        withProfile === 0
          ? "No listing has a shipping profile yet — run the full listing sweep after the ESE-1 migration."
          : undefined,
    },
    eligibleListSize: list.length,
    counts,
    offenders: counts.recategorize + counts.reship,
    byGroup,
    byProfile,
    topCategories,
    rows: out.slice(0, limit),
    capped: out.length > limit,
  });
}
