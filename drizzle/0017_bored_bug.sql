CREATE TABLE IF NOT EXISTS "ai_call_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"op" text NOT NULL,
	"batch_id" uuid,
	"job_id" uuid,
	"category" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"request_count" integer DEFAULT 1 NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"duration_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_model_pricing" (
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_per_mtok" numeric(10, 4),
	"output_per_mtok" numeric(10, 4),
	"cache_read_per_mtok" numeric(10, 4),
	"cache_write_per_mtok" numeric(10, 4),
	"per_request_usd" numeric(10, 6),
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_pricing_provider_model_pk" PRIMARY KEY("provider","model")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enhance_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"op" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_override" text,
	"total_jobs" integer DEFAULT 0 NOT NULL,
	"completed_jobs" integer DEFAULT 0 NOT NULL,
	"failed_jobs" integer DEFAULT 0 NOT NULL,
	"skipped_jobs" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(10, 4),
	"actual_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enhance_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"ebay_item_id" text NOT NULL,
	"sku" text,
	"title" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"result" jsonb,
	"rolled_back" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_log" ADD CONSTRAINT "ai_call_log_batch_id_enhance_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."enhance_batches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_log" ADD CONSTRAINT "ai_call_log_job_id_enhance_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."enhance_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enhance_jobs" ADD CONSTRAINT "enhance_jobs_batch_id_enhance_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."enhance_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_call_log_created_at_idx" ON "ai_call_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_call_log_op_idx" ON "ai_call_log" USING btree ("op");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_call_log_provider_model_idx" ON "ai_call_log" USING btree ("provider","model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_call_log_batch_idx" ON "ai_call_log" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enhance_batches_status_idx" ON "enhance_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enhance_batches_created_at_idx" ON "enhance_batches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enhance_jobs_batch_idx" ON "enhance_jobs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enhance_jobs_status_idx" ON "enhance_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enhance_jobs_batch_status_idx" ON "enhance_jobs" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enhance_jobs_item_idx" ON "enhance_jobs" USING btree ("ebay_item_id");