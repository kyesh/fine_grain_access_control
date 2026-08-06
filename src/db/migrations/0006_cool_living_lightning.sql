CREATE TABLE "notification_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"target_email" text NOT NULL,
	"last_history_id" text,
	"watch_expires_at" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"clerk_oauth_app_id" text,
	"name" text NOT NULL,
	"logo_url" text,
	"manifest" jsonb NOT NULL,
	"manifest_version" integer DEFAULT 1 NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"webhook_url" text,
	"webhook_secret" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "partner_apps_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_error" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_connections" ADD COLUMN "partner_app_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_connections" ADD COLUMN "manifest_version" integer;--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_connection_id_agent_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."agent_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_notification_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."notification_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_connection_email_unique" ON "notification_subscriptions" USING btree ("connection_id","target_email");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_subscription_message_unique" ON "webhook_deliveries" USING btree ("subscription_id","message_id");--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_partner_app_id_partner_apps_id_fk" FOREIGN KEY ("partner_app_id") REFERENCES "public"."partner_apps"("id") ON DELETE set null ON UPDATE no action;