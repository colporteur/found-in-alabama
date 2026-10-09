// eBay item specifics ("aspects") — pure helpers, tested in aspects.test.mts.
//   parseAspects()      Taxonomy API response → compact list
//   aspectPromptText()  the list as the writer sees it
//   fitSpecifics()      keep only names/values the category accepts

export type CategoryAspect = {
  name: string;
  required: boolean;
  /** RECOMMENDED | OPTIONAL */
  usage: string;
  /** FREE_TEXT | SELECTION_ONLY */
  mode: string;
  multi: boolean;
  maxLength: number | null;
  values: string[];
};

type RawAspect = {
  localizedAspectName?: string;
  aspectConstraint?: {
    aspectRequired?: boolean;
    aspectUsage?: string;
    aspectMode?: string;
    itemToAspectCardinality?: string;
    aspectMaxLength?: number;
  };
  aspectValues?: Array<{ localizedValue?: string }>;
};

export function parseAspects(json: unknown): CategoryAspect[] {
  const list = ((json as { aspects?: RawAspect[] })?.aspects ?? []) as RawAspect[];
  return list
    .filter((a) => a.localizedAspectName)
    .map((a) => ({
      name: String(a.localizedAspectName),
      required: a.aspectConstraint?.aspectRequired === true,
      usage: a.aspectConstraint?.aspectUsage ?? "OPTIONAL",
      mode: a.aspectConstraint?.aspectMode ?? "FREE_TEXT",
      multi: a.aspectConstraint?.itemToAspectCardinality === "MULTI",
      maxLength: a.aspectConstraint?.aspectMaxLength ?? null,
      values: (a.aspectValues ?? []).map((v) => String(v.localizedValue ?? "")).filter(Boolean).slice(0, 400),
    }));
}

/** Required + recommended aspects in full, then up to `optional` optional
 *  ones; allowed values capped per aspect so the prompt stays small. */
export function aspectPromptText(aspects: CategoryAspect[], optional = 12, valuesShown = 40): string {
  const req = aspects.filter((a) => a.required);
  const rec = aspects.filter((a) => !a.required && a.usage === "RECOMMENDED");
  const opt = aspects.filter((a) => !a.required && a.usage !== "RECOMMENDED").slice(0, optional);
  const line = (a: CategoryAspect) => {
    const tags = [a.required ? "REQUIRED" : a.usage === "RECOMMENDED" ? "recommended" : "optional", a.multi ? "several values ok" : "one value"];
    const vals = a.values.length
      ? a.mode === "SELECTION_ONLY"
        ? ` — choose from: ${a.values.slice(0, valuesShown).join(" | ")}${a.values.length > valuesShown ? " | …" : ""}`
        : ` — e.g. ${a.values.slice(0, 12).join(" | ")} (free text allowed)`
      : " — free text";
    return `- ${a.name} (${tags.join(", ")})${vals}`;
  };
  return [...req, ...rec, ...opt].map(line).join("\n");
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** Keep only aspects the category has, values it allows (pick-list aspects
 *  matched case-insensitively to eBay's spelling), one value where only
 *  one is allowed. Returns what was dropped so it can be flagged. */
export function fitSpecifics(
  specifics: Record<string, string | string[]>,
  aspects: CategoryAspect[]
): { kept: Record<string, string | string[]>; dropped: string[]; missingRequired: string[] } {
  const byName = new Map(aspects.map((a) => [norm(a.name), a]));
  const kept: Record<string, string | string[]> = {};
  const dropped: string[] = [];
  for (const [k, raw] of Object.entries(specifics)) {
    const a = byName.get(norm(k));
    if (!a) {
      dropped.push(`${k} (not a field in this eBay category)`);
      continue;
    }
    const vals = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v).trim()).filter(Boolean);
    const out: string[] = [];
    for (const v of vals) {
      if (a.mode === "SELECTION_ONLY" && a.values.length) {
        const hit = a.values.find((x) => norm(x) === norm(v));
        if (hit) out.push(hit);
        else dropped.push(`${a.name}: "${v}" (not one of eBay's values)`);
      } else {
        out.push(a.maxLength ? v.slice(0, a.maxLength) : v.slice(0, 65));
      }
    }
    if (!out.length) continue;
    kept[a.name] = a.multi ? Array.from(new Set(out)).slice(0, 30) : out[0];
  }
  const missingRequired = aspects.filter((a) => a.required && !(a.name in kept)).map((a) => a.name);
  return { kept, dropped, missingRequired };
}
