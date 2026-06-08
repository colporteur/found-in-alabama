ALTER TABLE "items" ADD COLUMN "slug" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_slug_idx" ON "items" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_slug_unique" UNIQUE("slug");