// Business identity shared by both storefronts — the facts Google Merchant
// Center checks for (who sells, how to reach them, where orders ship from).
// Keep the policy pages, footers, and Organization JSON-LD on these values
// so every surface tells the same story.

export const BUSINESS = {
  owner: "Todd",
  shipsFrom: "Lineville, Alabama",
  region: "AL",
  country: "US",
  phone: "256-684-1253",
  phoneE164: "+12566841253",
  /** Usual handling: orders packed and shipped within this many business days. */
  handlingDays: { min: 1, max: 3 },
  returnDays: 30,
} as const;

export const TES_EMAIL = "todd@theephemeralstate.com";
export const FIA_EMAIL = "todd@foundinalabama.com";
