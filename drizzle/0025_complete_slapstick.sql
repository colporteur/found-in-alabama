CREATE TABLE IF NOT EXISTS "hip_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"hip_sale_id" integer,
	"hip_listing_id" integer,
	"item_id" text,
	"ok" boolean NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hip_listings" (
	"hip_id" integer PRIMARY KEY NOT NULL,
	"external_id" text,
	"external_id_type" text,
	"private_id" text,
	"title" text NOT NULL,
	"price" numeric(10, 2),
	"quantity" integer,
	"active" boolean DEFAULT true NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"url" text,
	"hip_updated_at" timestamp,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hip_sales" (
	"hip_sale_id" integer PRIMARY KEY NOT NULL,
	"buyer_username" text,
	"buyer_email" text,
	"total" numeric(10, 2),
	"hip_created_at" timestamp,
	"decision" text DEFAULT 'processing' NOT NULL,
	"reason" text,
	"lines" jsonb,
	"tes_order_id" uuid,
	"handled_at" timestamp,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD COLUMN "shipping_profile_id" text;--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD COLUMN "shipping_profile_name" text;--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD COLUMN "shipping_services" jsonb;--> statement-breakpoint
ALTER TABLE "tes_orders" ADD COLUMN "source" text DEFAULT 'tes' NOT NULL;--> statement-breakpoint
ALTER TABLE "tes_orders" ADD COLUMN "hip_sale_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hip_sales" ADD CONSTRAINT "hip_sales_tes_order_id_tes_orders_id_fk" FOREIGN KEY ("tes_order_id") REFERENCES "public"."tes_orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hip_actions_created_idx" ON "hip_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hip_actions_item_idx" ON "hip_actions" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hip_listings_external_idx" ON "hip_listings" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hip_listings_active_idx" ON "hip_listings" USING btree ("active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hip_sales_decision_idx" ON "hip_sales" USING btree ("decision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tes_orders_source_idx" ON "tes_orders" USING btree ("source");