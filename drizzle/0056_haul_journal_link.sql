ALTER TABLE "acquisitions" ADD COLUMN IF NOT EXISTS "post_slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acquisitions_post_slug_uq" ON "acquisitions" USING btree ("post_slug") WHERE "post_slug" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registry_items_haul_post_slug_idx" ON "registry_items" USING btree ("haul_post_slug");
