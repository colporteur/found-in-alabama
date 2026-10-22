CREATE TABLE IF NOT EXISTS "listing_fixes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"group_id" uuid,
	"note" text NOT NULL,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"before" jsonb NOT NULL,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"done_at" timestamp,
	"done_by" text,
	"resolved_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_fixes" ADD CONSTRAINT "listing_fixes_draft_id_listing_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."listing_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_fixes_draft_idx" ON "listing_fixes" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_fixes_status_idx" ON "listing_fixes" USING btree ("status");