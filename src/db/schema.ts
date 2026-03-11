import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const accessRules = pgTable('access_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  ruleName: text('rule_name').notNull(), // e.g., "Block Project X"
  service: text('service').notNull(), // 'gmail', 'drive', 'calendar'
  actionType: text('action_type').notNull(), // 'read_blacklist', 'send_whitelist', 'delete_whitelist'
  regexPattern: text('regex_pattern').notNull(), // e.g., "*@competitor.com" or "CONFIDENTIAL_PROJECT_X"
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
