ALTER TABLE "social_drafts" ADD COLUMN "post_id" text;--> statement-breakpoint
ALTER TABLE "social_drafts" ADD COLUMN "post_url" text;--> statement-breakpoint
ALTER TABLE "social_drafts" ADD COLUMN "post_error" text;--> statement-breakpoint
ALTER TABLE "social_drafts" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_drafts" ADD COLUMN "last_attempt_at" timestamp;