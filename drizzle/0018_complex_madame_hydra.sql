ALTER TABLE "ebay_listings" ADD COLUMN "last_wiggle_at" timestamp;--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD COLUMN "last_substantive_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_listings_last_wiggle_idx" ON "ebay_listings" USING btree ("last_wiggle_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_listings_last_substantive_idx" ON "ebay_listings" USING btree ("last_substantive_at");