CREATE TABLE IF NOT EXISTS "ebay_category_aspects" (
	"category_id" text PRIMARY KEY NOT NULL,
	"aspects" jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
