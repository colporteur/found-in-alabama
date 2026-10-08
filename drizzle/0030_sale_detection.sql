CREATE TABLE IF NOT EXISTS "delist_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_event_id" uuid NOT NULL,
	"registry_item_id" uuid,
	"venue" text NOT NULL,
	"venue_listing_id" text NOT NULL,
	"planned_action" text NOT NULL,
	"planned_at" timestamp DEFAULT now() NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"outcome_at" timestamp,
	"evidence" jsonb,
	"checked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nifty_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"title_normalized" text,
	"sold_venue" text,
	"failed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"venue" text,
	"registry_item_id" uuid,
	"received_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nifty_alerts_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_email_scans" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"result" text NOT NULL,
	"detail" text,
	"scanned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"line" integer DEFAULT 0 NOT NULL,
	"venue" text NOT NULL,
	"venue_listing_id" text,
	"ebay_item_id" text,
	"title" text,
	"title_truncated" boolean DEFAULT false NOT NULL,
	"price" numeric(10, 2),
	"order_ref" text,
	"sold_at" timestamp,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"registry_item_id" uuid,
	"match_method" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"flag" text,
	"candidates" jsonb,
	"duplicate_of" uuid,
	"planned_at" timestamp,
	"resolved_by" text,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delist_plans" ADD CONSTRAINT "delist_plans_sale_event_id_sale_events_id_fk" FOREIGN KEY ("sale_event_id") REFERENCES "public"."sale_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delist_plans" ADD CONSTRAINT "delist_plans_registry_item_id_registry_items_id_fk" FOREIGN KEY ("registry_item_id") REFERENCES "public"."registry_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nifty_alerts" ADD CONSTRAINT "nifty_alerts_message_id_email_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nifty_alerts" ADD CONSTRAINT "nifty_alerts_registry_item_id_registry_items_id_fk" FOREIGN KEY ("registry_item_id") REFERENCES "public"."registry_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_email_scans" ADD CONSTRAINT "sale_email_scans_message_id_email_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_events" ADD CONSTRAINT "sale_events_registry_item_id_registry_items_id_fk" FOREIGN KEY ("registry_item_id") REFERENCES "public"."registry_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delist_plans_leg_uq" ON "delist_plans" USING btree ("sale_event_id","venue","venue_listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delist_plans_outcome_idx" ON "delist_plans" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delist_plans_venue_id_idx" ON "delist_plans" USING btree ("venue","venue_listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nifty_alerts_received_idx" ON "nifty_alerts" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nifty_alerts_title_idx" ON "nifty_alerts" USING btree ("title_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sale_events_source_uq" ON "sale_events" USING btree ("source","source_ref","line");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_events_status_idx" ON "sale_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_events_item_idx" ON "sale_events" USING btree ("registry_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_events_detected_idx" ON "sale_events" USING btree ("detected_at");