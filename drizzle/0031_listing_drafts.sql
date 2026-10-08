CREATE TABLE IF NOT EXISTS "draft_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" text,
	"storage_key" text NOT NULL,
	"url" text NOT NULL,
	"original_name" text,
	"sha256" text,
	"bytes" integer,
	"content_type" text NOT NULL,
	"uploaded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "draft_photos_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listing_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registry_item_id" uuid,
	"status" text DEFAULT 'uploading' NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"source_label" text,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"title_hint" text,
	"bin_sku" text,
	"weight_oz" numeric(8, 2),
	"quantity" integer DEFAULT 1 NOT NULL,
	"title" text,
	"description" text,
	"condition" text,
	"condition_note" text,
	"ebay_category_id" text,
	"ebay_category_name" text,
	"item_specifics" jsonb,
	"price" numeric(10, 2),
	"venue_prices" jsonb,
	"written_by" text,
	"review_note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draft_photos" ADD CONSTRAINT "draft_photos_draft_id_listing_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."listing_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_drafts" ADD CONSTRAINT "listing_drafts_registry_item_id_registry_items_id_fk" FOREIGN KEY ("registry_item_id") REFERENCES "public"."registry_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "draft_photos_draft_pos_uq" ON "draft_photos" USING btree ("draft_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listing_drafts_source_ref_uq" ON "listing_drafts" USING btree ("source","source_ref") WHERE "listing_drafts"."source_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_drafts_status_idx" ON "listing_drafts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_drafts_item_idx" ON "listing_drafts" USING btree ("registry_item_id");