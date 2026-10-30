// Run: npx tsx --test lib/ebay/publish-core.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { buildItem, descriptionHtml, imageIdFromLocation, draftUuid, ebayMessages, feeTotal, lbOz, pickConditionId, policyMatches, shipKind, type Reference } from "./publish-core.ts";

const REF: Reference = {
  itemId: "117459947439",
  paymentProfileId: "111",
  returnProfileId: "222",
  shippingProfileId: "254457129020",
  shippingProfileName: "Very Small and Paper under 3.5 oz (eBay Standard Envelope) 1.25",
  location: "Lineville, Alabama",
  postalCode: "36266",
  country: "US",
  currency: "USD",
  dispatchTimeMax: "2",
  bestOffer: true,
  pkg: { MeasurementUnit: "English", PackageLength: { "@_unit": "inches", "#text": "6" }, WeightMajor: { "@_unit": "lbs", "#text": "0" }, WeightMinor: { "@_unit": "oz", "#text": "3" } },
  categoryId: "262042",
  conditionId: "3000",
};
const D = {
  draftId: "aabebc8d-c010-4241-bbe6-d7c34742448b",
  title: "Churches of Louisville Kentucky KY 1942 Linen Multiview Postcard Curt Teich",
  description: "Linen card & more.\n\nFront imprint <here>.\nSecond line.",
  condition: "Used",
  conditionNote: "Light corner wear.",
  price: 5.87,
  quantity: 1,
  sku: "Postcards 134",
  categoryId: "262042",
  itemSpecifics: { City: "Louisville", Theme: ["Architecture", "Religion"], Empty: [] as string[] },
  storeCategoryIds: ["54459788012", "54147268012"],
  weightOz: 1,
  pictureUrls: ["https://photos.foundinalabama.com/a.jpg", "https://photos.foundinalabama.com/b.jpg"],
};

test("ship kind and policy matching", () => {
  assert.equal(shipKind("envelope"), "envelope");
  assert.equal(shipKind(null), "calculated");
  assert.equal(policyMatches("envelope", REF.shippingProfileName), true);
  assert.equal(policyMatches("envelope", "Very Small and Paper under 3.5 oz (eBay Standard Envelope) FREE"), false);
  assert.equal(policyMatches("media", "Books &amp; Media - Pay Media Mail Rate Copy"), true);
  assert.equal(policyMatches("calculated", "Calculated GA/Priority USPS + FedEx + UPS (Buyer Pays) Copy"), true);
});

test("condition ids", () => {
  assert.equal(pickConditionId("Used", ["1000", "3000"], null), "3000");
  assert.equal(pickConditionId("Pre-owned - Good", ["2750", "4000", "5000", "6000"], null), "5000");
  assert.equal(pickConditionId("Used", ["2750", "4000", "5000", "6000"], null), "4000");
  assert.equal(pickConditionId("Like New", null, "3000"), "3000");
  assert.equal(pickConditionId("weird", ["1000", "3000"], null), "3000");
});

test("description, uuid, weight", () => {
  assert.equal(descriptionHtml(D.description), "Linen card &amp; more.<br/><br/>Front imprint &lt;here&gt;.<br/>Second line.");
  assert.equal(draftUuid(D.draftId), "AABEBC8DC0104241BBE6D7C34742448B");
  assert.deepEqual(lbOz(1), { major: 0, minor: 1 });
  assert.deepEqual(lbOz(17.2), { major: 1, minor: 2 });
});

test("the eBay item carries the draft and the reference settings", () => {
  const it = buildItem(D, REF, "3000") as Record<string, any>;
  assert.equal(it.Title, D.title);
  assert.equal(it.StartPrice["#text"], "5.87");
  assert.equal(it.ConditionID, "3000");
  assert.equal(it.ConditionDescription, "Light corner wear.");
  assert.equal(it.SKU, "Postcards 134");
  assert.equal(it.UUID.length, 32);
  assert.deepEqual(it.Storefront, { StoreCategoryID: "54459788012", StoreCategory2ID: "54147268012" });
  assert.equal(it.SellerProfiles.SellerShippingProfile.ShippingProfileID, "254457129020");
  assert.equal(it.SellerProfiles.SellerReturnProfile.ReturnProfileID, "222");
  assert.equal(it.ShippingPackageDetails.WeightMinor["#text"], "1");
  assert.equal(it.ShippingPackageDetails.PackageLength["#text"], "6");
  assert.deepEqual(it.ItemSpecifics.NameValueList, [
    { Name: "City", Value: "Louisville" },
    { Name: "Theme", Value: ["Architecture", "Religion"] },
  ]);
  assert.equal(it.BestOfferDetails.BestOfferEnabled, true);
  assert.equal(it.ListingDuration, "GTC");
  assert.throws(() => buildItem({ ...D, pictureUrls: [] }, REF, "3000"), /no photos/);
  assert.throws(() => buildItem({ ...D, price: 0 }, REF, "3000"), /no price/);
});

test("messages and fees", () => {
  const m = ebayMessages([{ SeverityCode: "Warning", ErrorCode: 21919189, LongMessage: "Best Offer &amp; more" }, { SeverityCode: "Error", ShortMessage: "Bad" }]);
  assert.deepEqual(m[0], { severity: "Warning", code: "21919189", message: "Best Offer & more" });
  assert.equal(m[1].severity, "Error");
  const f = feeTotal({ Fee: [{ Name: "InsertionFee", Fee: 0.35 }, { Name: "ListingFee", Fee: 0 }, { Name: "BoldFee", Fee: "0.00" }] });
  assert.deepEqual(f, { total: 0.35, lines: [{ name: "InsertionFee", amount: 0.35 }] });
  // A store's free listing: fee with an equal promotional discount → nothing to pay.
  assert.deepEqual(feeTotal({ Fee: [{ Name: "InsertionFee", Fee: 0.2, PromotionalDiscount: 0.2 }] }), { total: 0, lines: [{ name: "InsertionFee", amount: 0, listed: 0.2 }] });
});

// ─── single trading cards ────────────────────────────────────────────────
import { cardConditionFields, cleanCardCondition, guessCardCondition, isCardSingle } from "./publish-core.ts";

test("card singles are recognised by category", () => {
  assert.equal(isCardSingle("261328"), true);
  assert.equal(isCardSingle("183454"), true);
  assert.equal(isCardSingle("261329"), false); // lots
  assert.equal(isCardSingle(null), false);
});

test("guessCardCondition: ungraded from condition word and note", () => {
  assert.deepEqual(guessCardCondition("Used", "Ungraded. In toploader."), { graded: false, condition: "Excellent" });
  assert.deepEqual(guessCardCondition("Used", "Light edge and corner wear. No COA."), { graded: false, condition: "Excellent" });
  assert.deepEqual(guessCardCondition("Used", "Corner and edge wear; small light mark on front."), { graded: false, condition: "Very Good" });
  assert.deepEqual(guessCardCondition("Pre-owned - Fair", "creases"), { graded: false, condition: "Poor" });
  assert.deepEqual(guessCardCondition("Used", "Small crease top left."), { graded: false, condition: "Very Good" });
  assert.deepEqual(guessCardCondition("Like New", null), { graded: false, condition: "Near Mint or Better" });
  assert.deepEqual(guessCardCondition("Used", "x", { "Card Condition": "Very Good" }), { graded: false, condition: "Very Good" });
});

test("guessCardCondition: graded from note or specifics", () => {
  assert.deepEqual(guessCardCondition("Used", "PSA 9 Mint, cert #12345678."), { graded: true, grader: "PSA", grade: "9", cert: "12345678" });
  assert.deepEqual(guessCardCondition("Used", "BGS 9.5 slab"), { graded: true, grader: "BGS", grade: "9.5", cert: null });
  assert.deepEqual(guessCardCondition("Used", null, { "Professional Grader": "SGC", Grade: "8" }), { graded: true, grader: "SGC", grade: "8", cert: null });
  assert.equal(guessCardCondition("Used", "Ungraded; would likely be PSA 8").graded, false);
});

test("cardConditionFields → eBay ids and descriptors", () => {
  assert.deepEqual(cardConditionFields({ graded: false, condition: "Excellent" }, "261328"), {
    conditionId: "4000",
    descriptors: [{ Name: "40001", Value: "400011" }],
  });
  assert.deepEqual(cardConditionFields({ graded: false, condition: "Excellent" }, "183454").descriptors, [{ Name: "40001", Value: "400015" }]);
  assert.deepEqual(cardConditionFields({ graded: true, grader: "PSA", grade: "10", cert: "999" }, "261328"), {
    conditionId: "2750",
    descriptors: [
      { Name: "27501", Value: "275010" },
      { Name: "27502", Value: "275020" },
      { Name: "27503", AdditionalInfo: "999" },
    ],
  });
});

test("cleanCardCondition rejects junk", () => {
  assert.equal(cleanCardCondition({ graded: false, condition: "Mint" }), null);
  assert.equal(cleanCardCondition({ graded: true, grader: "XYZ", grade: "9" }), null);
  assert.deepEqual(cleanCardCondition({ graded: true, grader: "CGC", grade: "8.5", cert: " " }), { graded: true, grader: "CGC", grade: "8.5", cert: null });
});

test("buildItem sends card descriptors and drops clashing specifics", () => {
  const card = cardConditionFields({ graded: false, condition: "Very Good" }, "261328");
  const item = buildItem(
    {
      draftId: "0b7c2a9e-3f1d-4c2b-9a8e-1d2c3b4a5f60",
      title: "1987 Fleer Jose Canseco #389",
      description: "A card.",
      condition: "Used",
      conditionNote: "Ungraded.",
      price: 5.87,
      quantity: 1,
      sku: "A1",
      categoryId: "261328",
      itemSpecifics: { Sport: "Baseball", "Card Condition": "Excellent", Graded: "No" },
      storeCategoryIds: [],
      weightOz: 1,
      pictureUrls: ["https://x/1.jpg"],
    },
    REF,
    card.conditionId,
    card.descriptors
  ) as Record<string, any>;
  assert.equal(item.ConditionID, "4000");
  assert.deepEqual(item.ConditionDescriptors, { ConditionDescriptor: [{ Name: "40001", Value: "400012" }] });
  assert.deepEqual(item.ItemSpecifics.NameValueList.map((n: any) => n.Name), ["Sport"]);
  assert.equal(item.ConditionDescription, undefined); // eBay rejects it for card singles
});

import { cardShippingPolicy } from "./publish-core.ts";
test("card shipping policy by price", () => {
  assert.deepEqual(cardShippingPolicy(5.87), { id: "254457129020", kind: "envelope" });
  assert.deepEqual(cardShippingPolicy(20), { id: "254457129020", kind: "envelope" });
  assert.deepEqual(cardShippingPolicy(20.87), { id: "254457062020", kind: "calculated" });
});

test("imageIdFromLocation reads the Media API image id", () => {
  assert.equal(imageIdFromLocation("https://apim.ebay.com/commerce/media/v1_beta/image/v1%7C1234"), "v1|1234");
  assert.equal(imageIdFromLocation("https://apim.ebay.com/commerce/media/v1_beta/image/abc/"), "abc");
  assert.equal(imageIdFromLocation(null), null);
  assert.equal(imageIdFromLocation("https://example.com/nothing"), null);
});

import { retrySystemError } from "./publish-core.ts";
test("retrySystemError retries eBay 10007 only", async () => {
  let n = 0;
  const ok = await retrySystemError(async () => {
    n++;
    if (n < 3) throw new Error("eBay AddFixedPriceItem Failure: [10007] System error. Unable to process your request.");
    return "listed";
  }, [1, 1]);
  assert.equal(ok, "listed");
  assert.equal(n, 3);
  let m = 0;
  await assert.rejects(retrySystemError(async () => { m++; throw new Error("[21919303] missing specific"); }, [1, 1]));
  assert.equal(m, 1);
  let k = 0;
  await assert.rejects(retrySystemError(async () => { k++; throw new Error("[10007] System error"); }, [1, 1]), /10007/);
  assert.equal(k, 3);
});
