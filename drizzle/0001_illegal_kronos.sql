CREATE TABLE IF NOT EXISTS "ebay_category_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"suggested_category_1_id" text,
	"suggested_category_2_id" text,
	"confidence" numeric(4, 3) NOT NULL,
	"reasoning" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ebay_listings" (
	"item_id" text PRIMARY KEY NOT NULL,
	"sku" text,
	"title" text NOT NULL,
	"primary_image_url" text,
	"store_category_1_id" text,
	"store_category_2_id" text,
	"site_category_id" text,
	"site_category_name" text,
	"listing_type" text,
	"quantity" integer,
	"price" numeric(10, 2),
	"description" text,
	"last_synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ebay_store_categories" (
	"category_id" text PRIMARY KEY NOT NULL,
	"parent_category_id" text,
	"name" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"is_alabama_related" boolean DEFAULT false NOT NULL,
	"is_other_bucket" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ebay_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"item_id" text,
	"success" boolean NOT NULL,
	"item_count" integer,
	"details" jsonb,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ebay_category_suggestions" ADD CONSTRAINT "ebay_category_suggestions_item_id_ebay_listings_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."ebay_listings"("item_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_category_suggestions_item_idx" ON "ebay_category_suggestions" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_category_suggestions_status_idx" ON "ebay_category_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_listings_store_cat1_idx" ON "ebay_listings" USING btree ("store_category_1_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_listings_store_cat2_idx" ON "ebay_listings" USING btree ("store_category_2_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_store_categories_parent_idx" ON "ebay_store_categories" USING btree ("parent_category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_store_categories_alabama_idx" ON "ebay_store_categories" USING btree ("is_alabama_related");