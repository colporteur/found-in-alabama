CREATE TABLE IF NOT EXISTS "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid,
	"app" text NOT NULL,
	"step" text NOT NULL,
	"tier" text,
	"model" text NOT NULL,
	"resolved_model" text,
	"guides" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cost_usd" numeric(10, 6),
	"duration_ms" integer,
	"confidence" numeric(4, 3),
	"success" boolean DEFAULT true NOT NULL,
	"error" text,
	"output" jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD COLUMN "shipping_profile" text;--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD COLUMN "ai_meta" jsonb;--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD COLUMN "generation_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD COLUMN "generation_error" text;--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD COLUMN "approved_by" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_draft_id_listing_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."listing_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_runs_draft_idx" ON "ai_runs" USING btree ("draft_id","created_at");