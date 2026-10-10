CREATE TABLE IF NOT EXISTS "registry_item_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registry_item_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"edited_by" text,
	"edited_at" timestamp DEFAULT now() NOT NULL,
	"pushed_at" timestamp,
	"push_result" jsonb
);
--> statement-breakpoint
ALTER TABLE "registry_items" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "registry_items" ADD COLUMN "fia_locked" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registry_item_edits_item_idx" ON "registry_item_edits" USING btree ("registry_item_id","edited_at");