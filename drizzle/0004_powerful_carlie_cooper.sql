CREATE TABLE IF NOT EXISTS "ebay_auto_categorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"title" text NOT NULL,
	"primary_image_url" text,
	"price" numeric(10, 2),
	"picked_category_1_id" text,
	"picked_category_1_name" text,
	"picked_category_2_id" text,
	"picked_category_2_name" text,
	"is_alabama_pick" boolean DEFAULT false NOT NULL,
	"confidence" numeric(4, 3),
	"reasoning" text,
	"outcome" text NOT NULL,
	"error_message" text,
	"decided_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ebay_auto_categorize_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phase" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"initial_queue_count" integer,
	"queue" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"queue_index" integer DEFAULT 0 NOT NULL,
	"total_attempted" integer DEFAULT 0 NOT NULL,
	"total_applied" integer DEFAULT 0 NOT NULL,
	"total_failed" integer DEFAULT 0 NOT NULL,
	"total_skipped" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ebay_auto_categorizations" ADD CONSTRAINT "ebay_auto_categorizations_run_id_ebay_auto_categorize_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ebay_auto_categorize_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_auto_cats_run_idx" ON "ebay_auto_categorizations" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_auto_cats_outcome_idx" ON "ebay_auto_categorizations" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_auto_cats_decided_at_idx" ON "ebay_auto_categorizations" USING btree ("decided_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_auto_runs_status_idx" ON "ebay_auto_categorize_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_auto_runs_started_at_idx" ON "ebay_auto_categorize_runs" USING btree ("started_at");