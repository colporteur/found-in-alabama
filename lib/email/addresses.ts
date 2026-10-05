// Server-side address management for /admin/mail/addresses (Phase MAIL-1).
// The DB row is the source of truth for what Todd wants; every change is
// pushed to Cloudflare Email Routing immediately, and the outcome is
// recorded on the row (sync_status / sync_error) so a failed push shows up
// on the page with a Retry button instead of disappearing.

import { resolveMx } from "node:dns/promises";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailAddresses } from "@/db/schema";
import {
  CloudflareError,
  cloudflareConfigured,
  createDestination,
  createRule,
  deleteRule,
  getCatchAll,
  getRoutingSettings,
  getZone,
  listDestinations,
  listRules,
  ruleId,
  updateRule,
  type CfDestination,
} from "./cloudflare";
import {
  DEFAULT_INBOX_WORKER,
  buildRule,
  classifyRule,
  emailDomains,
  splitAddress,
  type AddressInput,
  type AddressMode,
} from "./rules";

export type EmailAddressRow = typeof emailAddresses.$inferSelect;

export function configuredDomains(): string[] {
  return emailDomains(process.env.EMAIL_DOMAINS);
}

export function inboxWorkerName(): string {
  return process.env.EMAIL_INBOX_WORKER?.trim() || DEFAULT_INBOX_WORKER;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function listAddresses(): Promise<EmailAddressRow[]> {
  return db
    .select()
    .from(emailAddresses)
    .orderBy(asc(emailAddresses.domain), asc(emailAddresses.address));
}

export async function getAddressByEmail(address: string): Promise<EmailAddressRow | null> {
  const [row] = await db
    .select()
    .from(emailAddresses)
    .where(eq(emailAddresses.address, address.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

// ─── Forward destinations ────────────────────────────────────────────────────

export type DestinationStatus = { email: string; verified: boolean; exists: boolean };

/**
 * Make sure a forward-to address is a Cloudflare destination. New ones get
 * Cloudflare's verification email; forwarding starts once Todd clicks it.
 */
export async function ensureDestination(
  domain: string,
  email: string
): Promise<DestinationStatus> {
  const zone = await getZone(domain);
  const all = await listDestinations(zone.account.id);
  const found = all.find((d) => d.email.toLowerCase() === email.toLowerCase());
  if (found) return { email, verified: !!found.verified, exists: true };
  await createDestination(zone.account.id, email);
  return { email, verified: false, exists: true };
}

/** Destination list keyed by lowercase email (one account covers both zones). */
export async function destinationMap(): Promise<Map<string, CfDestination>> {
  const map = new Map<string, CfDestination>();
  if (!cloudflareConfigured()) return map;
  const zone = await getZone(configuredDomains()[0]);
  for (const d of await listDestinations(zone.account.id)) {
    map.set(d.email.toLowerCase(), d);
  }
  return map;
}

// ─── Push one row to Cloudflare ─────────────────────────────────────────────

async function pushRule(row: EmailAddressRow): Promise<EmailAddressRow> {
  let cfRuleId = row.cfRuleId;
  try {
    const zone = await getZone(row.domain);
    const body = buildRule(
      {
        address: row.address,
        mode: row.mode as AddressMode,
        forwardTo: row.forwardTo,
        enabled: row.enabled,
      },
      inboxWorkerName()
    );
    if (cfRuleId) {
      try {
        await updateRule(zone.id, cfRuleId, body);
      } catch (err) {
        // Rule deleted in the Cloudflare dashboard → recreate it.
        if (err instanceof CloudflareError && err.status === 404) {
          cfRuleId = ruleId(await createRule(zone.id, body));
        } else throw err;
      }
    } else {
      cfRuleId = ruleId(await createRule(zone.id, body));
    }
    const [updated] = await db
      .update(emailAddresses)
      .set({
        cfRuleId,
        syncStatus: "ok",
        syncError: null,
        syncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailAddresses.id, row.id))
      .returning();
    return updated;
  } catch (err) {
    const [updated] = await db
      .update(emailAddresses)
      .set({ cfRuleId, syncStatus: "error", syncError: errMsg(err), updatedAt: new Date() })
      .where(eq(emailAddresses.id, row.id))
      .returning();
    return updated;
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export type SaveResult =
  | { ok: true; row: EmailAddressRow; destination: DestinationStatus | null }
  | { ok: false; error: string; status: number };

export async function createAddress(input: AddressInput): Promise<SaveResult> {
  if (await getAddressByEmail(input.address)) {
    return { ok: false, error: `${input.address} already exists.`, status: 409 };
  }
  let destination: DestinationStatus | null = null;
  if (input.forwardTo && cloudflareConfigured()) {
    try {
      destination = await ensureDestination(input.domain, input.forwardTo);
    } catch (err) {
      return { ok: false, error: `Couldn't add forward-to address: ${errMsg(err)}`, status: 502 };
    }
  }
  const [row] = await db
    .insert(emailAddresses)
    .values({
      address: input.address,
      localPart: input.localPart,
      domain: input.domain,
      mode: input.mode,
      forwardTo: input.forwardTo,
      label: input.label,
      enabled: true,
    })
    .returning();
  return { ok: true, row: await pushRule(row), destination };
}

export async function updateAddress(
  id: string,
  patch: {
    mode?: AddressMode;
    forwardTo?: string | null;
    label?: string | null;
    enabled?: boolean;
  }
): Promise<SaveResult> {
  const [current] = await db
    .select()
    .from(emailAddresses)
    .where(eq(emailAddresses.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Address not found.", status: 404 };

  const mode = patch.mode ?? (current.mode as AddressMode);
  const forwardTo =
    mode === "inbox" ? null : patch.forwardTo !== undefined ? patch.forwardTo : current.forwardTo;
  if (mode !== "inbox" && !forwardTo) {
    return { ok: false, error: "Forwarding needs a forward-to address.", status: 400 };
  }
  if (forwardTo === current.address) {
    return { ok: false, error: "An address can't forward to itself.", status: 400 };
  }

  let destination: DestinationStatus | null = null;
  if (forwardTo && forwardTo !== current.forwardTo && cloudflareConfigured()) {
    try {
      destination = await ensureDestination(current.domain, forwardTo);
    } catch (err) {
      return { ok: false, error: `Couldn't add forward-to address: ${errMsg(err)}`, status: 502 };
    }
  }

  const enabled = patch.enabled ?? current.enabled;
  // Label-only edits don't change routing — skip the Cloudflare round trip.
  const routingChanged =
    mode !== current.mode ||
    forwardTo !== current.forwardTo ||
    enabled !== current.enabled ||
    current.syncStatus !== "ok";

  const [row] = await db
    .update(emailAddresses)
    .set({
      mode,
      forwardTo,
      enabled,
      label: patch.label !== undefined ? patch.label : current.label,
      ...(routingChanged ? { syncStatus: "pending" as const } : {}),
      updatedAt: new Date(),
    })
    .where(eq(emailAddresses.id, id))
    .returning();

  if (!routingChanged) return { ok: true, row, destination };
  return { ok: true, row: await pushRule(row), destination };
}

export async function resyncAddress(id: string): Promise<SaveResult> {
  const [row] = await db.select().from(emailAddresses).where(eq(emailAddresses.id, id)).limit(1);
  if (!row) return { ok: false, error: "Address not found.", status: 404 };
  return { ok: true, row: await pushRule(row), destination: null };
}

/**
 * Remove an address: delete its Cloudflare rule, then the row. Received
 * messages stay in the inbox (address_id → null, to_address kept).
 */
export async function removeAddress(
  id: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const [row] = await db.select().from(emailAddresses).where(eq(emailAddresses.id, id)).limit(1);
  if (!row) return { ok: false, error: "Address not found.", status: 404 };
  if (row.cfRuleId) {
    try {
      const zone = await getZone(row.domain);
      await deleteRule(zone.id, row.cfRuleId);
    } catch (err) {
      if (!(err instanceof CloudflareError && err.status === 404)) {
        return {
          ok: false,
          error: `Cloudflare wouldn't delete the rule, so the address was kept: ${errMsg(err)}`,
          status: 502,
        };
      }
    }
  }
  await db.delete(emailAddresses).where(eq(emailAddresses.id, id));
  return { ok: true };
}

// ─── Import existing Cloudflare rules ───────────────────────────────────────

export type ImportResult = {
  imported: string[];
  linked: string[];
  skipped: { domain: string; rule: string; reason: string }[];
  errors: string[];
};

/**
 * Adopt address rules that already exist in Cloudflare (e.g. ones made in
 * the dashboard on theephemeralstate.com) so the page shows every address.
 * Never changes or deletes anything in Cloudflare.
 */
export async function importFromCloudflare(): Promise<ImportResult> {
  const result: ImportResult = { imported: [], linked: [], skipped: [], errors: [] };
  const existing = new Map((await listAddresses()).map((r) => [r.address, r]));
  for (const domain of configuredDomains()) {
    try {
      const zone = await getZone(domain);
      for (const rule of await listRules(zone.id)) {
        const c = classifyRule(rule, inboxWorkerName());
        const label = rule.name || ruleId(rule);
        if (!c.ok) {
          result.skipped.push({ domain, rule: label, reason: c.reason });
          continue;
        }
        const parts = splitAddress(c.address);
        if (!parts || parts.domain !== domain) {
          result.skipped.push({ domain, rule: label, reason: "address outside this domain" });
          continue;
        }
        const id = ruleId(rule);
        const row = existing.get(c.address);
        if (row) {
          if (row.cfRuleId !== id) {
            await db
              .update(emailAddresses)
              .set({ cfRuleId: id, syncStatus: "ok", syncError: null, syncedAt: new Date() })
              .where(eq(emailAddresses.id, row.id));
            result.linked.push(c.address);
          }
          continue;
        }
        await db.insert(emailAddresses).values({
          address: c.address,
          localPart: parts.localPart,
          domain,
          mode: c.mode,
          forwardTo: c.forwardTo,
          enabled: c.enabled,
          label: "Imported from Cloudflare",
          cfRuleId: id,
          syncStatus: "ok",
          syncedAt: new Date(),
        });
        result.imported.push(c.address);
      }
    } catch (err) {
      result.errors.push(`${domain}: ${errMsg(err)}`);
    }
  }
  return result;
}

// ─── Domain status ──────────────────────────────────────────────────────────

/**
 * Email Routing on/off. The settings endpoint needs a permission the
 * address-management token doesn't otherwise need (Cloudflare answers
 * "Authentication error (10000)" without it), so fall back to the MX
 * records: routing is on when the domain's MX points at Cloudflare.
 */
async function routingSettingsOrMx(
  zoneId: string,
  domain: string
): Promise<{ enabled: boolean; status?: string }> {
  try {
    return await getRoutingSettings(zoneId);
  } catch {
    try {
      const mx = await resolveMx(domain);
      const onCloudflare = mx.some((r) => r.exchange.toLowerCase().endsWith("mx.cloudflare.net"));
      return { enabled: onCloudflare, status: onCloudflare ? "MX → Cloudflare" : "no Cloudflare MX" };
    } catch {
      return { enabled: false, status: "no MX records" };
    }
  }
}

export type DomainStatus = {
  domain: string;
  ok: boolean;
  routingEnabled: boolean;
  routingStatus: string | null;
  catchAll: string | null;
  error: string | null;
};

export async function domainStatuses(): Promise<DomainStatus[]> {
  const domains = configuredDomains();
  if (!cloudflareConfigured()) {
    return domains.map((domain) => ({
      domain,
      ok: false,
      routingEnabled: false,
      routingStatus: null,
      catchAll: null,
      error: "CLOUDFLARE_API_TOKEN is not set.",
    }));
  }
  return Promise.all(
    domains.map(async (domain): Promise<DomainStatus> => {
      try {
        const zone = await getZone(domain);
        const [settings, catchAll] = await Promise.all([
          routingSettingsOrMx(zone.id, domain),
          getCatchAll(zone.id),
        ]);
        let catchAllText: string | null = null;
        if (catchAll && catchAll.enabled) {
          const a = catchAll.actions?.[0];
          catchAllText =
            a?.type === "forward"
              ? `forwards to ${a.value?.join(", ")}`
              : a?.type === "worker"
                ? `goes to worker ${a.value?.[0]}`
                : a?.type === "drop"
                  ? "drops mail"
                  : (a?.type ?? null);
        }
        return {
          domain,
          ok: !!settings.enabled,
          routingEnabled: !!settings.enabled,
          routingStatus: settings.status ?? null,
          catchAll: catchAllText,
          error: null,
        };
      } catch (err) {
        return {
          domain,
          ok: false,
          routingEnabled: false,
          routingStatus: null,
          catchAll: null,
          error: errMsg(err),
        };
      }
    })
  );
}
