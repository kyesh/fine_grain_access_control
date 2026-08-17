-- Adopt legacy default profiles at deploy time (SQL mirror of
-- ensureDefaultProfile's adoption branch).
--
-- Pre-instant-start signups created keys labeled 'Default Profile' WITHOUT
-- is_default, and the runtime adoption only fires when a NEW MCP connection
-- resolves — users whose agents are already connected never trigger it, so
-- migration 0008's delegated-mailbox backfill silently skipped them and
-- createDelegation's sync no-ops for them. Flag the oldest live
-- 'Default Profile' key for every user row that has no flagged default yet,
-- then re-run the delegated-access backfill so the newly adopted keys pick up
-- their active delegations in the same deploy (0008 has already run by now).
-- Both statements are idempotent; migrations re-run on every build.
UPDATE "proxy_keys" SET "is_default" = true
WHERE "id" IN (
  SELECT DISTINCT ON (pk2."user_id") pk2."id"
  FROM "proxy_keys" pk2
  WHERE pk2."label" = 'Default Profile' AND pk2."revoked_at" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "proxy_keys" pk3
      WHERE pk3."user_id" = pk2."user_id"
        AND pk3."is_default" = true AND pk3."revoked_at" IS NULL
    )
  ORDER BY pk2."user_id", pk2."created_at" ASC
);
--> statement-breakpoint
INSERT INTO "key_email_access" ("proxy_key_id", "delegation_id", "target_email")
SELECT pk."id", d."id", owner_u."email"
FROM "email_delegations" d
JOIN "users" owner_u ON owner_u."id" = d."owner_user_id" AND owner_u."deleted_at" IS NULL
JOIN "users" delegate_u ON delegate_u."id" = d."delegate_user_id"
JOIN "users" delegate_rows ON lower(delegate_rows."email") = lower(delegate_u."email") AND delegate_rows."deleted_at" IS NULL
JOIN "proxy_keys" pk ON pk."user_id" = delegate_rows."id" AND pk."is_default" = true AND pk."revoked_at" IS NULL
WHERE d."status" = 'active'
ON CONFLICT ("proxy_key_id", "target_email") DO NOTHING;
