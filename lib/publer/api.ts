// Publer API v1 client.
//
// Auth: API key in Authorization header, Workspace id in Publer-Workspace-Id
// header. Both come from env vars:
//   PUBLER_API_KEY
//   PUBLER_WORKSPACE_ID  (the long hex id visible in your workspace URL)
//
// The public Publer API surface area we use:
//   GET  /users/me      — verify the API key
//   GET  /accounts      — list social accounts in the workspace
//   POST /posts/schedule/publish  — publish immediately
//
// If Publer's API shape shifts under us, the wire format for createPost()
// is the most likely thing to need adjusting — it's where the Publer
// documentation drifts.

import { db, publerAccounts } from "@/db";
import { and, eq, isNotNull } from "drizzle-orm";

const API_BASE = "https://app.publer.com/api/v1";

class PublerError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new PublerError(`${name} is not set in Vercel env vars.`, 400);
  }
  return v;
}

export function isConfigured(): boolean {
  // Workspace id is optional — accounts with a single workspace don't
  // need to specify it; Publer infers from the API key.
  return !!process.env.PUBLER_API_KEY;
}

async function publerFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  // Workspace id is optional — only include the header when it's set.
  const workspaceId = process.env.PUBLER_WORKSPACE_ID?.trim();
  const headers: Record<string, string> = {
    Authorization: `Bearer-API ${requireEnv("PUBLER_API_KEY")}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (workspaceId) headers["Publer-Workspace-Id"] = workspaceId;
  const res = await fetch(url, {
    ...init,
    headers,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 800);
    try {
      const parsed = JSON.parse(text);
      detail = parsed.message ?? parsed.error ?? detail;
    } catch {
      /* keep raw */
    }
    throw new PublerError(
      `Publer API ${res.status}: ${detail}`,
      res.status
    );
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

// ─── Test connection ─────────────────────────────────────────────────────────

export type MeResponse = {
  id?: string;
  email?: string;
  name?: string;
  [k: string]: unknown;
};

export async function getMe(): Promise<MeResponse> {
  return publerFetch<MeResponse>("/users/me");
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export type PublerAccount = {
  id: string;
  name: string;
  provider: string; // "instagram" | "facebook" | "twitter" | "tiktok" | etc.
  picture_url?: string | null;
};

/**
 * Fetch accounts. Publer's response wraps the list in different shapes
 * across versions, so we accept several common ones.
 */
export async function fetchAccounts(): Promise<PublerAccount[]> {
  const raw = await publerFetch<unknown>("/accounts");
  if (Array.isArray(raw)) return raw as PublerAccount[];
  if (raw && typeof raw === "object") {
    const maybe = raw as { accounts?: unknown; data?: unknown };
    if (Array.isArray(maybe.accounts)) return maybe.accounts as PublerAccount[];
    if (Array.isArray(maybe.data)) return maybe.data as PublerAccount[];
  }
  return [];
}

export async function syncAccountsToCache(): Promise<number> {
  const remote = await fetchAccounts();
  // Preserve existing mappedToChannel values across syncs — they're our
  // user's choices, not Publer's data.
  const existing = await db.select().from(publerAccounts);
  const mappingByAccountId = new Map(
    existing.map((r) => [r.accountId, r.mappedToChannel])
  );

  await db.delete(publerAccounts);
  if (remote.length === 0) return 0;
  await db.insert(publerAccounts).values(
    remote.map((a) => ({
      accountId: a.id,
      name: a.name ?? a.id,
      provider: (a.provider ?? "").toLowerCase(),
      pictureUrl: a.picture_url ?? null,
      mappedToChannel: mappingByAccountId.get(a.id) ?? null,
      lastSyncedAt: new Date(),
    }))
  );
  return remote.length;
}

export async function listCachedAccounts() {
  return db.select().from(publerAccounts);
}

/** Pick the cached account currently mapped to a given ChannelKey. */
export async function accountForChannel(
  channel: string
): Promise<{ accountId: string; name: string; provider: string } | null> {
  const [row] = await db
    .select()
    .from(publerAccounts)
    .where(eq(publerAccounts.mappedToChannel, channel))
    .limit(1);
  if (!row) return null;
  return {
    accountId: row.accountId,
    name: row.name,
    provider: row.provider,
  };
}

/**
 * Set the channel mapping for one account. Clears any other account
 * that was previously mapped to the same channel so we always have at
 * most one Publer account per ChannelKey.
 */
export async function setMapping(
  accountId: string,
  channel: string | null
): Promise<void> {
  if (channel) {
    // Wipe other rows that had this channel
    await db
      .update(publerAccounts)
      .set({ mappedToChannel: null })
      .where(
        and(
          eq(publerAccounts.mappedToChannel, channel),
          isNotNull(publerAccounts.mappedToChannel)
        )
      );
  }
  await db
    .update(publerAccounts)
    .set({ mappedToChannel: channel })
    .where(eq(publerAccounts.accountId, accountId));
}

// ─── Create post ─────────────────────────────────────────────────────────────

export type CreatePostInput = {
  /** Publer account id we're posting to. */
  accountId: string;
  /** Plain text content. */
  text: string;
  /** Absolute URL to an image (Publer fetches it). */
  imageUrl: string | null;
  /** Click-through link for platforms that use one (FB, Pinterest). */
  link?: string | null;
  /** Set to "story" for Instagram story posts; "feed" otherwise. */
  postType?: "feed" | "story";
};

export type CreatePostResponse = {
  /** Publer's internal post/job id (varies by API version). */
  id?: string;
  job_id?: string;
  /** Public URL to the published post, if Publer returns one. */
  url?: string;
  [k: string]: unknown;
};

/**
 * Publish a post immediately to one account.
 *
 * Wire shape: this matches the documented Publer API as of writing. If
 * Publer's response shape changes, look at the error in the queue UI
 * (it surfaces the body) and tweak the payload here.
 */
export async function createPost(
  input: CreatePostInput
): Promise<CreatePostResponse> {
  const media = input.imageUrl
    ? [{ type: "image", path: input.imageUrl }]
    : [];

  const post: Record<string, unknown> = {
    accounts: [input.accountId],
    networks: {
      default: {
        details: {
          text: input.text,
          media,
          ...(input.link ? { link: input.link } : {}),
        },
        ...(input.postType ? { type: input.postType } : {}),
      },
    },
  };

  const body = {
    bulk: {
      state: "scheduled", // immediate-publish "draft" is also accepted but "scheduled" + no time = publish now in some Publer versions
      posts: [post],
    },
  };

  // Publer has both /posts/schedule and /posts/schedule/publish endpoints
  // in different docs versions; the /publish suffix forces immediate.
  return publerFetch<CreatePostResponse>("/posts/schedule/publish", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
