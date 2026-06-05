// POST /api/admin/items/capture
//
// Authenticated by Bearer <api_key>. The Chrome extension scrapes the
// Nifty inventory React state and sends batches of items here. We upsert
// by Nifty id, derive haul slug from privateNotes (if it matches a known
// post), and update status/soldAt/soldOnMarketplace based on the per-
// platform metadata.
//
// Body shape (the extension constructs this):
//   {
//     filterMode: "listed" | "sold",
//     items: [
//       {
//         niftyId: string,
//         title: string,
//         status: "LISTED" | "SOLD" | string,
//         privateNotes?: string,
//         soldAt?: string,         // ISO date
//         skus?: string[],
//         heroImage?: string,
//         price?: string | number,
//         marketplaces: {
//           [name]: { externalId, status, pictureUrl?, price? }
//         }
//       }
//     ]
//   }

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { items as itemsTable } from "@/db/schema";
import { bearerFromRequest, verifyApiKey } from "@/lib/api-keys";
import {
  buildMarketplaceUrls,
  detectSoldMarketplace,
  type MarketplaceMetadata,
} from "@/lib/marketplace-urls";
import { privateNotesToHaulSlug } from "@/lib/posts-slugs";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

type IncomingItem = {
  niftyId: string;
  title: string;
  status?: string;
  privateNotes?: string | null;
  soldAt?: string | null;
  skus?: string[];
  heroImage?: string | null;
  price?: string | number | null;
  marketplaces?: Record<string, MarketplaceMetadata>;
};

type CaptureRequest = {
  filterMode?: "listed" | "sold";
  items: IncomingItem[];
};

function normalizeTitle(t: string): string {
  return t.toLowerCase().trim().replace(/\s+/g, " ");
}

function parsePrice(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

export async function POST(req: NextRequest) {
  const token = bearerFromRequest(req);
  if (!token) {
    return NextResponse.json(
      { error: "Missing Authorization: Bearer <key> header" },
      { status: 401 }
    );
  }
  const key = await verifyApiKey(token);
  if (!key) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  let payload: CaptureRequest;
  try {
    payload = (await req.json()) as CaptureRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(payload.items)) {
    return NextResponse.json({ error: "items must be an array" }, { status: 400 });
  }

  let upserted = 0;
  let linkedToHaul = 0;
  let markedSold = 0;
  const errors: { niftyId?: string; error: string }[] = [];

  for (const incoming of payload.items) {
    try {
      if (!incoming.niftyId || !incoming.title) {
        errors.push({
          niftyId: incoming.niftyId,
          error: "niftyId and title are required",
        });
        continue;
      }
      const isSold =
        (incoming.status ?? "").toString().toUpperCase() === "SOLD";
      const marketplaces = incoming.marketplaces ?? {};
      const marketplaceUrls = buildMarketplaceUrls(marketplaces);
      const soldMarketplace = isSold ? detectSoldMarketplace(marketplaces) : null;
      const haulSlug = privateNotesToHaulSlug(incoming.privateNotes);

      const values = {
        niftyId: incoming.niftyId,
        title: incoming.title,
        titleNormalized: normalizeTitle(incoming.title),
        sku: incoming.skus?.[0] ?? null,
        status: isSold ? ("sold" as const) : ("active" as const),
        heroImage: incoming.heroImage ?? null,
        price: parsePrice(incoming.price),
        marketplaceUrls,
        haulPostSlug: haulSlug,
        soldAt:
          isSold && incoming.soldAt
            ? new Date(incoming.soldAt)
            : isSold
            ? new Date()
            : null,
        soldOnMarketplace: soldMarketplace,
        capturedAt: new Date(),
        updatedAt: new Date(),
      };

      await db
        .insert(itemsTable)
        .values(values)
        .onConflictDoUpdate({
          target: itemsTable.niftyId,
          set: {
            title: values.title,
            titleNormalized: values.titleNormalized,
            sku: values.sku,
            status: values.status,
            heroImage: values.heroImage,
            price: values.price,
            marketplaceUrls: values.marketplaceUrls,
            haulPostSlug: values.haulPostSlug,
            // Only overwrite soldAt / soldOnMarketplace when the
            // incoming row reports SOLD. Don't blank them out on an
            // active-view sync of an item that was previously sold.
            soldAt: isSold ? values.soldAt : sql`${itemsTable.soldAt}`,
            soldOnMarketplace: isSold
              ? values.soldOnMarketplace
              : sql`${itemsTable.soldOnMarketplace}`,
            updatedAt: new Date(),
          },
        });

      upserted += 1;
      if (haulSlug) linkedToHaul += 1;
      if (isSold) markedSold += 1;
    } catch (err) {
      errors.push({
        niftyId: incoming.niftyId,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    upserted,
    linkedToHaul,
    markedSold,
    errors,
    keyName: key.name,
    filterMode: payload.filterMode ?? null,
  });
}
