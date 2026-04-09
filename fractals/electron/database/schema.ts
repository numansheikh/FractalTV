import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─── Sources ────────────────────────────────────────────────────────────────
// Only this table is queried via Drizzle ORM. All other tables use raw SQLite
// via getSqlite() for performance (no ORM overhead on bulk inserts/searches).

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['xtream', 'm3u'] }).notNull(),
  name: text('name').notNull(),
  // Xtream fields
  serverUrl: text('server_url'),
  username: text('username'),
  password: text('password'),
  // M3U fields
  m3uUrl: text('m3u_url'),
  // Status
  status: text('status', { enum: ['active', 'error', 'syncing'] }).notNull().default('active'),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  lastSync: integer('last_sync', { mode: 'timestamp' }),
  lastError: text('last_error'),
  itemCount: integer('item_count').notNull().default(0),
  expDate: text('exp_date'),
  maxConnections: integer('max_connections'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

export type Source = typeof sources.$inferSelect
export type NewSource = typeof sources.$inferInsert
