// BOLO list — discontinued household & beauty products that resell well on
// eBay. Researched Nov 2026 (prompted by @ZachAltmyer's "know 400 products"
// post). Shown at /admin/bolo, built for checking on a phone in the aisle.
//
// Items added from a photo on the page live in the bolo_items table
// (lib/bolo/store.ts) and are merged in at render time. The list below is
// the seed research. To add one by hand: append an entry below and deploy. `query` drives the
// thumbnail and the live-listing count (eBay Browse API, cached 12h) and the
// sold-comps link, so make it specific enough to find THIS product.
//
// `comp` is what we found at research time. `kind` matters: "sold" is a real
// completed sale; "asking" is only a listed price — anyone can list soup for
// $200. Always check the Sold comps link before buying deep.

export type BoloCategory =
  | "Cleaners & polish"
  | "Air fresheners"
  | "Bar soap"
  | "Hair care"
  | "Fragrance"
  | "Other"
  | "Traps";

export type BoloItem = {
  id: string;
  name: string;
  category: BoloCategory;
  /** eBay search used for the thumbnail, live count and comps links. */
  query: string;
  /** Price seen at research time, e.g. "$49.99 / 3-pack". */
  comp: string;
  kind: "sold" | "asking" | "retail";
  /** What to look for on the shelf; caveats. */
  note?: string;
  /** Where the comp came from, if there's a link. */
  source?: string;
  /** Fixed thumbnail, if the Browse search picks a bad photo. */
  img?: string;
};

export const BOLO_RESEARCHED = "Nov 5, 2026";

export const BOLO_ITEMS: BoloItem[] = [
  // ── Cleaners & polish ────────────────────────────────────────────────
  {
    id: "pledge-clean-it-citrus",
    name: "Pledge Clean It Multi-Surface, Fresh Citrus 16 oz",
    category: "Cleaners & polish",
    query: "Pledge Clean It Multi-Surface Fresh Citrus 16 oz",
    comp: "$49.99–$62.99 / 3-pack",
    kind: "sold",
    note: "Blue trigger bottle, yellow label. 3-packs sold Nov 1–2, 2026. Seen at $4.99 in-store.",
  },
  {
    id: "pledge-rainshower-floor",
    name: "Pledge Rainshower Clean It Floor Cleaner Concentrate 32 oz",
    category: "Cleaners & polish",
    query: "Pledge Rainshower floor cleaner concentrate 32 oz",
    comp: "$80 single",
    kind: "sold",
    note: "Sold Nov 2, 2026. The 27 oz Rainshower multi-surface floor cleaner sells too.",
  },
  {
    id: "magic-cabinet-wood",
    name: "Magic Cabinet & Wood Cleaner 17 oz aerosol",
    category: "Cleaners & polish",
    query: "Magic Cabinet Wood Cleaner Polish 17 oz aerosol",
    comp: "$38 sold · $25–$75 asking",
    kind: "sold",
    note: "Also grab Magic Countertop Cleaner 17 oz and the old Cabinet Magic 13 oz can. Aerosol = ground-only hazmat shipping.",
    source: "https://www.ebay.com/itm/335501116251",
  },
  {
    id: "noxon-7",
    name: "Noxon 7 Metal Polish 12 oz",
    category: "Cleaners & polish",
    query: "Noxon 7 metal polish 12 oz",
    comp: "$99.99",
    kind: "asking",
    note: "Full bottles only. 58 product ratings on eBay, so there's steady demand.",
  },
  {
    id: "scj-paste-wax",
    name: "SC Johnson Paste Wax, original formula 16 oz",
    category: "Cleaners & polish",
    query: "SC Johnson paste wax original 16 oz",
    comp: "$79.90 full · $40.50 opened",
    kind: "asking",
    note: "Yellow/red tin. Even opened cans list.",
  },
  {
    id: "cook-top-creme",
    name: "Cook Top Cleaning Creme 20 oz",
    category: "Cleaners & polish",
    query: "Cook Top cleaning creme 20 oz",
    comp: "$35–$80",
    kind: "asking",
    note: "One $79.99 listing shows 17 sold — real sell-through.",
    source: "https://www.ebay.com/itm/405056196161",
  },
  {
    id: "butchers-spray",
    name: "Butcher's Spray Cleaning Polish 22 oz",
    category: "Cleaners & polish",
    query: "Butcher's spray cleaning polish",
    comp: "$46.99",
    kind: "asking",
  },
  {
    id: "resolve-granules",
    name: "Resolve High Traffic Carpet Granules 18 oz",
    category: "Cleaners & polish",
    query: "Resolve high traffic carpet granules",
    comp: "$44.95",
    kind: "asking",
    note: "Canister with brush top.",
  },
  {
    id: "sta-flo",
    name: "Purex Sta-Flo Liquid Starch 64 oz",
    category: "Cleaners & polish",
    query: "Sta-Flo liquid starch 64 oz",
    comp: "$50.16",
    kind: "asking",
    note: "Quilters and slime crafters buy it. Check your local shelves first; it may still be in stores near you.",
  },
  {
    id: "whink-iron",
    name: "Whink Steam Iron Cleaner 10 oz",
    category: "Cleaners & polish",
    query: "Whink steam iron cleaner",
    comp: "$39.99 / 3",
    kind: "asking",
  },
  {
    id: "dawn-power-dissolver",
    name: "Dawn Power Dissolver spray 12.8 oz",
    category: "Cleaners & polish",
    query: "Dawn Power Dissolver spray",
    comp: "$35.99",
    kind: "asking",
  },
  {
    id: "mr-clean-magicreach",
    name: "Mr. Clean MagicReach tub & shower refill pads",
    category: "Cleaners & polish",
    query: "Mr Clean MagicReach refill pads",
    comp: "$31 / 8-pack",
    kind: "asking",
    note: "Buyers who own the tool can't find refills. Also watch for Mr. Clean Liquid Muscle.",
  },

  // ── Air fresheners ───────────────────────────────────────────────────
  {
    id: "glade-sense-spray",
    name: "Glade Sense & Spray refills (Hawaiian Breeze)",
    category: "Air fresheners",
    query: "Glade Sense and Spray refill Hawaiian Breeze",
    comp: "$39.99 / 2-count",
    kind: "asking",
    note: "Owners of the device have no other refill source.",
  },
  {
    id: "glade-nightlight",
    name: "Glade PlugIns Night Light oil warmer",
    category: "Air fresheners",
    query: "Glade PlugIns night light scented oil warmer",
    comp: "$47.95",
    kind: "asking",
  },
  {
    id: "glade-carpet-hawaiian",
    name: "Glade Hawaiian Breeze Carpet & Room Refresher 32 oz",
    category: "Air fresheners",
    query: "Glade Hawaiian Breeze carpet room refresher",
    comp: "Check comps",
    kind: "asking",
    note: "Hawaiian Breeze has a loyal following across formats.",
  },
  {
    id: "febreze-wax-melts",
    name: "Febreze Unstopables wax melts & holiday scents",
    category: "Air fresheners",
    query: "Febreze Unstopables wax melts discontinued",
    comp: "$29.99 / 4-pack",
    kind: "asking",
    note: "A buyer paid almost 4× original for vanilla.",
  },

  // ── Bar soap ─────────────────────────────────────────────────────────
  {
    id: "dial-tropical-escape",
    name: "Dial Tropical Escape bar soap",
    category: "Bar soap",
    query: "Dial Tropical Escape bar soap",
    comp: "$44.99 / two 6-packs",
    kind: "sold",
    source: "https://www.ebay.de/itm/267316804527",
  },
  {
    id: "dial-red-deodorant",
    name: "Dial red deodorant bar soap (03920)",
    category: "Bar soap",
    query: "Dial 03920 deodorant soap red",
    comp: "$95 / 8 bars",
    kind: "asking",
    source: "https://www.ebay.com/itm/226694112866",
  },
  {
    id: "dial-basics",
    name: "Dial Basics Hypoallergenic bar soap",
    category: "Bar soap",
    query: "Dial Basics hypoallergenic bar soap",
    comp: "$24.95–$29.99 / 2 bars",
    kind: "asking",
  },
  {
    id: "dial-marula",
    name: "Dial Marula Oil beauty bars",
    category: "Bar soap",
    query: "Dial Marula Oil bar soap",
    comp: "$29.99 / 16 ct",
    kind: "asking",
  },
  {
    id: "dial-almond",
    name: "Dial Almond, vintage gold wrapper",
    category: "Bar soap",
    query: "Dial almond soap vintage",
    comp: "$17.54 / 3 bars",
    kind: "asking",
    note: "Small but easy; nostalgia buyers.",
  },

  // ── Hair care ────────────────────────────────────────────────────────
  {
    id: "vidal-sassoon-pro",
    name: "Vidal Sassoon Pro Series shampoos",
    category: "Hair care",
    query: "Vidal Sassoon Pro Series shampoo",
    comp: "$38.61 (12 oz) · $49.99 (25.3 oz)",
    kind: "asking",
    note: "Line was rebranded to “Sassoon”; old bottles say “Pro Series.”",
    source: "https://www.ebay.com/p/1003391353",
  },
  {
    id: "herbal-body-envy",
    name: "Herbal Essences Body Envy / Hydralicious",
    category: "Hair care",
    query: "Herbal Essences Body Envy shampoo",
    comp: "~$51 / 2 bottles",
    kind: "asking",
  },
  {
    id: "breck-gold",
    name: "Breck Gold Formula shampoo (vintage)",
    category: "Hair care",
    query: "Breck Gold Formula shampoo",
    comp: "$39.98 + ship",
    kind: "sold",
    source: "https://ebay.com/itm/125968780997",
  },
  {
    id: "salon-lanza-aquage",
    name: "Salon lines: Lanza KB2, Aquage, Graham Webb Back to Basics",
    category: "Hair care",
    query: "Lanza KB2 clarifying shampoo liter",
    comp: "$69.95–$99.95",
    kind: "asking",
    note: "Liter sizes are the money. Also Redken, Bumble, Aveda discontinued formulas.",
    source: "https://www.ebay.com/str/discontinuedbeauty2",
  },

  // ── Fragrance ────────────────────────────────────────────────────────
  {
    id: "loves-baby-soft-vintage",
    name: "Love's Baby Soft — vintage Mem / Chattem bottles",
    category: "Fragrance",
    query: "Love's Baby Soft Mem cologne vintage",
    comp: "$44.99 splash · $55 sold (set)",
    kind: "asking",
    note: "Old packaging only. Current Dana version is ~$16 — see Traps.",
  },
  {
    id: "spongebob-cologne",
    name: "SpongeBob cologne (2014, Patrick / Gary too)",
    category: "Fragrance",
    query: "SpongeBob cologne EDT",
    comp: "$150–$250+",
    kind: "asking",
    note: "Retailed $15–$20. Nostalgia spike — sell fast, don't hoard.",
    source: "https://resellcalendar.com/news/news/viral-spongebob-cologne-edt-reseller/",
  },

  // ── Traps (don't pay up) ─────────────────────────────────────────────
  {
    id: "trap-pledge-orange",
    name: "Pledge Restoring Orange Oil 16 oz",
    category: "Traps",
    query: "Pledge Restoring Orange Oil 16 oz",
    comp: "$6.99 retail",
    kind: "retail",
    note: "eBay buyers think it's gone, but hardware stores still stock it. Only worth it at clearance.",
    source: "https://www.familyhardware.com/product/pledge-expert-care-16-oz-restoring-orange-oil-wood-cleaner/618647",
  },
  {
    id: "trap-bbw-retired",
    name: "Bath & Body Works “retired” scents",
    category: "Traps",
    query: "Bath and Body Works retired scent",
    comp: "Volatile",
    kind: "retail",
    note: "B&BW brings retired scents back at the June/December Semi-Annual Sales. Prices crash.",
  },
  {
    id: "trap-dana-babysoft",
    name: "Love's Baby Soft — current Dana version",
    category: "Traps",
    query: "Dana Love's Baby Soft cologne mist 1.5 oz",
    comp: "~$16",
    kind: "retail",
    note: "Still made; 5,000+ sold at ~$16. Only the old Mem/Chattem packaging brings money.",
  },
];
