CREATE TABLE IF NOT EXISTS "ebay_oauth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token_expires_at" timestamp NOT NULL,
	"refresh_token_expires_at" timestamp NOT NULL,
	"scope" text NOT NULL,
	"ebay_username" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
