CREATE TABLE IF NOT EXISTS "acquisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"acquired_on" date,
	"kind" text,
	"total_cost" numeric(10, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registry_items" ADD COLUMN "acquisition_id" uuid;--> statement-breakpoint
ALTER TABLE "registry_items" ADD COLUMN "unit_cost" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "ship_orders" ADD COLUMN "shipping_cost" numeric(10, 2);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "registry_items" ADD CONSTRAINT "registry_items_acquisition_id_acquisitions_id_fk" FOREIGN KEY ("acquisition_id") REFERENCES "public"."acquisitions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registry_items_acquisition_idx" ON "registry_items" USING btree ("acquisition_id");