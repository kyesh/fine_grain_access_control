ALTER TABLE "proxy_keys" ADD COLUMN IF NOT EXISTS "public_key" text;
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_proxy_key_unique";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "proxy_key";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "waitlist" (
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
