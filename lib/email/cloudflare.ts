// Minimal Cloudflare Email Routing API client (Phase MAIL-1).
//
// Env:
//   CLOUDFLARE_API_TOKEN — API token with:
//     Zone · Zone · Read
//     Zone · Email Routing Rules · Edit
//     Account · Email Routing Addresses · Edit
//   scoped to foundinalabama.com + theephemeralstate.com (and the account).
//
// Zone and account ids are looked up by domain name, so no other ids are
// needed in env.

import type { CfAction, CfMatcher, CfRuleBody } from "./rules";

const API = "https://api.cloudflare.com/client/v4";

export class CloudflareError extends Error {
  constructor(
    message: string,
    public status: number,
    public codes: number[] = []
  ) {
    super(message);
    this.name = "CloudflareError";
  }
}

export function cloudflareConfigured(): boolean {
  return !!process.env.CLOUDFLARE_API_TOKEN;
}

type Envelope<T> = {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
  result_info?: { page: number; per_page: number; count: number; total_count: number };
};

async function cf<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new CloudflareError("CLOUDFLARE_API_TOKEN is not set in Vercel.", 0);
  }
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body?.success) {
    const errs = body?.errors ?? [];
    throw new CloudflareError(
      errs.map((e) => `${e.message} (${e.code})`).join("; ") ||
        `Cloudflare HTTP ${res.status}`,
      res.status,
      errs.map((e) => e.code)
    );
  }
  return body;
}

export type CfZone = { id: string; name: string; account: { id: string; name?: string } };

const zoneCache = new Map<string, CfZone>();

export async function getZone(domain: string): Promise<CfZone> {
  const hit = zoneCache.get(domain);
  if (hit) return hit;
  const { result } = await cf<CfZone[]>(`/zones?name=${encodeURIComponent(domain)}`);
  const zone = result[0];
  if (!zone) {
    throw new CloudflareError(
      `Zone ${domain} not found — is it on this Cloudflare account, and does the token include it?`,
      404
    );
  }
  zoneCache.set(domain, zone);
  return zone;
}

export type CfRoutingSettings = {
  enabled: boolean;
  status?: string; // "ready" | "unconfigured" | "misconfigured" | …
  name?: string;
};

export async function getRoutingSettings(zoneId: string): Promise<CfRoutingSettings> {
  return (await cf<CfRoutingSettings>(`/zones/${zoneId}/email/routing`)).result;
}

export type CfRule = {
  id?: string;
  tag?: string;
  name?: string;
  enabled?: boolean;
  priority?: number;
  matchers: CfMatcher[];
  actions: CfAction[];
};

export function ruleId(rule: CfRule): string {
  return rule.id ?? rule.tag ?? "";
}

export async function listRules(zoneId: string): Promise<CfRule[]> {
  const out: CfRule[] = [];
  for (let page = 1; page <= 20; page++) {
    const body = await cf<CfRule[]>(
      `/zones/${zoneId}/email/routing/rules?per_page=50&page=${page}`
    );
    out.push(...body.result);
    const info = body.result_info;
    if (!info || body.result.length < 50 || out.length >= info.total_count) break;
  }
  return out;
}

export async function getCatchAll(zoneId: string): Promise<CfRule | null> {
  try {
    return (await cf<CfRule>(`/zones/${zoneId}/email/routing/rules/catch_all`)).result;
  } catch {
    return null;
  }
}

export async function createRule(zoneId: string, rule: CfRuleBody): Promise<CfRule> {
  return (
    await cf<CfRule>(`/zones/${zoneId}/email/routing/rules`, {
      method: "POST",
      body: JSON.stringify(rule),
    })
  ).result;
}

export async function updateRule(
  zoneId: string,
  id: string,
  rule: CfRuleBody
): Promise<CfRule> {
  return (
    await cf<CfRule>(`/zones/${zoneId}/email/routing/rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(rule),
    })
  ).result;
}

export async function deleteRule(zoneId: string, id: string): Promise<void> {
  await cf<unknown>(`/zones/${zoneId}/email/routing/rules/${id}`, { method: "DELETE" });
}

export type CfDestination = {
  id?: string;
  tag?: string;
  email: string;
  verified: string | null; // ISO timestamp once the owner clicks the link
  created?: string;
};

export async function listDestinations(accountId: string): Promise<CfDestination[]> {
  const out: CfDestination[] = [];
  for (let page = 1; page <= 10; page++) {
    const body = await cf<CfDestination[]>(
      `/accounts/${accountId}/email/routing/addresses?per_page=50&page=${page}`
    );
    out.push(...body.result);
    if (body.result.length < 50) break;
  }
  return out;
}

/** Adds a destination; Cloudflare emails it a verification link. */
export async function createDestination(
  accountId: string,
  email: string
): Promise<CfDestination> {
  return (
    await cf<CfDestination>(`/accounts/${accountId}/email/routing/addresses`, {
      method: "POST",
      body: JSON.stringify({ email }),
    })
  ).result;
}

export async function deleteDestination(accountId: string, id: string): Promise<void> {
  await cf<unknown>(`/accounts/${accountId}/email/routing/addresses/${id}`, {
    method: "DELETE",
  });
}
