CREATE TABLE IF NOT EXISTS "email_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"local_part" text NOT NULL,
	"domain" text NOT NULL,
	"mode" text DEFAULT 'inbox' NOT NULL,
	"forward_to" text,
	"label" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"cf_rule_id" text,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"sync_error" text,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_addresses_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address_id" uuid,
	"to_address" text NOT NULL,
	"from_address" text,
	"from_name" text,
	"reply_to" text,
	"subject" text,
	"message_id_header" text,
	"sent_at" timestamp,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"text_body" text,
	"html_body" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_base64" text,
	"raw_size" integer,
	"truncated" boolean DEFAULT false NOT NULL,
	"forwarded_to" text,
	"read_at" timestamp,
	"archived_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_address_id_email_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."email_addresses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_addresses_domain_idx" ON "email_addresses" USING btree ("domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_messages_received_idx" ON "email_messages" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_messages_to_idx" ON "email_messages" USING btree ("to_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_messages_archived_idx" ON "email_messages" USING btree ("archived_at");