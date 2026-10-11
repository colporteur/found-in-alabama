import assert from "node:assert/strict";
import { sweepCovers } from "./listed-sweep.ts";
assert.equal(sweepCovers(12256, 12256, true), true);
assert.equal(sweepCovers(12100, 12256, true), true); // 98.7%
assert.equal(sweepCovers(11000, 12256, true), false);
assert.equal(sweepCovers(12256, 12256, false), false); // stopped early
assert.equal(sweepCovers(10, null, true), false);
console.log("listed-sweep: ok");
