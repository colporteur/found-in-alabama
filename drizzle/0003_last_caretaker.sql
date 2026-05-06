CREATE TABLE IF NOT EXISTS "ebay_sale_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid,
	"action" text NOT NULL,
	"success" boolean NOT NULL,
	"details" jsonb,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ebay_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_type" text NOT NULL,
	"ebay_promotion_id" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"discount_percent" numeric(5, 2),
	"min_spend_amount" numeric(10, 2),
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ebay_sale_audit_log" ADD CONSTRAINT "ebay_sale_audit_log_sale_id_ebay_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."ebay_sales"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_sales_status_idx" ON "ebay_sales" USING btree ("status");