import {
  buildSupplyQuery, decideReprice, parseRepriceConfig, round87, REPRICE_DEFAULTS,
  type SupplySnapshot, type RepriceConfig,
} from "./supply";

let n = 0, bad = 0;
function eq(label: string, got: unknown, want: unknown) {
  n++;
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { console.log("PASS " + label); return; }
  bad++; console.log("FAIL " + label + "\n   got  " + a + "\n   want " + b);
}

const CFG: RepriceConfig = { ...REPRICE_DEFAULTS, minAgeDays: 0 };
const stats = (nn: number, median: number) => ({ n: nn, min: median, median, max: median });
function snap(p: Partial<SupplySnapshot>): SupplySnapshot {
  return {
    q: "x", q_used: "x", loosened: false, total: 0, counted: 0, same: 0, similar: 0, other: 0,
    band: "none", same_stats: null, similar_stats: null, all_stats: null, ...p,
  };
}

// ── query building ──────────────────────────────────────────────────────────
eq("strips publisher phrase + grade + serial, keeps town/subject, format last",
  buildSupplyQuery("Vintage Linen Postcard Curt Teich Mobile Alabama Bienville Square VG+ 0B-H864"),
  { q: "Mobile Alabama Bienville Square postcard", category: "262042" });
eq("photo title -> no postcard category",
  buildSupplyQuery("Vintage Photo Snapshot Birmingham Alabama Steel Mill 1950s 8x10"),
  { q: "Birmingham Alabama Steel Mill 1950s photo", category: "" });
eq("rppc keeps the postcard category",
  buildSupplyQuery("RPPC Real Photo Anniston Alabama Depot Train Station"),
  { q: "Real Anniston Alabama Depot Train Station rppc", category: "262042" });

// ── the raise case: this is the point of the whole op ───────────────────────
eq("sole supplier under the gate raises to the similar median",
  decideReprice(5.87, snap({ band: "sole", same: 0, similar: 6, similar_stats: stats(6, 14.5) }), CFG, 200).action,
  "raise");
eq("  ...and lands on the .87 ending",
  decideReprice(5.87, snap({ band: "sole", same: 0, similar: 6, similar_stats: stats(6, 14.5) }), CFG, 200).newPrice,
  14.87);
eq("raise is capped at maxRaiseFactor x current",
  decideReprice(5.87, snap({ band: "sole", similar: 4, similar_stats: stats(4, 90) }), CFG, 200).newPrice,
  17.87);   // 5.87 * 3 = 17.61 -> round87 -> 17.87
eq("no anchor means no raise, whatever the band",
  decideReprice(5.87, snap({ band: "sole" }), CFG, 200).action, "hold");
eq("already above the raise gate holds",
  decideReprice(19.87, snap({ band: "sole", similar_stats: stats(3, 40) }), CFG, 200).action, "hold");
eq("adjacent band also raises (similar items exist, none the same)",
  decideReprice(5.87, snap({ band: "adjacent", similar: 5, similar_stats: stats(5, 11) }), CFG, 200).action,
  "raise");

// ── the lower case, and its guard rails ─────────────────────────────────────
eq("crowded and far above the median comes down TO the median",
  decideReprice(30, snap({ band: "crowded", same: 9, same_stats: stats(9, 8) }), CFG, 200).newPrice, 8.87);
eq("crowded but within the factor holds",
  decideReprice(9, snap({ band: "crowded", same: 9, same_stats: stats(9, 8) }), CFG, 200).action, "hold");
eq("lowering never goes under the floor",
  decideReprice(30, snap({ band: "crowded", same: 9, same_stats: stats(9, 2 ) }), CFG, 200).newPrice, 5.87);
eq("thin market never moves — undercutting is what created the floor",
  decideReprice(5.87, snap({ band: "thin", same: 3, same_stats: stats(3, 12) }), CFG, 200).action, "hold");

// ── gates ───────────────────────────────────────────────────────────────────
eq("age gate holds a young listing",
  decideReprice(5.87, snap({ band: "sole", similar_stats: stats(5, 20) }), { ...CFG, minAgeDays: 60 }, 10).action,
  "hold");
eq("unknown age passes the gate (mirror has no StartTime)",
  decideReprice(5.87, snap({ band: "sole", similar_stats: stats(5, 20) }), { ...CFG, minAgeDays: 60 }, null).action,
  "raise");

// ── config parsing: dryRun must be opted OUT of ─────────────────────────────
eq("dryRun defaults on for an empty config", parseRepriceConfig({}).dryRun, true);
eq("dryRun stays on for a truthy value", parseRepriceConfig({ dryRun: true }).dryRun, true);
eq("only an explicit false applies prices", parseRepriceConfig({ dryRun: false }).dryRun, false);
eq("garbage numbers fall back to the defaults",
  parseRepriceConfig({ raiseUnder: "abc", crowdedFactor: 0.2 }).raiseUnder, REPRICE_DEFAULTS.raiseUnder);
eq("crowdedFactor is floored at 1 (never lower into a median)",
  parseRepriceConfig({ crowdedFactor: 0.2 }).crowdedFactor, 1);
eq("round87", [round87(14.5), round87(8), round87(0.1)], [14.87, 8.87, 0.87]);

console.log("\n" + (n - bad) + "/" + n + " passed");
process.exit(bad ? 1 : 0);
