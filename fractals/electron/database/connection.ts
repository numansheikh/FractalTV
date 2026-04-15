import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import * as schema from './schema'
import { G1C_SCHEMA_SQL, G1C_DROP_OLD_SQL } from './schema.g1c.sql'

const DB_NAME = process.env.FRACTALS_DB
  ? `fractals-${process.env.FRACTALS_DB}.db`
  : 'fractaltv.db'
const DB_DIR = join(app.getPath('userData'), 'data')
const DB_PATH = join(DB_DIR, DB_NAME)

let _db: ReturnType<typeof drizzle> | null = null
let _sqlite: Database.Database | null = null

export function getDb() {
  if (_db) return _db

  // Ensure the userData/data directory exists on first launch.
  mkdirSync(DB_DIR, { recursive: true })

  _sqlite = new Database(DB_PATH)

  // Performance pragmas
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('synchronous = normal')
  _sqlite.pragma('foreign_keys = ON')
  _sqlite.pragma('cache_size = -64000') // 64MB cache

  _db = drizzle(_sqlite, { schema })

  createTables(_sqlite)

  return _db
}

export function getSqlite() {
  if (!_sqlite) getDb()
  return _sqlite!
}

/**
 * g1c schema bootstrap. The old g1 12-table schema is detected via the
 * `streams` table (unique to g1) — if present, we drop it and rebuild fresh
 * on the new 15-table g1c schema. Per locked decision, user data is
 * expendable at this cutover — users re-sync from providers afterward.
 *
 * See `schema.g1c.sql.ts` for the DDL source of truth.
 */
function createTables(db: Database.Database) {
  // Detect g1 schema (streams table). If present, drop all old tables so
  // the CREATE IF NOT EXISTS statements below build the new g1c 15-table schema.
  const hasG1Streams = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='streams'`
  ).get()
  if (hasG1Streams) {
    console.log('[DB] g1 schema detected — dropping old tables for g1c migration')
    db.pragma('foreign_keys = OFF')
    try {
      db.exec(G1C_DROP_OLD_SQL)
    } finally {
      db.pragma('foreign_keys = ON')
    }
  }

  // g2: ensure `channels.iptv_org_id` exists on pre-existing dev DBs
  // BEFORE running G1C_SCHEMA_SQL — the schema's index on that column
  // would fail on an existing `channels` table lacking the column.
  addIptvOrgIdColumn(db)
  addNsfwColumns(db)

  db.exec(G1C_SCHEMA_SQL)

  // Drop FTS tables from older g1c builds — search is now plain LIKE on
  // `search_title`, FTS is gone.
  dropLegacyFtsTables(db)

  // Reset any sources stuck in 'syncing' from a previous crashed/killed run
  db.prepare(`UPDATE sources SET status = 'active' WHERE status = 'syncing'`).run()

  // Insert default profile if not exists
  db.prepare(`INSERT OR IGNORE INTO profiles (id, name) VALUES ('default', 'Default')`).run()
}

/** g2: add channels.iptv_org_id on pre-existing DBs. FK enforced via schema.sql. */
function addIptvOrgIdColumn(db: Database.Database) {
  const cols = db.prepare(`PRAGMA table_info(channels)`).all() as { name: string }[]
  if (!cols.length) return
  if (cols.some((c) => c.name === 'iptv_org_id')) return
  console.log('[DB] migrating: adding channels.iptv_org_id')
  db.exec(`ALTER TABLE channels ADD COLUMN iptv_org_id TEXT REFERENCES iptv_channels(id) ON DELETE SET NULL`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_channels_iptv_org_id ON channels(iptv_org_id)`)
}

/** Add is_nsfw column to category + content tables on pre-existing DBs. */
function addNsfwColumns(db: Database.Database) {
  const migrations: [string, string][] = [
    ['channel_categories', 'is_nsfw INTEGER NOT NULL DEFAULT 0'],
    ['movie_categories',   'is_nsfw INTEGER NOT NULL DEFAULT 0'],
    ['series_categories',  'is_nsfw INTEGER NOT NULL DEFAULT 0'],
    ['channels',           'is_nsfw INTEGER NOT NULL DEFAULT 0'],
    ['movies',             'is_nsfw INTEGER NOT NULL DEFAULT 0'],
    ['series',             'is_nsfw INTEGER NOT NULL DEFAULT 0'],
  ]
  for (const [table, colDef] of migrations) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!cols.length) continue
    if (cols.some((c) => c.name === 'is_nsfw')) continue
    console.log(`[DB] migrating: adding ${table}.is_nsfw`)
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`)
  }
}

/** One-shot cleanup: drop any leftover FTS virtual tables from earlier builds. */
function dropLegacyFtsTables(db: Database.Database) {
  for (const fts of ['channel_fts', 'movie_fts', 'series_fts']) {
    const row = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`
    ).get(fts)
    if (row) {
      console.log(`[DB] dropping legacy FTS table: ${fts}`)
      db.exec(`DROP TABLE ${fts}`)
    }
  }
}

/** Read a setting value. Returns null if not set. */
export function getSetting(key: string): string | null {
  if (!_sqlite) getDb()
  const row = _sqlite!.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

/** Write a setting value. */
export function setSetting(key: string, value: string): void {
  if (!_sqlite) getDb()
  _sqlite!.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

export function closeDb() {
  _sqlite?.close()
  _sqlite = null
  _db = null
}
