CREATE TABLE "email_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"delegate_user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "key_email_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proxy_key_id" uuid NOT NULL,
	"delegation_id" uuid,
	"target_email" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "key_rule_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proxy_key_id" uuid NOT NULL,
	"access_rule_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proxy_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"public_key" text,
	"label" text NOT NULL,
	"revoked_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proxy_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"num_accounts" text,
	"price_too_cheap" text,
	"price_bargain" text,
	"price_expensive" text,
	"price_too_expensive" text,
	"pricing_model_preference" text,
	"wants_beta" text,
	"agreed_to_interview" text,
	"agreed_to_beta_pricing" text,
	"comfortable_with_unverified_app" text,
	"status" text DEFAULT 'partial',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_proxy_key_unique";--> statement-breakpoint
ALTER TABLE "access_rules" ADD COLUMN "target_email" text;--> statement-breakpoint
ALTER TABLE "email_delegations" ADD CONSTRAINT "email_delegations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delegations" ADD CONSTRAINT "email_delegations_delegate_user_id_users_id_fk" FOREIGN KEY ("delegate_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_email_access" ADD CONSTRAINT "key_email_access_proxy_key_id_proxy_keys_id_fk" FOREIGN KEY ("proxy_key_id") REFERENCES "public"."proxy_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_email_access" ADD CONSTRAINT "key_email_access_delegation_id_email_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."email_delegations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_rule_assignments" ADD CONSTRAINT "key_rule_assignments_proxy_key_id_proxy_keys_id_fk" FOREIGN KEY ("proxy_key_id") REFERENCES "public"."proxy_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_rule_assignments" ADD CONSTRAINT "key_rule_assignments_access_rule_id_access_rules_id_fk" FOREIGN KEY ("access_rule_id") REFERENCES "public"."access_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_keys" ADD CONSTRAINT "proxy_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_unique" ON "email_delegations" USING btree ("owner_user_id","delegate_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "key_email_unique" ON "key_email_access" USING btree ("proxy_key_id","target_email");--> statement-breakpoint
CREATE UNIQUE INDEX "key_rule_unique" ON "key_rule_assignments" USING btree ("proxy_key_id","access_rule_id");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "proxy_key";