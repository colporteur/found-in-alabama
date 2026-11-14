CREATE TABLE IF NOT EXISTS "lot_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"plan_note" text,
	"planned_at" timestamp,
	"planned_by" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lot_build_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"no" integer NOT NULL,
	"name" text NOT NULL,
	"reason" text,
	"suggested_price" numeric(10, 2),
	"guide_id" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"lot_draft_id" uuid,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lot_build_pieces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"state" text DEFAULT 'sorting' NOT NULL,
	"identification" text,
	"est_value" numeric(10, 2),
	"verdict" text,
	"reason" text,
	"photo_request" text,
	"lot_no" integer,
	"locked" boolean DEFAULT false NOT NULL,
	"looked_at" timestamp,
	"photos_seen" integer DEFAULT 0 NOT NULL,
	"decided_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lot_build_lots" ADD CONSTRAINT "lot_build_lots_build_id_lot_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."lot_builds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lot_build_pieces" ADD CONSTRAINT "lot_build_pieces_build_id_lot_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."lot_builds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lot_builds_key_uq" ON "lot_builds" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lot_build_lots_no_uq" ON "lot_build_lots" USING btree ("build_id","no");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lot_build_pieces_n_uq" ON "lot_build_pieces" USING btree ("build_id","n");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lot_build_pieces_draft_uq" ON "lot_build_pieces" USING btree ("draft_id");
