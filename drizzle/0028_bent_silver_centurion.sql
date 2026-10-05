ALTER TABLE "ebay_listings" ADD COLUMN "pkg_weight_oz" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD COLUMN "pkg_length_in" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD COLUMN "pkg_width_in" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD COLUMN "pkg_depth_in" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD COLUMN "pkg_irregular" boolean;--> statement-breakpoint
ALTER TABLE "tes_order_items" ADD COLUMN "weight_oz" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "tes_orders" ADD COLUMN "package_weight_oz" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "tes_orders" ADD COLUMN "ship_service" text;