CREATE TABLE IF NOT EXISTS "newsletter_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"label" text NOT NULL,
	"email_subject" text NOT NULL,
	"ebay_subject" text NOT NULL,
	"email_body" text NOT NULL,
	"ebay_body" text NOT NULL,
	"facts_snapshot" jsonb,
	"email_recipient_count" integer,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_drafts_status_idx" ON "newsletter_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_drafts_generated_at_idx" ON "newsletter_drafts" USING btree ("generated_at");