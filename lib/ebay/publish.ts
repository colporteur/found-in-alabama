// Phase 3e — publish an approved draft straight to eBay (pilot).
//
// Two steps, both pressed by Todd on the draft page:
//   checkDraftOnEbay()   eBay's dry run (VerifyAddFixedPriceItem): nothing is
//                        created; returns eBay's errors, warnings and fees.
//   publishDraftToEbay() only after a clean check of the SAME listing text:
//                        hands eBay the photos (lib/ebay/media.ts), then
//                        AddFixedPriceItem. The draft's id is sent as eBay's
//                        UUID, so a second press can't make a second listing.
// Settings that aren't on the draft (payment and return policies, item
// location, handling time, Best Offer, package size) are copied from Todd's
// newest eBay listing that uses the same kind of shipping policy — FIA
// invents none of them. Off unless app_settings "ebay_publish".enabled —
// except single trading cards, which take this road by default (cardsDirect,
// publish-settings.ts) because Nifty can't send the card condition eBay
// requires for them. Those can also be published in a batch from the
// Listings page (checkAndPublish: eBay's check, then publish if it's clean).
// Rollback notes: claude/phase-3e-direct-ebay-publish.md (project doc).

import { createHash } from "node:crypto";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { tradingCall } from "@/lib/ebay/client";
import { hostPhotosForListing } from "@/lib/ebay/media";
import { applicationToken } from "@/lib/ebay/taxonomy";
import { upsertListingFromItem } from "@/lib/ebay/listing-sync";
import { queueItemForDraft } from "@/lib/listings/nifty";
import { linkDraftToEbay } from "@/lib/listings/published";
import { draftRoute, ebaySettings, saveEbaySettings, type PublishRoute } from "./publish-settings";
import {
  buildItem,
  CARD_SINGLE_CATEGORIES,
  cardShippingPolicy,
  cardConditionFields,
  cardConditionLabel,
  cleanCardCondition,
  guessCardCondition,
  isCardSingle,
  type CardCondition,
  ebayMessages,
  feeTotal,
  pickConditionId,
  policyMatches,
  retrySystemError,
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

/** A check is good for publishing for this long (and only for the same text). */
const CHECK_TTL_MS = 24 * 3600_000;

export async function ebayPublishEnabled(): Promise<boolean> {
  return (await ebaySettings()).enabled;
}

export async function setEbayPublishEnabled(on: boolean): Promise<void> {
  await saveEbaySettings({ enabled: on });
}

// ─── reference listing ──────────────────────────────────────────────────────

const str = (v: unknown) => (v == null || v === "" ? null : String(v));

/** The newest live listing using the given kind of shipping policy — or,
 *  with `policyId`, that exact policy (single cards). */
async function referenceListing(kind: ShipKind, policyId?: string): Promise<Reference> {
  const recent = await rows(sql`
    SELECT item_id, shipping_profile_id, shipping_profile_name, pkg_length_in, pkg_width_in, pkg_depth_in, pkg_irregular
    FROM ebay_listings
    WHERE quantity > 0 AND shipping_profile_id IS NOT NULL AND start_time IS NOT NULL
      ${policyId ? sql`AND shipping_profile_id = ${policyId}` : sql``}
    ORDER BY start_time DESC LIMIT 400`);
  const ref = policyId ? recent[0] : recent.find((r) => policyMatches(kind, r.shipping_profile_name as string | null));
  if (!ref) throw new Error(policyId ? `No live eBay listing uses shipping policy ${policyId} to copy settings from` : `No live eBay listing uses a ${kind} shipping policy to copy settings from`);
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

type Built = {
  draft: PublishDraft;
  ref: Reference;
  conditionId: string;
  descriptors: Array<Record<string, string>> | null;
  card: CardCondition | null;
  hash: string;
  status: string;
  meta: Record<string, unknown>;
};

/** The card condition FIA will send: Todd's choice, else a guess. */
export function draftCardCondition(q: { condition: string; conditionNote: string | null; itemSpecifics: Record<string, string | string[]>; aiMeta: Record<string, unknown> }): CardCondition {
  return cleanCardCondition(q.aiMeta.cardCondition) ?? guessCardCondition(q.condition, q.conditionNote, q.itemSpecifics);
}

async function build(draftId: string): Promise<Built> {
  const q = await queueItemForDraft(draftId);
  if (!q) throw new Error("Draft not found");
  const s = await ebaySettings();
  const isCard = isCardSingle(q.ebayCategoryId);
  if (!s.enabled && !(isCard && draftRoute(s, q.ebayCategoryId, q.aiMeta) === "ebay")) {
    throw new Error("Publishing to eBay is switched off (Listings → settings)");
  }
  // Approved, or (a card that Nifty couldn't list) already sent to Nifty.
  const okStatus = q.status === "approved" || (q.status === "in_nifty" && isCard);
  if (!okStatus) throw new Error(`Only approved drafts can go to eBay (this one is ${q.status.replace("_", " ")})`);
  if (!q.ebayCategoryId) throw new Error("Pick an eBay category first");
  // Single cards: Standard Envelope up to $20, calculated above (Todd's
  // policies, CARD_SHIPPING). Everything else: the draft's shipping kind.
  const ebayPrice = Number(q.venuePrices?.ebay ?? q.price);
  const cardShip = isCard ? cardShippingPolicy(ebayPrice) : null;
  const kind = cardShip?.kind ?? shipKind(q.shippingProfile);
  const ref = await referenceListing(kind, cardShip?.id);
  let conditionId: string;
  let descriptors: Array<Record<string, string>> | null = null;
  let card: CardCondition | null = null;
  if (isCard) {
    card = draftCardCondition(q);
    ({ conditionId, descriptors } = cardConditionFields(card, q.ebayCategoryId));
  } else {
    const allowed = await allowedConditions(q.ebayCategoryId);
    conditionId = pickConditionId(q.condition, allowed, ref.categoryId === q.ebayCategoryId ? ref.conditionId : null);
  }
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
  const hash = createHash("sha256").update(JSON.stringify(buildItem(draft, ref, conditionId, descriptors))).digest("hex").slice(0, 16);
  return { draft, ref, conditionId, descriptors, card, hash, status: q.status, meta: q.aiMeta };
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
    /** Single trading cards: "Ungraded: Excellent", "Graded: PSA 9". */
    cardCondition?: string | null;
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
  const b = await build(draftId);
  let messages: EbayMessage[] = [];
  let fees: EbayCheck["fees"] = null;
  let ok = false;
  try {
    const res = (await retrySystemError(() => tradingCall("VerifyAddFixedPriceItem", { Item: buildItem(b.draft, b.ref, b.conditionId, b.descriptors) }))) as Row;
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
      cardCondition: b.card ? cardConditionLabel(b.card) : null,
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
  const b = await build(draftId);
  const last = b.meta.ebayCheck as EbayCheck | undefined;
  if (!last?.ok) throw new Error("Run “Check with eBay” first, and fix anything it reports");
  if (last.hash !== b.hash) throw new Error("The draft (or a copied setting) changed since the last check; check with eBay again");
  if (Date.now() - Date.parse(last.at) > CHECK_TTL_MS) throw new Error("The last check is over a day old; check with eBay again");

  // One press at a time: claim the draft (a stale claim expires after 10 minutes).
  const [claim] = await rows(sql`
    UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('ebayPublishStartedAt', now()::text)
    WHERE id = ${draftId}::uuid AND status = ${b.status}
      AND (ai_meta->>'ebayPublishStartedAt' IS NULL OR (ai_meta->>'ebayPublishStartedAt')::timestamptz < now() - interval '10 minutes')
    RETURNING id`);
  if (!claim) throw new Error("Already publishing (or no longer approved) — refresh the page");

  try {
    // Photos → eBay picture hosting: Media API when the connection allows it,
    // otherwise our https links go in the listing and eBay copies them
    // (lib/ebay/media.ts; UploadSiteHostedPictures was retired).
    const photos = await hostPhotosForListing(b.draft.pictureUrls);
    const item = buildItem({ ...b.draft, pictureUrls: photos.urls }, b.ref, b.conditionId, b.descriptors);
    let res: Row;
    try {
      // Retrying is safe: the UUID stops a second listing if the first went through.
      res = (await retrySystemError(() => tradingCall("AddFixedPriceItem", { Item: item }))) as Row;
    } catch (err) {
      const msg = (err as Error).message;
      if (/UUID/i.test(msg)) throw new Error(`eBay already has a listing made from this draft (${msg}). Look for it in Seller Hub before trying again.`);
      throw err;
    }
    const itemId = str(res.ItemID);
    if (!itemId) throw new Error("eBay didn't return an item number");
    const fees = feeTotal(res.Fees);
    const messages = ebayMessages(res.Errors);
    await saveMeta(draftId, "ebayPublish", { at: new Date().toISOString(), itemId, fees, messages, by: who, copiedFrom: b.ref.itemId, photosVia: photos.via });

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
        WHERE id = ${draftId}::uuid AND status IN ('approved', 'in_nifty')`);
    }
    return { itemId, fees, messages };
  } finally {
    await db.execute(sql`UPDATE listing_drafts SET ai_meta = ai_meta - 'ebayPublishStartedAt' WHERE id = ${draftId}::uuid`);
  }
}

// ─── the eBay road: batch publishing and per-draft choices ──────────────────

/** eBay's check, then — only when eBay accepts it — publish. For the batch
 *  button on the Listings page (pressing it is Todd's go-ahead). */
export async function checkAndPublish(
  draftId: string,
  who: string
): Promise<{ ok: true; itemId: string; warnings: string[] } | { ok: false; error: string }> {
  try {
    const check = await checkDraftOnEbay(draftId, who);
    if (!check.ok) return { ok: false, error: check.messages.map((m) => m.message).join(" · ") || "eBay would reject it" };
    const r = await publishDraftToEbay(draftId, who);
    return { ok: true, itemId: r.itemId, warnings: r.messages.filter((m) => m.severity === "Warning").map((m) => m.message) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export type RoadDraft = { id: string; title: string; price: number; photos: number; cardCondition: string | null; error: string | null };

/** Drafts waiting on the eBay road: approved ones, and single cards that
 *  went to Nifty before (where eBay refused them). */
export async function ebayRoad(): Promise<{ approved: RoadDraft[]; fromNifty: RoadDraft[] }> {
  const s = await ebaySettings();
  const found = await rows(sql`
    SELECT d.id, d.title, d.price, d.venue_prices, d.status, d.ebay_category_id, d.condition, d.condition_note, d.item_specifics, d.ai_meta,
           (SELECT count(*)::int FROM draft_photos p WHERE p.draft_id = d.id AND p.uploaded_at IS NOT NULL) AS photos
    FROM listing_drafts d
    WHERE (d.status = 'approved' AND d.nifty_item_id IS NULL) OR (d.status = 'in_nifty' AND COALESCE(d.ebay_category_id, '') IN (${sql.join(CARD_SINGLE_CATEGORIES.map((c) => sql`${c}`), sql`, `)}))
    ORDER BY d.approved_at NULLS LAST, d.created_at`);
  const approved: RoadDraft[] = [];
  const fromNifty: RoadDraft[] = [];
  for (const d of found) {
    const meta = (d.ai_meta ?? {}) as Record<string, unknown>;
    const cat = (d.ebay_category_id as string | null) ?? null;
    if (draftRoute(s, cat, meta) !== "ebay" && !(d.status === "in_nifty" && isCardSingle(cat))) continue;
    const card = isCardSingle(cat)
      ? cardConditionLabel(
          draftCardCondition({
            condition: String(d.condition ?? "Used"),
            conditionNote: (d.condition_note as string | null) ?? null,
            itemSpecifics: (d.item_specifics ?? {}) as Record<string, string | string[]>,
            aiMeta: meta,
          })
        )
      : null;
    const lastCheck = meta.ebayCheck as EbayCheck | undefined;
    const row: RoadDraft = {
      id: String(d.id),
      title: String(d.title ?? ""),
      price: Number((d.venue_prices as Record<string, number> | null)?.ebay ?? d.price),
      photos: Number(d.photos ?? 0),
      cardCondition: card,
      error: lastCheck && !lastCheck.ok ? lastCheck.messages.map((m) => m.message).join(" · ").slice(0, 300) : null,
    };
    (d.status === "approved" ? approved : fromNifty).push(row);
  }
  return { approved, fromNifty };
}

export async function setDraftRoute(draftId: string, route: PublishRoute | null): Promise<void> {
  if (route) {
    await db.execute(sql`
      UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('publishRoute', ${route}::text), updated_at = now()
      WHERE id = ${draftId}::uuid AND status IN ('review', 'approved')`);
  } else {
    await db.execute(sql`UPDATE listing_drafts SET ai_meta = ai_meta - 'publishRoute', updated_at = now() WHERE id = ${draftId}::uuid`);
  }
}

export async function setDraftCardCondition(draftId: string, value: unknown): Promise<CardCondition | null> {
  const c = cleanCardCondition(value);
  if (!c) throw new Error("That isn't a card condition eBay knows");
  await db.execute(sql`
    UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('cardCondition', ${JSON.stringify(c)}::jsonb), updated_at = now()
    WHERE id = ${draftId}::uuid`);
  return c;
}

// ─── single cards: put FIA-listed cards on the right shipping policy ────────

export type CardShipFix = { itemId: string; title: string; price: number; from: string | null; to: string };

/** Live single cards FIA listed whose shipping policy isn't the one their
 *  price calls for (CARD_SHIPPING). */
export async function cardShippingMismatches(): Promise<CardShipFix[]> {
  const found = await rows(sql`
    SELECT e.item_id, e.title, e.price, e.shipping_profile_id
    FROM listing_drafts d JOIN ebay_listings e ON e.item_id = d.ai_meta->'ebayPublish'->>'itemId'
    WHERE e.quantity > 0 AND COALESCE(d.ebay_category_id, '') IN (${sql.join(CARD_SINGLE_CATEGORIES.map((c) => sql`${c}`), sql`, `)})
    ORDER BY e.price`);
  return found
    .map((r) => ({
      itemId: String(r.item_id),
      title: String(r.title ?? "").replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "'"),
      price: Number(r.price),
      from: (r.shipping_profile_id as string | null) ?? null,
      to: cardShippingPolicy(Number(r.price)).id,
    }))
    .filter((r) => Number.isFinite(r.price) && r.from !== r.to);
}

/** Revise those listings onto the right policy (and that policy's package
 *  size, keeping each listing's weight). Pressed by Todd on the settings
 *  page. The old policy id is kept on the draft (ai_meta.shippingFix). */
export async function fixCardShipping(who: string): Promise<{ fixed: CardShipFix[]; failed: Array<CardShipFix & { error: string }> }> {
  const list = await cardShippingMismatches();
  const refs = new Map<string, Reference>();
  const fixed: CardShipFix[] = [];
  const failed: Array<CardShipFix & { error: string }> = [];
  for (const f of list) {
    try {
      const ship = cardShippingPolicy(f.price);
      if (!refs.has(ship.id)) refs.set(ship.id, await referenceListing(ship.kind, ship.id));
      const ref = refs.get(ship.id)!;
      const [w] = await rows(sql`SELECT pkg_weight_oz FROM ebay_listings WHERE item_id = ${f.itemId}`);
      const pkg: Row = { ...(ref.pkg ?? {}) };
      const oz = Number(w?.pkg_weight_oz ?? 0) > 0 ? Number(w?.pkg_weight_oz) : 1;
      pkg.WeightMajor = { "@_unit": "lbs", "#text": String(Math.floor(oz / 16)) };
      pkg.WeightMinor = { "@_unit": "oz", "#text": String(Math.ceil(oz % 16)) };
      await tradingCall("ReviseFixedPriceItem", {
        Item: { ItemID: f.itemId, SellerProfiles: { SellerShippingProfile: { ShippingProfileID: ship.id } }, ShippingPackageDetails: pkg },
      });
      await db.execute(sql`
        UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('shippingFix',
          jsonb_build_object('from', ${f.from}::text, 'to', ${ship.id}::text, 'at', now()::text, 'by', ${who}::text))
        WHERE ai_meta->'ebayPublish'->>'itemId' = ${f.itemId}`);
      try {
        const got = (await tradingCall("GetItem", { ItemID: f.itemId, DetailLevel: "ReturnAll", IncludeItemSpecifics: false })) as Row;
        if (got.Item) await upsertListingFromItem(got.Item);
      } catch {
        /* the 15-minute sync catches up */
      }
      fixed.push(f);
    } catch (err) {
      failed.push({ ...f, error: (err as Error).message });
    }
  }
  return { fixed, failed };
}
