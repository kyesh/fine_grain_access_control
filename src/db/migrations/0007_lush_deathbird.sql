CREATE TABLE "approval_consumptions" (
	"jti" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"consumed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proxy_keys" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_consumptions" ADD CONSTRAINT "approval_consumptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;