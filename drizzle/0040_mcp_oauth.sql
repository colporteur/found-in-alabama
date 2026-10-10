CREATE TABLE IF NOT EXISTS "mcp_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"redirect_uris" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"code_challenge" text,
	"redirect_uri" text,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_tokens_grant_idx" ON "mcp_tokens" USING btree ("grant_id");