// Pinterest API v5 client helpers.
//
// Exposes:
//   - fetchBoards()             — list the connected user's boards
//   - syncBoardsToCache()       — refresh pinterest_boards table
//   - resolveBoardId(suggestion) — fuzzy-match Claude's board_suggestion
//   - createPin(payload)        — POST /pins
//   - getUserAccount()          — fetch the connected username
//
// All endpoint calls go through pinterestFetch() which attaches a fresh
// access token and parses errors consistently.

import { db, pinterestBoards } from "@/db";
import { eq, desc } from "drizzle-orm";
import { getValidAccessToken } from "@/lib/pinterest/oauth";

const API_BASE = "https://api.pinterest.com/v5";

class PinterestError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function pinterestFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new PinterestError("Pinterest not connected", 401);
  }
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 800);
    try {
      const parsed = JSON.parse(text);
      if (parsed.message) detail = parsed.message;
    } catch {
      /* keep raw text */
    }
    throw new PinterestError(
      `Pinterest API ${res.status}: ${detail}`,
      res.status
    );
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

// ─── Boards ──────────────────────────────────────────────────────────────────

export type PinterestBoard = {
  id: string;
  name: string;
  privacy: "PUBLIC" | "PROTECTED" | "SECRET";
  pin_count?: number;
};

type BoardsResponse = {
  items: PinterestBoard[];
  bookmark?: string;
};

/** Fetch all of the user's boards, paginating until done. */
export async function fetchBoards(): Promise<PinterestBoard[]> {
  const all: PinterestBoard[] = [];
  let bookmark: string | undefined;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({ page_size: "100" });
    if (bookmark) params.set("bookmark", bookmark);
    const res = await pinterestFetch<BoardsResponse>(
      `/boards?${params.toString()}`
    );
    all.push(...res.items);
    if (!res.bookmark) break;
    bookmark = res.bookmark;
  }
  return all;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Replace pinterest_boards with a fresh snapshot from the API. */
export async function syncBoardsToCache(): Promise<number> {
  const remote = await fetchBoards();
  // Wipe and replace — simplest semantics. Default-flag is reset; we
  // re-mark the first board as default if no row was previously marked.
  await db.delete(pinterestBoards);
  if (remote.length === 0) return 0;
  await db.insert(pinterestBoards).values(
    remote.map((b, i) => ({
      boardId: b.id,
      name: b.name,
      nameNormalized: normalizeName(b.name),
      privacy: b.privacy?.toLowerCase() ?? null,
      pinCount: b.pin_count ?? null,
      isDefault: i === 0, // first board becomes the default
      lastSyncedAt: new Date(),
    }))
  );
  return remote.length;
}

/**
 * Pick the best board id for a given Claude board_suggestion. Matching
 * strategy:
 *   1. Exact normalized name match.
 *   2. Substring match (suggestion ⊂ board or board ⊂ suggestion).
 *   3. Fall back to the default board.
 *   4. Last resort: first board returned.
 *   5. Returns null when no boards are cached.
 */
export async function resolveBoardId(
  suggestion: string | null | undefined
): Promise<string | null> {
  const rows = await db
    .select()
    .from(pinterestBoards)
    .orderBy(desc(pinterestBoards.isDefault));
  if (rows.length === 0) return null;

  if (suggestion) {
    const wanted = normalizeName(suggestion);
    if (wanted) {
      const exact = rows.find((r) => r.nameNormalized === wanted);
      if (exact) return exact.boardId;
      const sub = rows.find(
        (r) =>
          r.nameNormalized.includes(wanted) ||
          wanted.includes(r.nameNormalized)
      );
      if (sub) return sub.boardId;
    }
  }
  const def = rows.find((r) => r.isDefault);
  if (def) return def.boardId;
  return rows[0].boardId;
}

/** Mark exactly one board as the default. Used by settings UI. */
export async function setDefaultBoard(boardId: string): Promise<void> {
  await db
    .update(pinterestBoards)
    .set({ isDefault: false })
    .where(eq(pinterestBoards.isDefault, true));
  await db
    .update(pinterestBoards)
    .set({ isDefault: true })
    .where(eq(pinterestBoards.boardId, boardId));
}

export async function listCachedBoards() {
  return db
    .select()
    .from(pinterestBoards)
    .orderBy(desc(pinterestBoards.isDefault), pinterestBoards.name);
}

// ─── User account ────────────────────────────────────────────────────────────

type UserAccount = {
  username?: string;
  account_type?: string;
};

export async function getUserAccount(): Promise<UserAccount> {
  return pinterestFetch<UserAccount>("/user_account");
}

// ─── Create pin ──────────────────────────────────────────────────────────────

export type CreatePinInput = {
  board_id: string;
  title: string;
  description: string;
  link: string | null;
  alt_text?: string;
  /** Inline base64 image. */
  image_base64: {
    data: string;
    content_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  };
};

export type CreatePinResponse = {
  id: string;
  url?: string; // direct link to the pin if Pinterest returns one
  board_id: string;
};

export async function createPin(
  input: CreatePinInput
): Promise<CreatePinResponse> {
  const body: Record<string, unknown> = {
    board_id: input.board_id,
    title: input.title.slice(0, 100), // Pinterest's title cap
    description: input.description.slice(0, 800), // Pinterest's description cap
    alt_text: input.alt_text?.slice(0, 500),
    media_source: {
      source_type: "image_base64",
      content_type: input.image_base64.content_type,
      data: input.image_base64.data,
    },
  };
  if (input.link) body.link = input.link;
  return pinterestFetch<CreatePinResponse>("/pins", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
