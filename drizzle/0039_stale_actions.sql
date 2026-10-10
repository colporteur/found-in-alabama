CREATE TABLE IF NOT EXISTS "stale_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ebay_item_id" text NOT NULL,
	"registry_item_id" uuid,
	"action" text NOT NULL,
	"batch_id" uuid,
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stale_actions_item_idx" ON "stale_actions" USING btree ("ebay_item_id","created_at");