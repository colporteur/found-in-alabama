// SHIP-2: move a live listing onto another eBay shipping policy (the
// "shipping_policy" Expert Enhance op, with before-snapshot rollback).
// Used to put Standard Envelope–eligible listings on Todd's envelope policy.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { tradingCall } from "@/lib/ebay/client";
import { upsertListingFromItem } from "@/lib/ebay/listing-sync";

type Row = Record<string, unknown>;

/** Todd's eBay Standard Envelope policy ("Very Small and Paper under 3.5 oz
 *  (eBay Standard Envelope) 1.25"). */
export const ENVELOPE_POLICY_ID = "254457129020";

export type LiveShipping = {
  status: string | null;
  profileId: string | null;
  pkg: Row | null;
  price: number | null;
};

export async function liveShipping(itemId: string): Promise<LiveShipping | null> {
  const res = (await tradingCall("GetItem", { ItemID: itemId, DetailLevel: "ReturnAll", IncludeItemSpecifics: false })) as Row;
  const it = res.Item as Row | undefined;
  if (!it) return null;
  const sp = (it.SellerProfiles ?? {}) as Record<string, Row | undefined>;
  const ss = (it.SellingStatus ?? {}) as Row;
  const cp = ss.CurrentPrice as Row | string | undefined;
  const price = Number(typeof cp === "object" && cp ? cp["#text"] : cp);
  return {
    status: ss.ListingStatus != null ? String(ss.ListingStatus) : null,
    profileId: sp.SellerShippingProfile?.ShippingProfileID != null ? String(sp.SellerShippingProfile.ShippingProfileID) : null,
    pkg: (it.ShippingPackageDetails as Row | undefined) ?? null,
    price: Number.isFinite(price) ? price : null,
  };
}

let envelopePkgCache: { at: number; pkg: Row } | null = null;

/** Package details for an envelope listing: copied from Todd's newest live
 *  listing on the envelope policy, weight set to 1 oz. */
export async function envelopePackage(): Promise<Row> {
  if (envelopePkgCache && Date.now() - envelopePkgCache.at < 10 * 60_000) return envelopePkgCache.pkg;
  const res = (await db.execute(sql`
    SELECT item_id FROM ebay_listings WHERE quantity > 0 AND shipping_profile_id = ${ENVELOPE_POLICY_ID}
    ORDER BY start_time DESC NULLS LAST LIMIT 1`)) as { rows?: Row[] };
  const ref = res.rows?.[0]?.item_id;
  const live = ref ? await liveShipping(String(ref)) : null;
  const pkg: Row = { ...(live?.pkg ?? { MeasurementUnit: "English" }) };
  pkg.WeightMajor = { "@_unit": "lbs", "#text": "0" };
  pkg.WeightMinor = { "@_unit": "oz", "#text": "1" };
  envelopePkgCache = { at: Date.now(), pkg };
  return pkg;
}

/** Revise the listing's shipping policy (and package details, if given),
 *  then refresh FIA's mirror row from eBay. */
export async function reviseShippingPolicy(itemId: string, profileId: string, pkg: Row | null): Promise<void> {
  await tradingCall("ReviseFixedPriceItem", {
    Item: {
      ItemID: itemId,
      SellerProfiles: { SellerShippingProfile: { ShippingProfileID: profileId } },
      ...(pkg ? { ShippingPackageDetails: pkg } : {}),
    },
  });
  try {
    const got = (await tradingCall("GetItem", { ItemID: itemId, DetailLevel: "ReturnAll", IncludeItemSpecifics: false })) as Row;
    if (got.Item) await upsertListingFromItem(got.Item);
  } catch {
    /* the 15-minute sync catches up */
  }
}
