CREATE TABLE IF NOT EXISTS "connected_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"google_email" text NOT NULL,
	"label" text,
	"clerk_external_account_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "key_email_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proxy_key_id" uuid NOT NULL,
	"connected_email_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "key_rule_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proxy_key_id" uuid NOT NULL,
	"access_rule_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proxy_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"revoked_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proxy_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "access_rules" ADD COLUMN IF NOT EXISTS "target_email" text;
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "proxy_key";
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "connected_emails" ADD CONSTRAINT "connected_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "key_email_access" ADD CONSTRAINT "key_email_access_proxy_key_id_proxy_keys_id_fk" FOREIGN KEY ("proxy_key_id") REFERENCES "public"."proxy_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "key_email_access" ADD CONSTRAINT "key_email_access_connected_email_id_connected_emails_id_fk" FOREIGN KEY ("connected_email_id") REFERENCES "public"."connected_emails"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "key_rule_assignments" ADD CONSTRAINT "key_rule_assignments_proxy_key_id_proxy_keys_id_fk" FOREIGN KEY ("proxy_key_id") REFERENCES "public"."proxy_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "key_rule_assignments" ADD CONSTRAINT "key_rule_assignments_access_rule_id_access_rules_id_fk" FOREIGN KEY ("access_rule_id") REFERENCES "public"."access_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "proxy_keys" ADD CONSTRAINT "proxy_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "key_email_unique" ON "key_email_access" USING btree ("proxy_key_id","connected_email_id");
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "key_rule_unique" ON "key_rule_assignments" USING btree ("proxy_key_id","access_rule_id");
