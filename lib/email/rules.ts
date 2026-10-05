// Pure helpers for the Mail admin (Phase MAIL-1): address validation,
// Cloudflare Email Routing rule shapes, and the inbound delivery decision.
// No imports — scripts/email-rules.test.cjs loads this file in a vm.
//
// Delivery modes:
//   inbox   — Cloudflare rule → Email Worker → site inbox (/admin/mail)
//   forward — native Cloudflare forward rule → forwardTo
//   both    — Email Worker; site keeps a copy AND the worker forwards

export type AddressMode = "inbox" | "forward" | "both";
export const ADDRESS_MODES: AddressMode[] = ["inbox", "forward", "both"];

export const DEFAULT_EMAIL_DOMAINS = [
  "foundinalabama.com",
  "theephemeralstate.com",
];

/** Name of the Cloudflare Email Worker that posts mail to the site. */
export const DEFAULT_INBOX_WORKER = "fia-inbox";

/** Prefix on rule names this app creates, so Cloudflare's list shows them. */
export const RULE_NAME_PREFIX = "FiA admin: ";

export function emailDomains(envValue?: string | null): string[] {
  const list = (envValue ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : DEFAULT_EMAIL_DOMAINS;
}

/**
 * Lowercase + trim a local part ("Orders" → "orders"). Allows letters,
 * digits, dot, underscore, plus and hyphen; no leading/trailing or doubled
 * dots; 1–64 chars. Returns null when it isn't usable.
 */
export function normalizeLocalPart(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (s.length < 1 || s.length > 64) return null;
  if (!/^[a-z0-9._+-]+$/.test(s)) return null;
  if (s.startsWith(".") || s.endsWith(".") || s.includes("..")) return null;
  return s;
}

export function isValidEmail(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const s = input.trim();
  if (s.length > 254) return false;
  return /^[^\s@<>()",;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s);
}

export function isAddressMode(v: unknown): v is AddressMode {
  return typeof v === "string" && (ADDRESS_MODES as string[]).includes(v);
}

export type AddressInput = {
  localPart: string;
  domain: string;
  address: string;
  mode: AddressMode;
  forwardTo: string | null;
  label: string | null;
};

/** Validate the "new address" form. */
export function validateAddressInput(
  raw: {
    localPart?: unknown;
    domain?: unknown;
    mode?: unknown;
    forwardTo?: unknown;
    label?: unknown;
  },
  domains: string[]
): { ok: true; value: AddressInput } | { ok: false; error: string } {
  const localPart = normalizeLocalPart(raw.localPart);
  if (!localPart) {
    return {
      ok: false,
      error:
        "The part before the @ can use letters, numbers, dots, hyphens, underscores and +.",
    };
  }
  const domain = typeof raw.domain === "string" ? raw.domain.trim().toLowerCase() : "";
  if (!domains.includes(domain)) {
    return { ok: false, error: `Pick one of: ${domains.join(", ")}.` };
  }
  const settings = validateDeliverySettings(raw);
  if (!settings.ok) return settings;
  const address = `${localPart}@${domain}`;
  if (settings.value.forwardTo === address) {
    return { ok: false, error: "An address can't forward to itself." };
  }
  return {
    ok: true,
    value: { localPart, domain, address, ...settings.value },
  };
}

/** Validate mode / forward-to / label (used by create and edit). */
export function validateDeliverySettings(raw: {
  mode?: unknown;
  forwardTo?: unknown;
  label?: unknown;
}):
  | { ok: true; value: { mode: AddressMode; forwardTo: string | null; label: string | null } }
  | { ok: false; error: string } {
  const mode = raw.mode === undefined ? "inbox" : raw.mode;
  if (!isAddressMode(mode)) {
    return { ok: false, error: "Delivery must be inbox, forward, or both." };
  }
  let forwardTo: string | null = null;
  if (mode !== "inbox") {
    if (!isValidEmail(raw.forwardTo)) {
      return { ok: false, error: "Enter a valid forward-to address." };
    }
    forwardTo = String(raw.forwardTo).trim().toLowerCase();
  }
  const label =
    typeof raw.label === "string" && raw.label.trim()
      ? raw.label.trim().slice(0, 120)
      : null;
  return { ok: true, value: { mode, forwardTo, label } };
}

export type CfMatcher = { type: string; field?: string; value?: string };
export type CfAction = { type: string; value?: string[] };
export type CfRuleBody = {
  name: string;
  enabled: boolean;
  matchers: CfMatcher[];
  actions: CfAction[];
};

/** Cloudflare Email Routing rule for one address. */
export function buildRule(
  addr: { address: string; mode: AddressMode; forwardTo: string | null; enabled: boolean },
  workerName: string = DEFAULT_INBOX_WORKER
): CfRuleBody {
  const action: CfAction =
    addr.mode === "forward"
      ? { type: "forward", value: [addr.forwardTo ?? ""] }
      : { type: "worker", value: [workerName] };
  return {
    name: `${RULE_NAME_PREFIX}${addr.address}`,
    enabled: addr.enabled,
    matchers: [{ type: "literal", field: "to", value: addr.address }],
    actions: [action],
  };
}

/**
 * Read an existing Cloudflare rule back into an address, for "Import from
 * Cloudflare". Only single-recipient literal rules that forward or go to
 * our worker are importable; a worker rule imports as "inbox" (the site
 * can't tell inbox from both — both is a site-side setting).
 */
export function classifyRule(
  rule: { enabled?: boolean; matchers?: CfMatcher[]; actions?: CfAction[] },
  workerName: string = DEFAULT_INBOX_WORKER
):
  | { ok: true; address: string; mode: AddressMode; forwardTo: string | null; enabled: boolean }
  | { ok: false; reason: string } {
  const m = rule.matchers ?? [];
  if (m.length !== 1 || m[0].type !== "literal" || m[0].field !== "to" || !m[0].value) {
    return { ok: false, reason: "not a single-address rule" };
  }
  const address = m[0].value.trim().toLowerCase();
  const a = rule.actions ?? [];
  if (a.length !== 1) return { ok: false, reason: "multiple actions" };
  const enabled = rule.enabled !== false;
  if (a[0].type === "forward" && a[0].value?.length === 1 && isValidEmail(a[0].value[0])) {
    return { ok: true, address, mode: "forward", forwardTo: a[0].value[0].toLowerCase(), enabled };
  }
  if (a[0].type === "worker" && a[0].value?.[0] === workerName) {
    return { ok: true, address, mode: "inbox", forwardTo: null, enabled };
  }
  if (a[0].type === "drop") return { ok: false, reason: "drop rule" };
  if (a[0].type === "worker") return { ok: false, reason: `goes to a different worker (${a[0].value?.[0] ?? "?"})` };
  return { ok: false, reason: `unsupported action (${a[0].type})` };
}

/** Split "name@domain" → parts, or null. */
export function splitAddress(address: string): { localPart: string; domain: string } | null {
  const at = address.lastIndexOf("@");
  if (at <= 0) return null;
  const localPart = normalizeLocalPart(address.slice(0, at));
  const domain = address.slice(at + 1).trim().toLowerCase();
  if (!localPart || !domain) return null;
  return { localPart, domain };
}

/**
 * What the worker should do with a message the site just received.
 * Unknown recipients (e.g. a catch-all pointed at the worker) are stored
 * so nothing is lost.
 */
export function inboundDecision(
  addr: { mode: AddressMode; forwardTo: string | null; enabled: boolean } | null
): { store: boolean; forwardTo: string | null } {
  if (!addr) return { store: true, forwardTo: null };
  if (addr.mode === "inbox") return { store: true, forwardTo: null };
  if (addr.mode === "both") return { store: true, forwardTo: addr.forwardTo };
  // forward-mode mail normally never reaches the worker (native rule);
  // if it does (rule mid-update), just pass it along.
  return { store: false, forwardTo: addr.forwardTo };
}

/** Human-readable delivery description for the UI. */
export function describeDelivery(mode: AddressMode, forwardTo: string | null): string {
  if (mode === "inbox") return "Site inbox";
  if (mode === "forward") return `Forwards to ${forwardTo ?? "?"}`;
  return `Site inbox + forwards to ${forwardTo ?? "?"}`;
}
