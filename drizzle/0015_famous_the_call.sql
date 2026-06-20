CREATE TABLE IF NOT EXISTS "newsletter_send_log" (
	"draft_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"resend_id" text,
	"error" text,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_send_log_draft_id_subscriber_id_pk" PRIMARY KEY("draft_id","subscriber_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "newsletter_send_log" ADD CONSTRAINT "newsletter_send_log_draft_id_newsletter_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."newsletter_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "newsletter_send_log" ADD CONSTRAINT "newsletter_send_log_subscriber_id_newsletter_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."newsletter_subscribers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_send_log_draft_idx" ON "newsletter_send_log" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_send_log_status_idx" ON "newsletter_send_log" USING btree ("status");