ALTER TABLE "tes_orders" ADD COLUMN "pirate_exported_at" timestamp;--> statement-breakpoint
ALTER TABLE "tes_orders" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "tes_orders" ADD COLUMN "carrier" text;--> statement-breakpoint
ALTER TABLE "tes_orders" ADD COLUMN "shipped_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tes_orders_shipped_idx" ON "tes_orders" USING btree ("shipped_at");