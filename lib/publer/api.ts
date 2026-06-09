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
    // multipart bodies (FormData) must let fetch set its own boundary header
    ...(init.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
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

// ─── Media upload ────────────────────────────────────────────────────────────

/**
 * Publer requires media to be uploaded to its servers BEFORE being
 * referenced in a post (by media id) — passing an external image URL
 * inside the post body is silently ignored. We fetch the image bytes
 * ourselves and use the synchronous multipart POST /media endpoint,
 * which returns the media id directly (the /media/from-url variant is
 * async and would mean polling a second job).
 */
export async function uploadImageFromUrl(
  imageUrl: string
): Promise<{ id: string }> {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new PublerError(
      `Could not fetch image for Publer upload (${imgRes.status}): ${imageUrl}`,
      imgRes.status
    );
  }
  const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
  const buf = await imgRes.arrayBuffer();
  const filename =
    imageUrl.split("/").pop()?.split("?")[0] || "image.jpg";

  const form = new FormData();
  form.append("file", new Blob([buf], { type: contentType }), filename);

  const uploaded = await publerFetch<{ id?: string; [k: string]: unknown }>(
    "/media",
    { method: "POST", body: form }
  );
  console.log(`[publer] media upload response:`, JSON.stringify(uploaded));
  if (!uploaded.id || typeof uploaded.id !== "string") {
    throw new PublerError(
      `Publer media upload returned no id: ${JSON.stringify(uploaded).slice(0, 500)}`,
      502
    );
  }
  return { id: uploaded.id };
}

// ─── Create post ─────────────────────────────────────────────────────────────

export type CreatePostInput = {
  /** Publer account id we're posting to. */
  accountId: string;
  /**
   * Publer network provider for the account ("instagram" | "facebook" |
   * "twitter" | ...). Used as the key under `networks` so Publer
   * validates content against the right platform. Falls back to
   * "default" when unknown.
   */
  provider?: string | null;
  /** Plain text content. */
  text: string;
  /** Absolute URL to an image (we upload it to Publer first). */
  imageUrl: string | null;
  /** Click-through link. Appended to text for FB/X; skipped on IG (not clickable). */
  link?: string | null;
  /** Set to "story" for Instagram story posts; "feed" otherwise. */
  postType?: "feed" | "story";
};

/** Network keys Publer accepts under `networks`. */
const KNOWN_PROVIDERS = new Set([
  "facebook",
  "instagram",
  "twitter",
  "linkedin",
  "pinterest",
  "google",
  "youtube",
  "tiktok",
  "wordpress_oauth",
  "wordpress_basic",
  "telegram",
  "mastodon",
  "threads",
  "bluesky",
]);

function networkKeyFor(provider: string | null | undefined): string {
  const p = (provider ?? "").toLowerCase();
  if (p === "x") return "twitter";
  return KNOWN_PROVIDERS.has(p) ? p : "default";
}

export type CreatePostResponse = {
  /** Publer's internal post/job id (varies by API version). */
  id?: string;
  job_id?: string;
  /** Public URL to the published post, if Publer returns one. */
  url?: string;
  [k: string]: unknown;
};

export type JobStatusResponse = {
  /** Publer job lifecycle: "working" → "complete" | "failed". */
  status?: string;
  /** Result payload when complete (contains post ids / urls) or error info on failure. */
  payload?: unknown;
  /** payload.failures — non-empty means at least one account's post failed. */
  failures?: Record<string, unknown>;
  message?: string;
  /** The raw, unnormalized response, for logging. */
  raw?: unknown;
  [k: string]: unknown;
};

/**
 * Publer returns job status either flat ({status, payload, plan}) or
 * wrapped ({success, data: {status, result: {status, payload, plan}}})
 * depending on API version. Normalize both. The `plan` object is just
 * account plan info — not job data — so we drop it.
 */
function normalizeJobStatus(rawIn: unknown): JobStatusResponse {
  const raw = (rawIn ?? {}) as Record<string, unknown>;
  const data = (raw.data ?? raw) as Record<string, unknown>;
  const result = (data.result ?? data) as Record<string, unknown>;
  const status =
    typeof result.status === "string"
      ? result.status
      : typeof data.status === "string"
        ? data.status
        : typeof raw.status === "string"
          ? raw.status
          : undefined;
  const payload = (result.payload ?? data.payload ?? raw.payload) as
    | Record<string, unknown>
    | undefined;
  const failures =
    payload && typeof payload === "object"
      ? (payload.failures as Record<string, unknown> | undefined)
      : undefined;
  return {
    status,
    payload,
    failures,
    message: typeof raw.message === "string" ? raw.message : undefined,
    raw: rawIn,
  };
}

/** Look up the status of an async job we kicked off with createPost. */
export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  const raw = await publerFetch<unknown>(`/job_status/${jobId}`);
  return normalizeJobStatus(raw);
}

/**
 * Poll a job until it reaches a terminal state (complete or failed).
 * Returns the final JobStatusResponse, or the last one we saw if we
 * timed out.
 */
export async function waitForJob(
  jobId: string,
  { intervalMs = 1500, timeoutMs = 40_000 }: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<JobStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  let last: JobStatusResponse = {};
  while (Date.now() < deadline) {
    try {
      last = await getJobStatus(jobId);
      console.log(`[publer] job ${jobId} status:`, JSON.stringify(last));
      const s = typeof last.status === "string" ? last.status.toLowerCase() : "";
      if (s === "complete" || s === "completed" || s === "success") return last;
      if (s === "failed" || s === "error") return last;
    } catch (err) {
      // If the status endpoint itself errors, log and keep trying
      console.warn(`[publer] job_status poll failed`, err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

/**
 * Publish a post immediately via POST /posts/schedule/publish.
 *
 * Wire format notes (verified against publer.com/docs, June 2026):
 * - Network content lives DIRECTLY in the network object: { type, text,
 *   media } — no `details` wrapper. `details` is only for reel/story
 *   sub-options. A wrapped body is silently ignored: the job completes
 *   with empty failures and no post is created.
 * - `type` is the content type: "photo" | "status" | "story" | ... —
 *   "feed" is not a valid value.
 * - `accounts` is an array of OBJECTS: [{ id }], not bare id strings.
 * - Media must be pre-uploaded (uploadImageFromUrl) and referenced by
 *   { id, type: "image" } — external URLs in `path` are ignored.
 */
export async function createPost(
  input: CreatePostInput
): Promise<CreatePostResponse> {
  // 1. Upload the image to Publer first (required to get a media id).
  let media: Array<{ id: string; type: string }> = [];
  if (input.imageUrl) {
    const uploaded = await uploadImageFromUrl(input.imageUrl);
    media = [{ id: uploaded.id, type: "image" }];
  }

  const networkKey = networkKeyFor(input.provider);

  // Content type: story posts are "story"; with an image "photo";
  // text-only is "status".
  const contentType =
    input.postType === "story" ? "story" : media.length > 0 ? "photo" : "status";

  // Links: photo/status posts don't carry a separate link field, so
  // append to text where links are useful and clickable (FB, X).
  // Instagram captions don't render clickable links — skip there.
  let text = input.text;
  if (
    input.link &&
    networkKey !== "instagram" &&
    !text.includes(input.link)
  ) {
    text = `${text}\n\n${input.link}`;
  }

  const content: Record<string, unknown> = {
    type: contentType,
    text,
    ...(media.length > 0 ? { media } : {}),
  };

  const body = {
    bulk: {
      state: "scheduled",
      posts: [
        {
          networks: { [networkKey]: content },
          accounts: [{ id: input.accountId }],
        },
      ],
    },
  };

  // /posts/schedule/publish = publish immediately (no scheduled_at).
  const endpoint = "/posts/schedule/publish";
  console.log(
    `[publer] POST ${endpoint} body:`,
    JSON.stringify(body, null, 2)
  );
  const response = await publerFetch<CreatePostResponse>(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
  });
  console.log(`[publer] response:`, JSON.stringify(response, null, 2));
  // Some API versions wrap the job id: { success, data: { job_id } }.
  const wrapped = (response as { data?: { job_id?: string } }).data;
  if (!response.job_id && wrapped?.job_id) {
    response.job_id = wrapped.job_id;
  }
  return response;
}
