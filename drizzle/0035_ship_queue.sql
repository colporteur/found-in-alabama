CREATE TABLE IF NOT EXISTS "ship_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sale_event_id" uuid,
	"registry_item_id" uuid,
	"title" text,
	"bin_sku" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price" numeric(10, 2),
	"image_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ship_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue" text NOT NULL,
	"order_key" text NOT NULL,
	"venue_order_id" text,
	"buyer_name" text,
	"buyer_username" text,
	"ship_to" jsonb,
	"sold_at" timestamp,
	"status" text DEFAULT 'to_pick' NOT NULL,
	"pick_printed_at" timestamp,
	"invoice_printed_at" timestamp,
	"packed_at" timestamp,
	"shipped_at" timestamp,
	"tracking_number" text,
	"carrier" text,
	"merged_into" uuid,
	"note" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ship_order_lines" ADD CONSTRAINT "ship_order_lines_order_id_ship_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."ship_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ship_order_lines" ADD CONSTRAINT "ship_order_lines_sale_event_id_sale_events_id_fk" FOREIGN KEY ("sale_event_id") REFERENCES "public"."sale_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ship_order_lines" ADD CONSTRAINT "ship_order_lines_registry_item_id_registry_items_id_fk" FOREIGN KEY ("registry_item_id") REFERENCES "public"."registry_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ship_order_lines_sale_uq" ON "ship_order_lines" USING btree ("sale_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ship_order_lines_order_idx" ON "ship_order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ship_orders_key_uq" ON "ship_orders" USING btree ("venue","order_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ship_orders_status_idx" ON "ship_orders" USING btree ("status","sold_at");