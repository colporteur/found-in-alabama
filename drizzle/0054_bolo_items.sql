CREATE TABLE IF NOT EXISTS "bolo_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"query" text NOT NULL,
	"comp" text NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"source" text,
	"photo_url" text,
	"status" text,
	"confidence" real,
	"hint" text,
	"ai_meta" jsonb,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bolo_items_created_idx" ON "bolo_items" USING btree ("created_at");
