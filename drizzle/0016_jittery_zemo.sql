CREATE TABLE IF NOT EXISTS "haul_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"hero_images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context_images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acquisition_context" text DEFAULT '' NOT NULL,
	"photo_notes" text DEFAULT '' NOT NULL,
	"context_url" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'Alabama' NOT NULL,
	"vague_location" text DEFAULT '' NOT NULL,
	"title" text,
	"slug" text,
	"excerpt" text,
	"body" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "haul_drafts_updated_at_idx" ON "haul_drafts" USING btree ("updated_at");