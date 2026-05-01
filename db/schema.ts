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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    titleNormalizedIdx: index("items_title_normalized_idx").on(t.titleNormalized),
    statusIdx: index("items_status_idx").on(t.status),
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
