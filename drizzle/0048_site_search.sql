-- Site search (SEARCH-1): full-text + fuzzy + meaning search for both
-- storefronts. Hand-written (custom migration): these tables are kept out of
-- db/schema.ts because drizzle has no tsvector type; lib/search/* owns them.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "search_index" (
	"item_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"cats" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"tsv" tsvector NOT NULL,
	"text_hash" text NOT NULL,
	"embedding" vector(512),
	"embedded_hash" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_index_tsv_idx" ON "search_index" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_index_title_trgm_idx" ON "search_index" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_index_embedding_idx" ON "search_index" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "search_words" (
	"word" text PRIMARY KEY NOT NULL,
	"ndoc" integer NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_words_trgm_idx" ON "search_words" USING gin ("word" gin_trgm_ops);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "search_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site" text NOT NULL,
	"q" text NOT NULL,
	"results" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_log_created_idx" ON "search_log" ("created_at");
