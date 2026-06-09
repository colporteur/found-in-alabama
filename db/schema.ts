import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  uuid,
  index,
  boolean,
  numeric,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// ─── Inventory ────────────────────────────────────────────────────────────────

// Items captured from Nifty.ai by the Chrome extension. Title is the primary
// stable identifier across recreates. SKU is a storage bin code (not unique).
// niftyId is captured if Nifty exposes one in the inventory page DOM.

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    niftyId: text("nifty_id").unique(),
    title: text("title").notNull(),
    titleNormalized: text("title_normalized").notNull(), // lowercased, trimmed — used for matching CSV exports
    // Public URL segment for /products/{slug}. Generated at capture time
    // from title; nullable for back-compat with rows captured before
    // Phase 3A (the next sync fills them in).
    slug: text("slug").unique(),
    sku: text("sku"),
    quantity: integer("quantity").default(1).notNull(),
    status: text("status", { enum: ["active", "sold"] })
      .default("active")
      .notNull(),
    heroImage: text("hero_image"),
    price: numeric("price", { precision: 10, scale: 2 }),
    marketplaceUrls: jsonb("marketplace_urls")
      .$type<Partial<Record<MarketplaceKey, string>>>()
      .default({})
      .notNull(),
    niftyImportedAt: timestamp("nifty_imported_at"), // from CSV export "Imported/Created At"
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
    lastSeenInExportAt: timestamp("last_seen_in_export_at"),
    // Phase 2C-1: derived from Nifty privateNotes when it matches a published
    // journal post slug. Used to link items to their haul story.
    haulPostSlug: text("haul_post_slug"),
    // Phase 3B: cached eBay store category ID for "See similar items"
    // on the product page. Populated either by joining ebayListings
    // (free) or by a one-shot Haiku call on first product-page visit.
    ebayStoreCategoryId: text("ebay_store_category_id"),
    // Phase 2C-1: Nifty's own "sold at" timestamp. Captured verbatim so we
    // can show "Sold on June 5" on the haul page.
    soldAt: timestamp("sold_at"),
    // Phase 2C-1: which marketplace converted the sale ("ebay" / "etsy" /
    // "poshmark" / "mercari" / "depop" / "whatnot"). Derived from the
    // marketplaceMetadata block — whichever platform's status was "SOLD".
    soldOnMarketplace: text("sold_on_marketplace"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    titleNormalizedIdx: index("items_title_normalized_idx").on(t.titleNormalized),
    statusIdx: index("items_status_idx").on(t.status),
    haulPostSlugIdx: index("items_haul_post_slug_idx").on(t.haulPostSlug),
    slugIdx: index("items_slug_idx").on(t.slug),
  })
);

export type MarketplaceKey =
  | "ebay"
  | "etsy"
  | "poshmark"
  | "mercari"
  | "depop"
  | "whatnot";

// API keys for the Chrome extension to authenticate POSTs to /api/items.
// Each key gets hashed before storage; the plaintext is shown once at creation.

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  prefix: text("prefix").notNull(), // first 8 chars of the key, for display
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
});

// ─── eBay Tools ───────────────────────────────────────────────────────────────
// Tables backing the /admin/ebay re-categorization tool. eBay credentials
// (App ID, Cert ID, Dev ID, user token) live in .env.local — see
// PHASE-EBAY-1-SETUP.md. These tables only cache fetched data and decisions.

// Local cache of the seller's eBay Store custom category tree. Populated by
// "Sync categories" in the eBay tool. parentCategoryId is null for top-level
// nodes. CategoryID values are eBay-side numeric IDs stored as text.

export const ebayStoreCategories = pgTable(
  "ebay_store_categories",
  {
    categoryId: text("category_id").primaryKey(),
    parentCategoryId: text("parent_category_id"),
    name: text("name").notNull(),
    order: integer("order").default(0).notNull(),
    isAlabamaRelated: boolean("is_alabama_related").default(false).notNull(),
    isOtherBucket: boolean("is_other_bucket").default(false).notNull(),
    lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
  },
  (t) => ({
    parentIdx: index("ebay_store_categories_parent_idx").on(t.parentCategoryId),
    alabamaIdx: index("ebay_store_categories_alabama_idx").on(t.isAlabamaRelated),
  })
);

// Local cache of listings pulled for re-categorization. Only contains the
// subset matching our filter (StoreCategoryID = "Other", StoreCategory2ID
// empty) so the table stays small.

export const ebayListings = pgTable(
  "ebay_listings",
  {
    itemId: text("item_id").primaryKey(),
    sku: text("sku"),
    title: text("title").notNull(),
    primaryImageUrl: text("primary_image_url"),
    storeCategory1Id: text("store_category_1_id"),
    storeCategory2Id: text("store_category_2_id"),
    siteCategoryId: text("site_category_id"),
    siteCategoryName: text("site_category_name"),
    listingType: text("listing_type"),
    quantity: integer("quantity"),
    price: numeric("price", { precision: 10, scale: 2 }),
    description: text("description"),
    lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
  },
  (t) => ({
    storeCat1Idx: index("ebay_listings_store_cat1_idx").on(t.storeCategory1Id),
    storeCat2Idx: index("ebay_listings_store_cat2_idx").on(t.storeCategory2Id),
  })
);

// Claude-generated re-categorization suggestions. status flow:
//   pending → auto-applied | applied | skipped | rejected.
// auto-applied = Claude's confidence cleared the auto-apply threshold and the
// change was pushed to eBay without explicit per-item review.

export const ebayCategorySuggestions = pgTable(
  "ebay_category_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: text("item_id")
      .notNull()
      .references(() => ebayListings.itemId, { onDelete: "cascade" }),
    suggestedCategory1Id: text("suggested_category_1_id"),
    suggestedCategory2Id: text("suggested_category_2_id"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    reasoning: text("reasoning"),
    status: text("status", {
      enum: ["pending", "auto-applied", "applied", "skipped", "rejected"],
    })
      .default("pending")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    decidedAt: timestamp("decided_at"),
  },
  (t) => ({
    itemIdx: index("ebay_category_suggestions_item_idx").on(t.itemId),
    statusIdx: index("ebay_category_suggestions_status_idx").on(t.status),
  })
);

// Cached promotion/sale records that we've created via the Sell Marketing
// API. ebayPromotionId is null until eBay confirms creation. Status mirrors
// eBay's promotion lifecycle (DRAFT → SCHEDULED → RUNNING → ENDED), with
// FAILED added for our local error state.

export const ebaySales = pgTable(
  "ebay_sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleType: text("sale_type", {
      enum: [
        "MARKDOWN_CATEGORY",
        "MARKDOWN_SKU",
        "ORDER_DISCOUNT",
        "CODELESS_VOUCHER",
      ],
    }).notNull(),
    ebayPromotionId: text("ebay_promotion_id"),
    status: text("status", {
      enum: ["DRAFT", "SCHEDULED", "RUNNING", "PAUSED", "ENDED", "FAILED"],
    })
      .default("DRAFT")
      .notNull(),
    name: text("name").notNull(),
    description: text("description"),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }),
    minSpendAmount: numeric("min_spend_amount", { precision: 10, scale: 2 }),
    // Scope holds the type-specific selection: store category IDs for
    // MARKDOWN_CATEGORY, SKU list for MARKDOWN_SKU, etc.
    scope: jsonb("scope")
      .$type<{
        categoryIds?: string[];
        skus?: string[];
        appliesToAll?: boolean;
      }>()
      .default({})
      .notNull(),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index("ebay_sales_status_idx").on(t.status),
  })
);

// Audit log for sale operations (create, update, end). Useful for
// debugging eBay rejections and tracing what was sent.

export const ebaySaleAuditLog = pgTable("ebay_sale_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  saleId: uuid("sale_id").references(() => ebaySales.id, {
    onDelete: "cascade",
  }),
  action: text("action").notNull(),
  success: boolean("success").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// OAuth tokens for the eBay Sell APIs (Marketing, Account, etc.). These
// require a different auth chain than the Auth'n'Auth user token used by
// the Trading API. Single-row table — id is always "singleton".

export const ebayOAuthTokens = pgTable("ebay_oauth_tokens", {
  id: text("id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at").notNull(),
  scope: text("scope").notNull(),
  ebayUsername: text("ebay_username"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Audit log of every eBay API operation we perform. Useful for debugging
// failed pushes and seeing what Claude has been doing on Todd's behalf.

export const ebaySyncLog = pgTable("ebay_sync_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").notNull(),
  itemId: text("item_id"),
  success: boolean("success").notNull(),
  itemCount: integer("item_count"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
});

// ─── Phase eBay-1.1 — Auto-categorize ────────────────────────────────────────
// Replaces the manual review queue. Each "Run" pulls live "Other" listings
// from eBay, asks Claude for a categorization (with extra weight on Alabama-
// related categories), and pushes ReviseItem back to eBay — no approval step.
//
// Two phases per run:
//   "primary"   — move listings out of the "Other" store category 1
//   "secondary" — fill in a 2nd store category for items missing one
// (secondary only unlocks once primary count is 0)
//
// No persistent listings cache. Each row in ebayAutoCategorizations is a
// one-shot record of what happened to one listing during one run. Rows from
// previous runs are purged when a new run starts so the page always shows
// just the latest activity.

export const ebayAutoCategorizeRuns = pgTable(
  "ebay_auto_categorize_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phase: text("phase", { enum: ["primary", "secondary"] }).notNull(),
    status: text("status", {
      enum: ["running", "completed", "failed", "cancelled"],
    })
      .default("running")
      .notNull(),
    initialQueueCount: integer("initial_queue_count"), // count of items eligible at run start (live from eBay)
    // Snapshot of items to process — captured once at run start. Client
    // calls /advance to process one item at a time, incrementing queueIndex.
    queue: jsonb("queue")
      .$type<
        Array<{
          itemId: string;
          title: string;
          primaryImageUrl: string | null;
          price: string | null;
          storeCategory1Id: string | null;
          storeCategory2Id: string | null;
        }>
      >()
      .default([])
      .notNull(),
    queueIndex: integer("queue_index").default(0).notNull(),
    totalAttempted: integer("total_attempted").default(0).notNull(),
    totalApplied: integer("total_applied").default(0).notNull(),
    totalFailed: integer("total_failed").default(0).notNull(),
    totalSkipped: integer("total_skipped").default(0).notNull(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    statusIdx: index("ebay_auto_runs_status_idx").on(t.status),
    startedAtIdx: index("ebay_auto_runs_started_at_idx").on(t.startedAt),
  })
);

export const ebayAutoCategorizations = pgTable(
  "ebay_auto_categorizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ebayAutoCategorizeRuns.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    title: text("title").notNull(),
    primaryImageUrl: text("primary_image_url"),
    price: numeric("price", { precision: 10, scale: 2 }),
    // Categorization decision
    pickedCategory1Id: text("picked_category_1_id"),
    pickedCategory1Name: text("picked_category_1_name"),
    pickedCategory2Id: text("picked_category_2_id"),
    pickedCategory2Name: text("picked_category_2_name"),
    isAlabamaPick: boolean("is_alabama_pick").default(false).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    reasoning: text("reasoning"),
    // Outcome
    outcome: text("outcome", {
      enum: ["applied", "ebay_failed", "ebay_ended", "claude_failed", "skipped"],
    }).notNull(),
    errorMessage: text("error_message"),
    decidedAt: timestamp("decided_at").defaultNow().notNull(),
  },
  (t) => ({
    runIdx: index("ebay_auto_cats_run_idx").on(t.runId),
    outcomeIdx: index("ebay_auto_cats_outcome_idx").on(t.outcome),
    decidedAtIdx: index("ebay_auto_cats_decided_at_idx").on(t.decidedAt),
  })
);

// ─── Phase 2D-2 — Social draft queue ─────────────────────────────────────────
// Persisted output of the social copy generator. One row per (generation,
// channel) pair. Source fields are denormalized so the queue page renders
// fast and survives source deletion. content is the per-channel JSON shape
// returned by Claude (see lib/social/channel-styles.ts ChannelOutput).

export const socialDrafts = pgTable(
  "social_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Source — what this post is about
    sourceType: text("source_type", { enum: ["haul", "item"] }).notNull(),
    sourceId: text("source_id").notNull(),
    sourceTitle: text("source_title").notNull(), // denormalized for list rendering
    sourceImage: text("source_image"),           // URL for thumbnail in queue
    // Phase 2D-3b: destination URL that adapters can attach to the
    // post (Pinterest's "link" field, etc.). Computed at draft-save time
    // so it survives even if the source's URL pattern changes later.
    sourceUrl: text("source_url"),
    // Generation grouping — all channels from one /generate call share this
    generationId: uuid("generation_id").notNull(),
    contentType: text("content_type", {
      enum: ["just-listed", "new-haul", "throwback", "just-sold"],
    }).notNull(),
    channel: text("channel").notNull(), // ChannelKey ("instagram_feed", etc.)
    // Per-channel JSON content from Claude. Shape varies by channel:
    //   text-with-hashtags: { text, hashtags[] }
    //   text:               { text }
    //   story:              { overlay_text, cta }
    //   pinterest:          { title, description, board_suggestion }
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    // Lifecycle
    status: text("status", {
      enum: ["draft", "scheduled", "posted", "skipped", "failed"],
    })
      .default("draft")
      .notNull(),
    scheduledFor: timestamp("scheduled_for"),
    postedAt: timestamp("posted_at"),
    notes: text("notes"),
    // Phase 2D-3: auto-posting tracking
    // Platform's own id for the published post (e.g. BlueSky URI, Pinterest pin id).
    postId: text("post_id"),
    // Publicly-clickable URL to the published post, for display in the queue.
    postUrl: text("post_url"),
    // Last error message if a post attempt failed.
    postError: text("post_error"),
    // How many times we've tried to post this draft (manual + cron combined).
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastAttemptAt: timestamp("last_attempt_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index("social_drafts_status_idx").on(t.status),
    scheduledForIdx: index("social_drafts_scheduled_for_idx").on(t.scheduledFor),
    generationIdIdx: index("social_drafts_generation_idx").on(t.generationId),
    channelIdx: index("social_drafts_channel_idx").on(t.channel),
  })
);

// ─── Phase 2D-3b — Pinterest OAuth + boards cache ────────────────────────────

// Single-row table storing Pinterest's OAuth tokens. Same singleton
// pattern as ebay_oauth_tokens — Todd's the only user.
export const pinterestOAuthTokens = pgTable("pinterest_oauth_tokens", {
  id: text("id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at").notNull(),
  scope: text("scope").notNull(),
  pinterestUsername: text("pinterest_username"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Cache of the user's Pinterest boards. Refreshed on demand from the
// settings page. The adapter matches Claude's board_suggestion against
// these names to pick where each pin goes.
export const pinterestBoards = pgTable(
  "pinterest_boards",
  {
    boardId: text("board_id").primaryKey(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(), // lowercased for fuzzy match
    privacy: text("privacy"), // "public" | "secret" | "protected"
    pinCount: integer("pin_count"),
    isDefault: boolean("is_default").default(false).notNull(),
    lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
  },
  (t) => ({
    nameNormalizedIdx: index("pinterest_boards_name_normalized_idx").on(
      t.nameNormalized
    ),
    isDefaultIdx: index("pinterest_boards_is_default_idx").on(t.isDefault),
  })
);

// ─── Phase 2D-3c — Publer accounts cache + channel mapping ───────────────────
//
// Publer is a multi-channel scheduler we use for Instagram, Facebook, and
// X. The API key + workspace id live in env vars. This table caches the
// list of accounts the user has connected in Publer's UI, and records
// which of OUR ChannelKey values each account maps to. The adapter
// looks up the mapped account at post time.
//
// We don't unique the channel mapping at the DB level — the API code
// clears any existing mapping for a channel before setting a new one.

export const publerAccounts = pgTable(
  "publer_accounts",
  {
    accountId: text("account_id").primaryKey(),
    name: text("name").notNull(),
    provider: text("provider").notNull(), // "instagram" | "facebook" | "twitter" | etc.
    pictureUrl: text("picture_url"),
    /** One of our ChannelKey values, or null if not mapped. */
    mappedToChannel: text("mapped_to_channel"),
    lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
  },
  (t) => ({
    providerIdx: index("publer_accounts_provider_idx").on(t.provider),
    mappedToChannelIdx: index("publer_accounts_mapped_to_channel_idx").on(
      t.mappedToChannel
    ),
  })
);

// ─── NextAuth tables (shape required by @auth/drizzle-adapter) ────────────────

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  })
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);
