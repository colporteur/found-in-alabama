ALTER TABLE "coupon_codes" ADD COLUMN "site" text;--> statement-breakpoint
ALTER TABLE "ebay_store_categories" ADD COLUMN "invoice_label" text;--> statement-breakpoint
ALTER TABLE "ebay_store_categories" ADD COLUMN "invoice_count_level" text DEFAULT 'self' NOT NULL;