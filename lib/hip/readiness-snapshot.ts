import type { HipReadinessListing, HipSnapshot } from "./readiness";

function object(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const isTrue = (v: unknown) => v === true || v === 1 || v === "1";

function listingUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value, "https://www.hippostcard.com");
    if (url.protocol === "https:" && ["www.hippostcard.com", "hippostcard.com"].includes(url.hostname)) return url.toString();
  } catch { /* Leave unrecognized links out of the report. */ }
  return undefined;
}

export function parseHipReadinessPage(raw: unknown): HipReadinessListing[] {
  if (!object(raw) || !Array.isArray(raw.results)) throw new Error("Unexpected Hip listing response.");
  return raw.results.map((entry) => {
    if (!object(entry) || !Number.isSafeInteger(Number(entry.id)) || Number(entry.id) <= 0 || typeof entry.name !== "string") {
      throw new Error("Unexpected Hip listing record.");
    }
    if (isTrue(entry.closed) || isTrue(entry.deleted) || isTrue(entry.draft)) throw new Error("Hip returned a non-active listing in its active inventory.");
    const type = typeof entry.external_id_type === "string" ? entry.external_id_type.toLowerCase() : "";
    const external = typeof entry.external_id === "string" || typeof entry.external_id === "number" ? String(entry.external_id) : "";
    return {
      id: Number(entry.id), name: entry.name,
      externalId: (!type || type.includes("ebay")) && /^\d+$/.test(external) && external !== "0" ? external : null,
      privateId: typeof entry.private_id === "string" ? entry.private_id : null,
      url: listingUrl(entry.url),
    };
  });
}

/** Only GETs. Never calls the existing map refresh or sales jobs (both mutate). */
export async function collectHipReadinessSnapshot(
  fetchPage: (page: number) => Promise<unknown>,
  options: { maxPages?: number; budgetMs?: number; pause?: () => Promise<void> } = {},
): Promise<HipSnapshot> {
  const started = Date.now();
  const snapshot: HipSnapshot = { state: "partial", listings: [], pages: 0, checkedAt: null, message: "The comparison did not finish; missing items are not confirmed." };
  const seen = new Set<number>();
  const pause = options.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 120)));
  try {
    for (let page = 1; page <= (options.maxPages ?? 200); page++) {
      if (Date.now() - started > (options.budgetMs ?? 35_000)) break;
      if (page > 1) await pause();
      const rows = parseHipReadinessPage(await fetchPage(page));
      snapshot.pages++;
      if (!rows.length) {
        snapshot.state = "complete";
        snapshot.message = "All active Hip listing pages were read. Results reflect this scan; availability still needs checking before publication.";
        break;
      }
      // Walk to an empty page, even if Hip applies a smaller page size.
      for (const row of rows) {
        if (seen.has(row.id)) throw new Error("Hip inventory changed during pagination.");
        seen.add(row.id);
        snapshot.listings.push(row);
      }
    }
  } catch {
    snapshot.state = snapshot.listings.length ? "partial" : "error";
    snapshot.message = "Hip comparison could not finish. Check the connection and try again. No missing listings have been confirmed.";
  }
  snapshot.checkedAt = new Date().toISOString();
  return snapshot;
}
