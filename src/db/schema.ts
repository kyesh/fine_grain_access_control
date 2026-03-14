import { pgTable, text, timestamp, uuid, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

// ─── Users ───────────────────────────────────────────────────────────────────
// Core user table. proxyKey removed — keys now live in proxy_keys table.
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  email: text('email').notNull(), // Primary Clerk email
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Proxy Keys ──────────────────────────────────────────────────────────────
// Multiple keys per user, each with a label and optional invalidation/TTL.
export const proxyKeys = pgTable('proxy_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  key: text('key').notNull().unique(), // "sk_proxy_xxx"
  label: text('label').notNull(), // "Claude Agent", "Work Bot"
  revokedAt: timestamp('revoked_at'), // NULL = active, set = revoked
  expiresAt: timestamp('expires_at'), // optional TTL
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Connected Emails ────────────────────────────────────────────────────────
// Tracks which Google accounts a user has connected via Clerk.
// No tokens stored here — Clerk is the token vault.
export const connectedEmails = pgTable('connected_emails', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  googleEmail: text('google_email').notNull(),
  label: text('label'), // "Personal", "Work", "School"
  clerkExternalAccountId: text('clerk_external_account_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Key ↔ Email Access ─────────────────────────────────────────────────────
// Join table: which proxy keys can access which connected emails.
// If a key has no rows here, it can access NO emails (deny by default).
export const keyEmailAccess = pgTable('key_email_access', {
  id: uuid('id').defaultRandom().primaryKey(),
  proxyKeyId: uuid('proxy_key_id').references(() => proxyKeys.id, { onDelete: 'cascade' }).notNull(),
  connectedEmailId: uuid('connected_email_id').references(() => connectedEmails.id, { onDelete: 'cascade' }).notNull(),
}, (table) => [
  uniqueIndex('key_email_unique').on(table.proxyKeyId, table.connectedEmailId),
]);

// ─── Access Rules ────────────────────────────────────────────────────────────
// Fine-grained access control rules. Scoped to a user, optionally to a specific email.
// Rules with no key_rule_assignments rows are GLOBAL (apply to all keys).
export const accessRules = pgTable('access_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  targetEmail: text('target_email'), // NULL = applies to all emails, or specific email address
  ruleName: text('rule_name').notNull(), // e.g., "Block Project X"
  service: text('service').notNull(), // 'gmail', 'drive', 'calendar'
  actionType: text('action_type').notNull(), // 'read_blacklist', 'send_whitelist', 'delete_whitelist'
  regexPattern: text('regex_pattern').notNull(), // e.g., "*@competitor.com" or "CONFIDENTIAL_PROJECT_X"
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Key ↔ Rule Assignments ─────────────────────────────────────────────────
// Join table: maps access rules to specific proxy keys.
// If a rule has NO rows here, it is a GLOBAL rule (applies to ALL keys for that user).
// If a rule has rows, it ONLY applies to those specific keys.
export const keyRuleAssignments = pgTable('key_rule_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  proxyKeyId: uuid('proxy_key_id').references(() => proxyKeys.id, { onDelete: 'cascade' }).notNull(),
  accessRuleId: uuid('access_rule_id').references(() => accessRules.id, { onDelete: 'cascade' }).notNull(),
}, (table) => [
  uniqueIndex('key_rule_unique').on(table.proxyKeyId, table.accessRuleId),
]);
