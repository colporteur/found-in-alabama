// Run on Windows: npx tsx lib/enhance/ese.test.mts
import {
  eseNormPath, eseEligible, eseCardGroup, isEnvelopeShipping, triageListing, eseList,
} from "./ese";

let n = 0, bad = 0;
function eq(label: string, got: unknown, want: unknown) {
  n++;
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { console.log("PASS " + label); return; }
  bad++; console.log("FAIL " + label + "\n   got  " + a + "\n   want " + b);
}

const ENV = "Very Small and Paper under 3.5 oz (eBay Standard Envelope)";
const CALC = "Calculated Shipping 4oz";

// ── list + normalization ────────────────────────────────────────────────────
eq("list loads", eseList().length > 1000, true);
eq("normalizes > and : the same",
  eseNormPath("Collectibles > Postcards & Supplies > Postcards"),
  eseNormPath("Collectibles:Postcards & Supplies:Postcards"));
eq("ampersand == and", eseNormPath("Coins & Paper Money"), eseNormPath("Coins and Paper Money"));

// ── eligibility ─────────────────────────────────────────────────────────────
eq("listed path is eligible", eseEligible("Collectibles > Postcards & Supplies > Postcards"), true);
eq("child of a listed path is eligible (colon form from GetSellerList)",
  eseEligible("Collectibles:Postcards & Supplies:Postcards:Topographical Postcards"), true);
eq("souvenir state category is NOT eligible",
  eseEligible("Collectibles:Souvenirs & Travel Memorabilia:United States:Alabama"), false);
eq("empty is not eligible", eseEligible(""), false);
eq("Books is eligible (list is broader than cards)", eseEligible("Books & Magazines:Books:Fiction"), true);
eq("US small cents eligible", eseEligible("Coins & Paper Money > Coins > US > Small Cents > Lincoln Wheat (1909-1958)"), true);

// ── card group ──────────────────────────────────────────────────────────────
eq("RPPC → Postcards", eseCardGroup("RPPC Anniston Alabama Depot 1910"), "Postcards");
eq("stamp cover → Stamps", eseCardGroup("1938 First Day Cover Birmingham AL"), "Stamps");
eq("wheat cent → Coins", eseCardGroup("1943 Steel Wheat Cent"), "Coins");
eq("photo → no group", eseCardGroup("Vintage Photo Snapshot Birmingham Steel Mill 1950s"), "");
eq("description is the fallback", eseCardGroup("Anniston Alabama Depot", "A real photo postcard of..."), "Postcards");

// ── envelope detection ──────────────────────────────────────────────────────
eq("policy name", isEnvelopeShipping(ENV), true);
eq("policy name without suffix", isEnvelopeShipping("Very Small and Paper under 3.5 oz"), true);
eq("service code fallback", isEnvelopeShipping(null, ["USPSStandardEnvelope"]), true);
eq("calculated is not envelope", isEnvelopeShipping(CALC, ["USPSGroundAdvantage"]), false);

// ── triage ──────────────────────────────────────────────────────────────────
const base = { description: null, shippingServices: null };
eq("postcard in souvenir category → recategorize",
  triageListing({ ...base, title: "Vintage Postcard Mobile Alabama Bienville Square", siteCategoryName: "Collectibles:Souvenirs & Travel Memorabilia:United States:Alabama", shippingProfileName: ENV, price: "6.87" }).action,
  "recategorize");
eq("photographs IS on eBay's list (surprise) → ok",
  triageListing({ ...base, title: "Vintage Photo Snapshot Birmingham Steel Mill", siteCategoryName: "Collectibles:Photographic Images:Photographs", shippingProfileName: ENV, price: "9.87" }).action,
  "ok");
eq("souvenir spoon in souvenir category → reship",
  triageListing({ ...base, title: "Vintage Souvenir Spoon Gulf Shores Alabama", siteCategoryName: "Collectibles:Souvenirs & Travel Memorabilia:United States:Alabama", shippingProfileName: ENV, price: "9.87" }).action,
  "reship");
eq("postcard over $20 → reship (envelope cap)",
  triageListing({ ...base, title: "RPPC Rare Depot", siteCategoryName: "Collectibles:Souvenirs & Travel Memorabilia:United States:Alabama", shippingProfileName: ENV, price: "24.87" }).action,
  "reship");
eq("postcard in eligible category → ok",
  triageListing({ ...base, title: "RPPC Depot", siteCategoryName: "Collectibles:Postcards & Supplies:Postcards:Topographical Postcards", shippingProfileName: ENV, price: "6.87" }).action,
  "ok");
eq("calculated shipping → n/a",
  triageListing({ ...base, title: "Vintage Photo", siteCategoryName: "Collectibles:Photographic Images:Photographs", shippingProfileName: CALC, price: "9.87" }).action,
  "n/a");
eq("no profile but envelope service code → still audited",
  triageListing({ ...base, title: "Souvenir Pennant Gulf Shores", siteCategoryName: "Collectibles:Souvenirs & Travel Memorabilia:United States:Alabama", shippingProfileName: null, shippingServices: ["USPSStandardEnvelope"], price: "9.87" }).action,
  "reship");

console.log(`\n${n - bad}/${n} passed`);
if (bad) process.exit(1);
