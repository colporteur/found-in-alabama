ALTER TABLE "items" ADD COLUMN "haul_post_slug" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "sold_at" timestamp;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "sold_on_marketplace" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_haul_post_slug_idx" ON "items" USING btree ("haul_post_slug");