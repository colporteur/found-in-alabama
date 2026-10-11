// Run: npx tsx --test lib/ebay/publish-core.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { buildItem, descriptionHtml, draftUuid, ebayMessages, feeTotal, lbOz, pickConditionId, policyMatches, shipKind, type Reference } from "./publish-core.ts";

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
