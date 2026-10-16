CREATE TABLE IF NOT EXISTS "coupon_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"ship_order_id" uuid,
	"venue" text,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"stripe_coupon_id" text,
	"stripe_promo_id" text,
	"redeemed_at" timestamp,
	"redeemed_order_id" uuid,
	CONSTRAINT "coupon_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "coupon_codes_ship_order_id_unique" UNIQUE("ship_order_id")
);
--> statement-breakpoint
ALTER TABLE "ship_orders" ADD COLUMN "discount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "tes_orders" ADD COLUMN "discount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "tes_orders" ADD COLUMN "coupon_code" text;