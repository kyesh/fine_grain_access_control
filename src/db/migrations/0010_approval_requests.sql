CREATE TABLE "approval_requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"proxy_key_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_hash" text,
	"mint_count" integer DEFAULT 1 NOT NULL,
	"first_minted_at" timestamp DEFAULT now() NOT NULL,
	"last_minted_at" timestamp DEFAULT now() NOT NULL,
	"opened_at" timestamp,
	"approved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_proxy_key_id_proxy_keys_id_fk" FOREIGN KEY ("proxy_key_id") REFERENCES "public"."proxy_keys"("id") ON DELETE cascade ON UPDATE no action;