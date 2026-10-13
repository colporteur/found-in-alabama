CREATE TABLE IF NOT EXISTS "lot_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"allow_mix" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'forming' NOT NULL,
	"suggested_price" numeric(10, 2),
	"reason" text,
	"lot_draft_id" uuid,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lot_pool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"draft_id" uuid,
	"registry_item_id" uuid,
	"group_id" uuid,
	"title" text,
	"identification" text,
	"is_postcard" boolean DEFAULT false NOT NULL,
	"est_value" numeric(10, 2),
	"photo_url" text,
	"note" text,
	"prev_bin" text,
	"moved_at" timestamp,
	"delisted_at" timestamp,
	"added_by" text,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lot_pool" ADD CONSTRAINT "lot_pool_group_id_lot_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."lot_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lot_pool_draft_uq" ON "lot_pool" USING btree ("draft_id") WHERE "lot_pool"."draft_id" IS NOT NULL AND "lot_pool"."status" = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lot_pool_item_uq" ON "lot_pool" USING btree ("registry_item_id") WHERE "lot_pool"."registry_item_id" IS NOT NULL AND "lot_pool"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lot_pool_group_idx" ON "lot_pool" USING btree ("group_id");