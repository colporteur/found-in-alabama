// Research (LIST-4): an optional, sparing deep look at one draft with the
// top-tier model + web search + the matched Expert Guides — where a business
// or publisher was, dates, makers, history, what collectors search for —
// returned as confidence-labelled findings Todd picks from. The next write
// uses the picked findings, hedging anything not confirmed.
// Pure helpers; tested in research.test.mts. The call itself lives in
// writer.ts (researchDraft) so it shares photos, guides and cost logging.

export type ResearchConfidence = "confirmed" | "likely" | "possible";

export type ResearchFinding = {
  topic: string;
  finding: string;
  confidence: ResearchConfidence;
  evidence: string;
  sources: string[];
  /** How the listing could say it (hedged unless confirmed). */
  wording: string;
  keywords: string[];
  /** Todd's pick: use it in the next write. */
  use: boolean;
};

export type Research = {
  at: string;
  model: string;
  costUsd: number;
  question: string | null;
  summary: string;
  findings: ResearchFinding[];
  keywords: string[];
  questions: string[];
  /** Todd allows LIKELY places in the title (as search words). */
  titleOk: boolean;
};

export const RESEARCH_SYSTEM = `You research one vintage or collectible item for "Found in Alabama", a reseller (the seller's location says nothing about where the item is from). The goal is a more attractive, more findable listing: who made or issued it, where (city/state) a business, publisher, school, event or photographer was, when, what it is part of, why collectors care, and the words they search with.

Use the photos, the intake facts, the expert guide(s) and WEB SEARCH. Prefer specific evidence: directories, newspaper archives, historical societies, museum and library catalogs, collector references, sold listings.

Rate every finding honestly:
- "confirmed": printed/written/pictured on the item, or stated plainly by a reliable source you found that clearly matches THIS item.
- "likely": strong circumstantial evidence (e.g. a store of that exact name operated in one city in the right era).
- "possible": a clue only (several candidates, a partial match).
Never upgrade a guess. If you found nothing useful about something, say so in the summary rather than inventing.

For each finding give "wording": a sentence the listing description could use — plain for confirmed; hedged for likely/possible ("likely from…", "appears to be…", "attributed to…", "possibly…").

Return ONLY this JSON object:
{
  "summary": "two or three sentences: what you found and what stays unknown",
  "findings": [
    { "topic": "place | maker | date | history | collector interest | other", "finding": "", "confidence": "confirmed|likely|possible", "evidence": "what supports it", "sources": ["https://…"], "wording": "", "keywords": [""] }
  ],
  "keywords": ["search words buyers would use, places included only if at least likely"],
  "questions": ["things only Todd can check on the physical item (back, stamps, marks)"]
}`;

const CONF = new Set<ResearchConfidence>(["confirmed", "likely", "possible"]);
const strs = (v: unknown, max: number, len = 200) =>
  (Array.isArray(v) ? v : [])
    .map((x) => String(x ?? "").trim().slice(0, len))
    .filter(Boolean)
    .slice(0, max);

function jsonBlock(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseResearch(text: string): Omit<Research, "at" | "model" | "costUsd" | "question" | "titleOk"> | null {
  const j = jsonBlock(text) as Record<string, unknown> | null;
  if (!j || typeof j !== "object") return null;
  const findings = (Array.isArray(j.findings) ? j.findings : [])
    .map((raw) => {
      const f = (raw ?? {}) as Record<string, unknown>;
      const conf = String(f.confidence ?? "").toLowerCase() as ResearchConfidence;
      const finding = String(f.finding ?? "").trim().slice(0, 600);
      if (!finding || !CONF.has(conf)) return null;
      return {
        topic: String(f.topic ?? "other").trim().slice(0, 40) || "other",
        finding,
        confidence: conf,
        evidence: String(f.evidence ?? "").trim().slice(0, 600),
        sources: strs(f.sources, 5, 400).filter((u) => /^https?:\/\//i.test(u)),
        wording: String(f.wording ?? "").trim().slice(0, 400),
        keywords: strs(f.keywords, 8, 60),
        use: conf !== "possible",
      } satisfies ResearchFinding;
    })
    .filter((f): f is ResearchFinding => f !== null)
    .slice(0, 12);
  return {
    summary: String(j.summary ?? "").trim().slice(0, 800),
    findings,
    keywords: strs(j.keywords, 15, 60),
    questions: strs(j.questions, 6, 300),
  };
}

/** The research block the writer sees (picked findings only). */
export function researchPromptText(r: Research | null | undefined): string {
  if (!r) return "";
  const used = r.findings.filter((f) => f.use);
  if (!used.length) return "";
  const lines = used.map(
    (f) => `- [${f.confidence.toUpperCase()}] ${f.finding}${f.wording ? ` — suggested wording: "${f.wording}"` : ""}${f.keywords.length ? ` (keywords: ${f.keywords.join(", ")})` : ""}`
  );
  return [
    "RESEARCH NOTES (picked by Todd from a web-research pass; each is labelled):",
    ...lines,
    "How to use them:",
    "- CONFIRMED: state it plainly anywhere (title, description, specifics, store shelf).",
    "- LIKELY / POSSIBLE: description only, always hedged (\"likely\", \"appears to be\", \"attributed to\", \"possibly\"); never in item specifics or the place shelf.",
    r.titleOk
      ? "- Todd allows a LIKELY place as a search word in the title (not POSSIBLE ones)."
      : "- Keep LIKELY / POSSIBLE places out of the title.",
  ].join("\n");
}
