CREATE TABLE IF NOT EXISTS "registry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"title" text NOT NULL,
	"title_normalized" text NOT NULL,
	"bin_sku" text,
	"category" text,
	"isbn" text,
	"pre_isbn" boolean DEFAULT false NOT NULL,
	"origin_country" text,
	"restricted_origin" boolean DEFAULT false NOT NULL,
	"nifty_item_ref" uuid,
	"nifty_id" text,
	"primary_ebay_item_id" text,
	"haul_post_slug" text,
	"sold_at" timestamp,
	"sold_on_venue" text,
	"created_from" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "registry_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"registry_item_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "venue_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registry_item_id" uuid NOT NULL,
	"venue" text NOT NULL,
	"venue_listing_id" text NOT NULL,
	"url" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"price" numeric(10, 2),
	"link_source" text NOT NULL,
	"link_confidence" text DEFAULT 'exact' NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "venue_status" (
	"venue" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"note" text,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "registry_review" ADD CONSTRAINT "registry_review_registry_item_id_registry_items_id_fk" FOREIGN KEY ("registry_item_id") REFERENCES "public"."registry_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "venue_listings" ADD CONSTRAINT "venue_listings_registry_item_id_registry_items_id_fk" FOREIGN KEY ("registry_item_id") REFERENCES "public"."registry_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "registry_items_nifty_ref_uq" ON "registry_items" USING btree ("nifty_item_ref") WHERE "registry_items"."nifty_item_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "registry_items_ebay_uq" ON "registry_items" USING btree ("primary_ebay_item_id") WHERE "registry_items"."primary_ebay_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registry_items_status_idx" ON "registry_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registry_items_bin_idx" ON "registry_items" USING btree ("bin_sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registry_items_title_norm_idx" ON "registry_items" USING btree ("title_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "registry_review_kind_item_uq" ON "registry_review" USING btree ("kind","registry_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registry_review_status_idx" ON "registry_review" USING btree ("status","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "venue_listings_venue_id_uq" ON "venue_listings" USING btree ("venue","venue_listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_listings_item_idx" ON "venue_listings" USING btree ("registry_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_listings_venue_status_idx" ON "venue_listings" USING btree ("venue","status");