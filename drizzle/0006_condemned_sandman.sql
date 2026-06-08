CREATE TABLE IF NOT EXISTS "social_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_title" text NOT NULL,
	"source_image" text,
	"generation_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"channel" text NOT NULL,
	"content" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp,
	"posted_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_drafts_status_idx" ON "social_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_drafts_scheduled_for_idx" ON "social_drafts" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_drafts_generation_idx" ON "social_drafts" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_drafts_channel_idx" ON "social_drafts" USING btree ("channel");