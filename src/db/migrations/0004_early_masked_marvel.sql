ALTER TABLE "access_rules" ALTER COLUMN "regex_pattern" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "access_rules" ADD COLUMN "target_resource_id" text;--> statement-breakpoint
ALTER TABLE "access_rules" ADD COLUMN "resource_name" text;