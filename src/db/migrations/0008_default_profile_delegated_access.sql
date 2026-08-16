-- Default Profile: auto-grant delegated mailboxes (data backfill + self-heal).
--
-- Materializes every ACTIVE delegation onto the delegate's live default
-- profile(s) as key_email_access rows carrying the delegation id, matching
-- what defaultProfile.ts / createDelegation now write at runtime. Migrations
-- re-run on every build, so this doubles as a per-deploy self-heal; it is
-- idempotent via ON CONFLICT DO NOTHING against key_email_unique.
--
-- Delegate user rows are matched by EMAIL, not by the delegation's user id:
-- duplicate users rows per email exist (see delegationQueries.ts), and the
-- live default key can hang off a different row than the delegation does.
-- Unflagged legacy 'Default Profile' keys are intentionally excluded here;
-- ensureDefaultProfile adopts and syncs them at their next new connection.
INSERT INTO "key_email_access" ("proxy_key_id", "delegation_id", "target_email")
SELECT pk."id", d."id", owner_u."email"
FROM "email_delegations" d
JOIN "users" owner_u ON owner_u."id" = d."owner_user_id" AND owner_u."deleted_at" IS NULL
JOIN "users" delegate_u ON delegate_u."id" = d."delegate_user_id"
JOIN "users" delegate_rows ON lower(delegate_rows."email") = lower(delegate_u."email") AND delegate_rows."deleted_at" IS NULL
JOIN "proxy_keys" pk ON pk."user_id" = delegate_rows."id" AND pk."is_default" = true AND pk."revoked_at" IS NULL
WHERE d."status" = 'active'
ON CONFLICT ("proxy_key_id", "target_email") DO NOTHING;
