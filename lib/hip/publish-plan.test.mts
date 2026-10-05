// Run: npx tsx --test lib/hip/publish-plan.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { planHipListing } from "./category-map";
import { buildHipPayload, planHipPublish, summarizePlan, type PoolItem } from "./publish-plan";
import { ebayItemIdFromHip } from "./client";

const env = {};
const plan = (siteCategoryName: string, title = "Vintage item", siteCategoryId: string | null = null) =>
  planHipListing({ siteCategoryId, siteCategoryName, title }, env);

test("exclusions: books, magazines, sports/game cards, comics, pinbacks, signs", () => {
  for (const path of [
    "Books &amp; Magazines:Books",
    "Books & Magazines:Antiquarian & Collectible",
    "Books & Magazines:Audiobooks",
    "Books & Magazines:Magazines",
    "Sports Mem, Cards & Fan Shop:Sports Trading Cards:Trading Card Singles",
    "Toys & Hobbies:Collectible Card Games:CCG Individual Cards",
    "Collectibles:Comic Books & Memorabilia:Comics",
    "Collectibles:Pinbacks & Lunchboxes:Pinbacks",
    "Home & Garden:Home Décor:Plaques & Signs",
  ]) assert.equal(plan(path).action, "exclude", path);
});

test("postcards keep Hip's magic categories", () => {
  assert.deepEqual(plan("x", "Florida linen", "262042").action, "list");
  assert.equal((plan("x", "Florida linen", "262042") as any).categoryId, 0);
  assert.equal((plan("x", "Comic card", "262043") as any).categoryId, 2056);
  assert.equal((plan("Collectibles:Holiday & Seasonal:Cards & Postcards", "Easter Postcard Rabbits") as any).categoryId, 2056);
  assert.equal((plan("Collectibles:Holiday & Seasonal:Cards & Postcards", "1950s Christmas Card Glitter") as any).categoryId, 36513);
});

test("categories Hip's sync never imported now map to Ephemera leaves", () => {
  const id = (p: string, t?: string) => (plan(p, t) as any).categoryId;
  assert.equal(id("Collectibles:Paper:Vintage Greeting Cards"), 36513);
  assert.equal(id("Collectibles:Transportation:Maps & Atlases"), 36438);
  assert.equal(id("Musical Instruments & Gear:Sheet Music & Song Books:Vintage & Antique"), 36441);
  assert.equal(id("Collectibles:Transportation:Railroadiana & Trains"), 36462);
  assert.equal(id("Collectibles:Paper:Ephemera", "1940s Diner Menu Birmingham"), 36439);
  assert.equal(id("Collectibles:Paper:Ephemera", "Victorian Trade Card Clark's Thread"), 36490);
  assert.equal(id("Collectibles:Souvenirs & Travel Memorabilia:United States", "Souvenir Folder Chattanooga Postcard"), 0);
  assert.equal(id("Collectibles:Souvenirs & Travel Memorabilia:United States", "Lookout Mountain Brochure 1950"), 36447);
  assert.equal(id("Collectibles:Advertising:Food & Beverage", "1952 Coca-Cola Magazine Ad"), 36423);
  assert.equal(id("Collectibles:Photographic Images:Photographs", "Snapshot 1940s Family"), 36453);
});

test("photograph category can be overridden once Hip confirms one", () => {
  const p = planHipListing({ siteCategoryId: null, siteCategoryName: "Collectibles:Photographic Images:Photographs", title: "Snapshot" }, { HIP_CATEGORY_PHOTOGRAPHS: "40001" });
  assert.equal((p as any).categoryId, 40001);
});

test("unknown non-paper categories go to review, not a guess", () => {
  assert.equal(plan("Home & Garden:Kitchen, Dining & Bar:Dinnerware & Serveware:Mugs").action, "review");
});

const item: PoolItem = {
  itemId: "117000000001", title: "Vintage 1940s Linen Postcard Mobile Alabama &amp; Bay", price: "6.50", quantity: 1,
  description: "<p>Nice card &amp; clean.</p>", primaryImageUrl: "https://i.ebayimg.com/a.jpg",
  imageUrls: ["https://i.ebayimg.com/a.jpg", "https://i.ebayimg.com/b.jpg", "javascript:x"],
  siteCategoryId: "262042", siteCategoryName: "Collectibles:Postcards & Supplies:Postcards:Topographical Postcards", listingType: "FixedPriceItem",
};

test("payload mirrors eBay price, decodes text, dedupes images, stamps private_id", () => {
  const b = buildHipPayload(item, env);
  assert.ok("payload" in b);
  assert.equal(b.payload.buyout_price, 6.5);
  assert.equal(b.payload.name, "Vintage 1940s Linen Postcard Mobile Alabama & Bay");
  assert.equal(b.payload.description, "Nice card & clean.");
  assert.deepEqual(b.payload.images, ["https://i.ebayimg.com/a.jpg", "https://i.ebayimg.com/b.jpg"]);
  assert.equal(b.payload.private_id, "tes-ebay:117000000001");
  assert.equal(b.payload.category_id, 0);
});

test("payload refuses missing photo, zero price, auctions", () => {
  assert.ok("problem" in buildHipPayload({ ...item, imageUrls: [], primaryImageUrl: null }, env));
  assert.ok("problem" in buildHipPayload({ ...item, price: "0" }, env));
  assert.ok("problem" in buildHipPayload({ ...item, listingType: "Chinese" }, env));
});

test("plan adopts Hip-sync listings, creates the rest, flags collisions and repeat failures", () => {
  const pool: PoolItem[] = [
    item,
    { ...item, itemId: "2", title: "Second card" },
    { ...item, itemId: "3", title: "Third card", price: "9.00" },
    { ...item, itemId: "4", title: "Same Title On Hip" },
    { ...item, itemId: "5", title: "Fails a lot" },
    { ...item, itemId: "6", siteCategoryName: "Books & Magazines:Books", siteCategoryId: "1" },
  ];
  const rows = planHipPublish(
    pool,
    [
      { hipId: 10, externalId: "117000000001", privateId: null, title: "x", price: "6.50" },
      { hipId: 11, externalId: "3", privateId: "tes-ebay:3", title: "Third card", price: "7.00" },
      { hipId: 12, externalId: null, privateId: null, title: "same title on hip", price: "1" },
    ],
    new Map([["5", 3]]),
    env
  );
  const kinds = Object.fromEntries(rows.map((r) => [r.itemId, r.kind]));
  assert.deepEqual(kinds, { "117000000001": "on_hip", "2": "create", "3": "on_hip", "4": "review", "5": "review", "6": "exclude" });
  const third = rows.find((r) => r.itemId === "3");
  assert.ok(third?.kind === "on_hip" && third.priceDrift && third.ours);
  const first = rows.find((r) => r.itemId === "117000000001");
  assert.ok(first?.kind === "on_hip" && !first.priceDrift && !first.ours);
  assert.equal(summarizePlan(rows).counts.create, 1);
});

test("price wiggles under 5% or 25¢ are not drift", () => {
  const drift = (hip: string, ebay: string) => {
    const [r] = planHipPublish([{ ...item, price: ebay }], [{ hipId: 1, externalId: item.itemId, privateId: null, title: "x", price: hip }], new Map(), env);
    return r.kind === "on_hip" && r.priceDrift;
  };
  assert.equal(drift("20.72", "20.68"), false);
  assert.equal(drift("5.87", "5.84"), false);
  assert.equal(drift("0.99", "1.10"), false); // 10% but only 11¢
  assert.equal(drift("8.00", "10.00"), true);
  assert.equal(drift("12.50", "10.00"), true);
});

test("our private_id resolves back to the eBay item (so sales + closing work)", () => {
  assert.equal(ebayItemIdFromHip({ id: 1, name: "x", private_id: "tes-ebay:117000000001" }), "117000000001");
  assert.equal(ebayItemIdFromHip({ id: 1, name: "x", external_id: 1234, external_id_type: "ebay" }), "1234");
  assert.equal(ebayItemIdFromHip({ id: 1, name: "x", private_id: "Postcards 42" }), null);
});
