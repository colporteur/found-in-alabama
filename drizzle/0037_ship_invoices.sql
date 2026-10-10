ALTER TABLE "ship_order_lines" ADD COLUMN "ebay_item_id" text;--> statement-breakpoint
ALTER TABLE "ship_order_lines" ADD COLUMN "venue_line_id" text;--> statement-breakpoint
ALTER TABLE "ship_orders" ADD COLUMN "order_total" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "ship_orders" ADD COLUMN "shipping_paid" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "ship_orders" ADD COLUMN "venue_fees" numeric(10, 2);