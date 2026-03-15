-- Migration 0002: Email Delegations
-- Replaces connected_emails with cross-user email_delegations model

-- 1. Create email_delegations table
CREATE TABLE IF NOT EXISTS "email_delegations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "delegate_user_id" uuid NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp
);

-- 2. Create unique index on (owner, delegate)
CREATE UNIQUE INDEX IF NOT EXISTS "delegation_unique"
  ON "email_delegations" ("owner_user_id", "delegate_user_id");

-- 3. Add foreign keys
DO $$ BEGIN
  ALTER TABLE "email_delegations"
    ADD CONSTRAINT "email_delegations_owner_user_id_users_id_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "email_delegations"
    ADD CONSTRAINT "email_delegations_delegate_user_id_users_id_fk"
    FOREIGN KEY ("delegate_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Update key_email_access table
--    Drop old FK and column, add new columns

-- Add new columns (if not exists)
DO $$ BEGIN
  ALTER TABLE "key_email_access" ADD COLUMN "delegation_id" uuid;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "key_email_access" ADD COLUMN "target_email" text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Migrate existing key_email_access rows:
-- Look up the connected_email's google_email and set target_email
DO $$ BEGIN
  UPDATE "key_email_access" kea
  SET "target_email" = ce."google_email"
  FROM "connected_emails" ce
  WHERE kea."connected_email_id" = ce."id"
    AND kea."target_email" IS NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- For any rows without a target_email (shouldn't happen), set a placeholder
UPDATE "key_email_access"
SET "target_email" = 'unknown'
WHERE "target_email" IS NULL;

-- Make target_email NOT NULL
ALTER TABLE "key_email_access" ALTER COLUMN "target_email" SET NOT NULL;

-- Add FK for delegation_id
DO $$ BEGIN
  ALTER TABLE "key_email_access"
    ADD CONSTRAINT "key_email_access_delegation_id_email_delegations_id_fk"
    FOREIGN KEY ("delegation_id") REFERENCES "email_delegations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Drop old connected_email_id column (if exists)
ALTER TABLE "key_email_access" DROP COLUMN IF EXISTS "connected_email_id";

-- Drop old unique index and create new one
DROP INDEX IF EXISTS "key_email_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "key_email_unique"
  ON "key_email_access" ("proxy_key_id", "target_email");

-- 5. Drop connected_emails table (no longer needed)
DROP TABLE IF EXISTS "connected_emails";
