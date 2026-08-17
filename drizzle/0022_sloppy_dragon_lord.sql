CREATE TABLE IF NOT EXISTS "tes_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"title" text NOT NULL,
	"sku" text,
	"unit_price" numeric(10, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"ship_class" text NOT NULL,
	"image_url" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tes_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_session_id" text,
	"stripe_payment_intent_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"email" text,
	"shipping_name" text,
	"shipping_address" jsonb,
	"subtotal" numeric(10, 2) NOT NULL,
	"shipping" numeric(10, 2) NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"governing_ship_class" text NOT NULL,
	"free_shipping" boolean DEFAULT false NOT NULL,
	"delist_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	CONSTRAINT "tes_orders_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tes_order_items" ADD CONSTRAINT "tes_order_items_order_id_tes_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."tes_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tes_order_items_order_idx" ON "tes_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tes_orders_status_idx" ON "tes_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tes_orders_delist_idx" ON "tes_orders" USING btree ("delist_status");