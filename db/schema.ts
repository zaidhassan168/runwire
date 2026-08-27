import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ponytail: one document per user; split into relational tables when sharing or cross-workspace queries exist.
export const workspaces = sqliteTable('workspaces', {
  ownerId: text('owner_id').primaryKey(),
  stateJson: text('state_json').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
