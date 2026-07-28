CREATE TABLE IF NOT EXISTS "enhance_autoruns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"floor" numeric(10, 2) DEFAULT '0.99' NOT NULL,
	"min_days_between" integer DEFAULT 4 NOT NULL,
	"max_cycles" integer,
	"cycle_count" integer DEFAULT 0 NOT NULL,
	"cycle_started_at" timestamp DEFAULT now() NOT NULL,
	"total_wiggled" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"stopped_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD COLUMN "price_anchor" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD COLUMN "last_autorun_at" timestamp;--> statement-breakpoint
ALTER TABLE "enhance_batches" ADD COLUMN "low_priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enhance_autoruns_status_idx" ON "enhance_autoruns" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ebay_listings_last_autorun_idx" ON "ebay_listings" USING btree ("last_autorun_at");