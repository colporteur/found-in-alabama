CREATE TABLE IF NOT EXISTS "tes_recat_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"title" text NOT NULL,
	"sku" text,
	"old_category_1_id" text,
	"old_category_2_id" text,
	"new_category_1_id" text,
	"new_category_2_id" text,
	"mode" text NOT NULL,
	"ai_confidence" numeric(4, 3),
	"ai_reasoning" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tes_recat_queue_status_idx" ON "tes_recat_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tes_recat_queue_item_idx" ON "tes_recat_queue" USING btree ("item_id");