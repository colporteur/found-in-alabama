// Run: npx tsx --test lib/listings/research.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { parseResearch, researchPromptText, type Research } from "./research";

const REPLY = "```json\n" + JSON.stringify({
  summary: "One store of that name found.",
  findings: [
    { topic: "place", finding: "A Sample's Department Store operated in Springfield, IL in the 1940s.", confidence: "likely", evidence: "city directory", sources: ["https://example.org/dir", "not a url"], wording: "likely from Sample's of Springfield, Illinois", keywords: ["Springfield"] },
    { topic: "date", finding: "1940s", confidence: "possible", evidence: "type style", sources: [], wording: "possibly 1940s" },
    { topic: "x", finding: "bad", confidence: "certain" },
  ],
  keywords: ["Sample's", "department store"],
  questions: ["Any stamp on the back?"],
}) + "\n```";

test("parseResearch keeps valid findings and pre-picks confirmed/likely", () => {
  const r = parseResearch(REPLY)!;
  assert.equal(r.findings.length, 2);
  assert.deepEqual(r.findings[0].sources, ["https://example.org/dir"]);
  assert.equal(r.findings[0].use, true);
  assert.equal(r.findings[1].use, false);
  assert.equal(r.questions.length, 1);
  assert.equal(parseResearch("no json here"), null);
});

test("researchPromptText includes only picked findings and the title rule", () => {
  const base = parseResearch(REPLY)!;
  const r: Research = { ...base, at: "", model: "m", costUsd: 0, question: null, titleOk: false };
  const t = researchPromptText(r);
  assert.match(t, /\[LIKELY\] A Sample's/);
  assert.doesNotMatch(t, /possibly 1940s/);
  assert.match(t, /out of the title/);
  assert.match(researchPromptText({ ...r, titleOk: true }), /allows a LIKELY place/);
  assert.equal(researchPromptText({ ...r, findings: r.findings.map((f) => ({ ...f, use: false })) }), "");
});
