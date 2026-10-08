ALTER TABLE "listing_drafts" ADD COLUMN "store_category_ids" jsonb;--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD COLUMN "nifty_item_id" text;--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD COLUMN "nifty_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD COLUMN "nifty_error" text;--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD COLUMN "nifty_warnings" jsonb;