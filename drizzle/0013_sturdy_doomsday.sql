CREATE TABLE IF NOT EXISTS "newsletter_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"confirm_token_hash" text,
	"confirm_token_expires_at" timestamp,
	"unsubscribe_token_hash" text NOT NULL,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"unsubscribed_at" timestamp,
	CONSTRAINT "newsletter_subscribers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_subscribers_status_idx" ON "newsletter_subscribers" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_subscribers_confirm_hash_idx" ON "newsletter_subscribers" USING btree ("confirm_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_subscribers_unsub_hash_idx" ON "newsletter_subscribers" USING btree ("unsubscribe_token_hash");