CREATE TABLE IF NOT EXISTS "pinterest_boards" (
	"board_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"privacy" text,
	"pin_count" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pinterest_oauth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token_expires_at" timestamp NOT NULL,
	"refresh_token_expires_at" timestamp NOT NULL,
	"scope" text NOT NULL,
	"pinterest_username" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publer_accounts" (
	"account_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"picture_url" text,
	"mapped_to_channel" text,
	"last_synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_drafts" ADD COLUMN "source_url" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pinterest_boards_name_normalized_idx" ON "pinterest_boards" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pinterest_boards_is_default_idx" ON "pinterest_boards" USING btree ("is_default");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publer_accounts_provider_idx" ON "publer_accounts" USING btree ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publer_accounts_mapped_to_channel_idx" ON "publer_accounts" USING btree ("mapped_to_channel");