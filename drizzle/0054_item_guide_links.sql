CREATE TABLE IF NOT EXISTS "item_guide_links" (
	"registry_item_id" uuid PRIMARY KEY NOT NULL,
	"guide_id" text,
	"method" text DEFAULT 'keyword' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"alt_guide_id" text,
	"confident" boolean DEFAULT false NOT NULL,
	"linked_by" text,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "item_guide_links" ADD CONSTRAINT "item_guide_links_registry_item_id_registry_items_id_fk" FOREIGN KEY ("registry_item_id") REFERENCES "public"."registry_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_guide_links_guide_idx" ON "item_guide_links" USING btree ("guide_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_guide_links_review_idx" ON "item_guide_links" USING btree ("confident","method");
