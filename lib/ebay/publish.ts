// Phase 3e — publish an approved draft straight to eBay (pilot).
//
// Two steps, both pressed by Todd on the draft page:
//   checkDraftOnEbay()   eBay's dry run (VerifyAddFixedPriceItem): nothing is
//                        created; returns eBay's errors, warnings and fees.
//   publishDraftToEbay() only after a clean check of the SAME listing text:
//                        copies the photos to eBay's picture hosting, then
//                        AddFixedPriceItem. The draft's id is sent as eBay's
//                        UUID, so a second press can't make a second listing.
// Settings that aren't on the draft (payment and return policies, item
// location, handling time, Best Offer, package size) are copied from Todd's
// newest eBay listing that uses the same kind of shipping policy — FIA
// invents none of them. Off unless app_settings "ebay_publish".enabled.
// Rollback notes: claude/phase-3e-direct-ebay-publish.md (project doc).

import { createHash } from "node:crypto";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { tradingCall } from "@/lib/ebay/client";
import { applicationToken } from "@/lib/ebay/taxonomy";
import { upsertListingFromItem } from "@/lib/ebay/listing-sync";
import { queueItemForDraft } from "@/lib/listings/nifty";
import { linkDraftToEbay } from "@/lib/listings/published";
import {
  buildItem,
  ebayMessages,
  feeTotal,
  pickConditionId,
  policyMatches,
  shipKind,
  type EbayMessage,
  type PublishDraft,
  type Reference,
  type ShipKind,
} from "./publish-core";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

const SETTINGS_KEY = "ebay_publish";
/** A check is good for publishing for this long (and only for the same text). */
const CHECK_TTL_MS = 24 * 3600_000;

export async function ebayPublishEnabled(): Promise<boolean> {
  const [r] = await rows(sql`SELECT value FROM app_settings WHERE key = ${SETTINGS_KEY}`);
  return (r?.value as { enabled?: boolean } | undefined)?.enabled === true;
}

export async function setEbayPublishEnabled(on: boolean): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES (${SETTINGS_KEY}, ${JSON.stringify({ enabled: on })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
}

// ─── reference listing ──────────────────────────────────────────────────────

const str = (v: unknown) => (v == null || v === "" ? null : String(v));

async function referenceListing(kind: ShipKind): Promise<Reference> {
  const recent = await rows(sql`
    SELECT item_id, shipping_profile_id, shipping_profile_name, pkg_length_in, pkg_width_in, pkg_depth_in, pkg_irregular
    FROM ebay_listings
    WHERE quantity > 0 AND shipping_profile_id IS NOT NULL AND start_time IS NOT NULL
    ORDER BY start_time DESC LIMIT 400`);
  const ref = recent.find((r) => policyMatches(kind, r.shipping_profile_name as string | null));
  if (!ref) throw new Error(`No live eBay listing uses a ${kind} shipping policy to copy settings from`);
  const res = await tradingCall("GetItem", { ItemID: String(ref.item_id), DetailLevel: "ReturnAll", IncludeItemSpecifics: false });
  const it = ((res as { Item?: Row }).Item ?? {}) as Row;
  const sp = (it.SellerProfiles ?? {}) as Record<string, Row | undefined>;
  const spd = (it.ShippingPackageDetails ?? {}) as Row;
  const inch = (v: unknown) => (v == null ? null : { "@_unit": "inches", "#text": String(Math.ceil(Number(v))) });
  const pkg: Row = { MeasurementUnit: "English" };
  if (ref.pkg_length_in) pkg.PackageLength = inch(ref.pkg_length_in);
  if (ref.pkg_width_in) pkg.PackageWidth = inch(ref.pkg_width_in);
  if (ref.pkg_depth_in) pkg.PackageDepth = inch(ref.pkg_depth_in);
  if (ref.pkg_irregular != null) pkg.ShippingIrregular = ref.pkg_irregular === true;
  if (spd.ShippingPackage) pkg.ShippingPackage = String(spd.ShippingPackage);
  return {
    itemId: String(ref.item_id),
    shippingProfileId: str(sp.SellerShippingProfile?.ShippingProfileID) ?? String(ref.shipping_profile_id),
    shippingProfileName: str(ref.shipping_profile_name)?.replace(/&amp;/g, "&") ?? null,
    returnProfileId: str(sp.SellerReturnProfile?.ReturnProfileID),
    paymentProfileId: str(sp.SellerPaymentProfile?.PaymentProfileID),
    location: str(it.Location),
    postalCode: str(it.PostalCode),
    country: str(it.Country) ?? "US",
    currency: str(it.Currency) ?? "USD",
    dispatchTimeMax: str(it.DispatchTimeMax),
    bestOffer: String(((it.BestOfferDetails ?? {}) as Row).BestOfferEnabled) === "true",
    pkg,
    categoryId: str(((it.PrimaryCategory ?? {}) as Row).CategoryID),
    conditionId: str(it.ConditionID),
  };
}

/** Condition ids the category accepts (eBay Metadata API); null if unknown. */
async function allowedConditions(categoryId: string): Promise<string[] | null> {
  try {
    const token = await applicationToken();
    const res = await fetch(
      `https://api.ebay.com/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=${encodeURIComponent(`categoryIds:{${categoryId}}`)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { itemConditionPolicies?: Array<{ itemConditions?: Array<{ conditionId?: string }> }> };
    const ids = (j.itemConditionPolicies?.[0]?.itemConditions ?? []).map((c) => String(c.conditionId ?? "")).filter(Boolean);
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}

// ─── building ───────────────────────────────────────────────────────────────

type Built = { draft: PublishDraft; ref: Reference; conditionId: string; hash: string; status: string; meta: Record<string, unknown> };

async function build(draftId: string): Promise<Built> {
  const q = await queueItemForDraft(draftId);
  if (!q) throw new Error("Draft not found");
  if (q.status !== "approved") throw new Error(`Only approved drafts can go to eBay (this one is ${q.status.replace("_", " ")})`);
  if (!q.ebayCategoryId) throw new Error("Pick an eBay category first");
  const kind = shipKind(q.shippingProfile);
  const ref = await referenceListing(kind);
  const allowed = await allowedConditions(q.ebayCategoryId);
  const conditionId = pickConditionId(q.condition, allowed, ref.categoryId === q.ebayCategoryId ? ref.conditionId : null);
  const draft: PublishDraft = {
    draftId,
    title: q.title,
    description: q.description,
    condition: q.condition,
    conditionNote: q.conditionNote,
    price: Number(q.venuePrices?.ebay ?? q.price),
    quantity: q.quantity,
    sku: q.sku,
    categoryId: q.ebayCategoryId,
    itemSpecifics: q.itemSpecifics,
    storeCategoryIds: q.storeCategoryIds,
    weightOz: q.weightOz,
    pictureUrls: q.photos,
  };
  const hash = createHash("sha256").update(JSON.stringify(buildItem(draft, ref, conditionId))).digest("hex").slice(0, 16);
  return { draft, ref, conditionId, hash, status: q.status, meta: q.aiMeta };
}

function messagesFromError(err: unknown): EbayMessage[] {
  const text = (err as Error).message.replace(/^eBay \w+ Failure: /, "");
  return text.split(/;\s*(?=\[\d+\])/).map((m) => {
    const code = /^\[(\d+)\]/.exec(m)?.[1] ?? null;
    return { severity: "Error" as const, code, message: m.replace(/^\[\d+\]\s*/, "") };
  });
}

async function saveMeta(draftId: string, key: string, value: unknown): Promise<void> {
  await db.execute(sql`
    UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object(${key}::text, ${JSON.stringify(value)}::jsonb)
    WHERE id = ${draftId}::uuid`);
}

export type EbayCheck = {
  at: string;
  ok: boolean;
  hash: string;
  messages: EbayMessage[];
  fees: { total: number; lines: Array<{ name: string; amount: number }> } | null;
  summary: {
    price: number;
    categoryId: string;
    conditionId: string;
    storeCategoryIds: string[];
    photos: number;
    weightOz: number | null;
    shippingPolicy: string | null;
    copiedFrom: string;
    returnPolicyId: string | null;
    paymentPolicyId: string | null;
    location: string | null;
    handlingDays: string | null;
    bestOffer: boolean;
  };
};

/** eBay's dry run. Creates nothing. */
export async function checkDraftOnEbay(draftId: string, who: string): Promise<EbayCheck> {
  if (!(await ebayPublishEnabled())) throw new Error("Publishing to eBay is switched off (Listings → settings)");
  const b = await build(draftId);
  let messages: EbayMessage[] = [];
  let fees: EbayCheck["fees"] = null;
  let ok = false;
  try {
    const res = (await tradingCall("VerifyAddFixedPriceItem", { Item: buildItem(b.draft, b.ref, b.conditionId) })) as Row;
    messages = ebayMessages(res.Errors);
    fees = feeTotal(res.Fees);
    ok = true;
  } catch (err) {
    messages = messagesFromError(err);
  }
  const check: EbayCheck = {
    at: new Date().toISOString(),
    ok,
    hash: b.hash,
    messages,
    fees,
    summary: {
      price: b.draft.price,
      categoryId: b.draft.categoryId,
      conditionId: b.conditionId,
      storeCategoryIds: b.draft.storeCategoryIds,
      photos: b.draft.pictureUrls.length,
      weightOz: b.draft.weightOz,
      shippingPolicy: b.ref.shippingProfileName,
      copiedFrom: b.ref.itemId,
      returnPolicyId: b.ref.returnProfileId,
      paymentPolicyId: b.ref.paymentProfileId,
      location: b.ref.location,
      handlingDays: b.ref.dispatchTimeMax,
      bestOffer: b.ref.bestOffer,
    },
  };
  await saveMeta(draftId, "ebayCheck", { ...check, by: who });
  return check;
}

/** Publish for real — only after a clean check of the same listing. */
export async function publishDraftToEbay(draftId: string, who: string): Promise<{ itemId: string; fees: EbayCheck["fees"]; messages: EbayMessage[] }> {
  if (!(await ebayPublishEnabled())) throw new Error("Publishing to eBay is switched off (Listings → settings)");
  const b = await build(draftId);
  const last = b.meta.ebayCheck as EbayCheck | undefined;
  if (!last?.ok) throw new Error("Run “Check with eBay” first, and fix anything it reports");
  if (last.hash !== b.hash) throw new Error("The draft (or a copied setting) changed since the last check; check with eBay again");
  if (Date.now() - Date.parse(last.at) > CHECK_TTL_MS) throw new Error("The last check is over a day old; check with eBay again");

  // One press at a time: claim the draft (a stale claim expires after 10 minutes).
  const [claim] = await rows(sql`
    UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('ebayPublishStartedAt', now()::text)
    WHERE id = ${draftId}::uuid AND status = 'approved'
      AND (ai_meta->>'ebayPublishStartedAt' IS NULL OR (ai_meta->>'ebayPublishStartedAt')::timestamptz < now() - interval '10 minutes')
    RETURNING id`);
  if (!claim) throw new Error("Already publishing (or no longer approved) — refresh the page");

  try {
    // Photos → eBay picture hosting (eBay copies them from our links).
    const hosted: string[] = [];
    for (const url of b.draft.pictureUrls.slice(0, 24)) {
      const up = (await tradingCall("UploadSiteHostedPictures", { ExternalPictureURL: url, PictureSet: "Supersize" })) as Row;
      const full = str(((up.SiteHostedPictureDetails ?? {}) as Row).FullURL);
      if (!full) throw new Error(`eBay didn't take photo ${hosted.length + 1}`);
      hosted.push(full.replace(/&amp;/g, "&"));
    }
    const item = buildItem({ ...b.draft, pictureUrls: hosted }, b.ref, b.conditionId);
    let res: Row;
    try {
      res = (await tradingCall("AddFixedPriceItem", { Item: item })) as Row;
    } catch (err) {
      const msg = (err as Error).message;
      if (/UUID/i.test(msg)) throw new Error(`eBay already has a listing made from this draft (${msg}). Look for it in Seller Hub before trying again.`);
      throw err;
    }
    const itemId = str(res.ItemID);
    if (!itemId) throw new Error("eBay didn't return an item number");
    const fees = feeTotal(res.Fees);
    const messages = ebayMessages(res.Errors);
    await saveMeta(draftId, "ebayPublish", { at: new Date().toISOString(), itemId, fees, messages, by: who, copiedFrom: b.ref.itemId });

    // Mirror + link right away (the 15-minute sync would get there too).
    try {
      const got = (await tradingCall("GetItem", { ItemID: itemId, DetailLevel: "ReturnAll", IncludeItemSpecifics: false })) as Row;
      if (got.Item) await upsertListingFromItem(got.Item);
      const linked = await linkDraftToEbay(draftId, itemId, "fia_publish");
      if (!linked.ok) throw new Error(linked.error);
    } catch (err) {
      // Listed on eBay regardless: never leave the draft "approved" (it could
      // be sent to Nifty and listed twice). The registry link catches up.
      console.warn(`[ebay-publish] listed ${itemId}; linking later:`, err);
      await db.execute(sql`
        UPDATE listing_drafts SET status = 'published', updated_at = now(),
          ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('ebayItemId', ${itemId}::text, 'publishedAt', now(), 'publishedHow', 'fia_publish')
        WHERE id = ${draftId}::uuid AND status = 'approved'`);
    }
    return { itemId, fees, messages };
  } finally {
    await db.execute(sql`UPDATE listing_drafts SET ai_meta = ai_meta - 'ebayPublishStartedAt' WHERE id = ${draftId}::uuid`);
  }
}
