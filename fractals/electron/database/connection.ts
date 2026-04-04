import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import * as schema from './schema'
import { normalizeForSearch } from '../lib/normalize'

const DB_DIR = join(app.getPath('userData'), 'data')
const DB_PATH = join(DB_DIR, 'fractals.db')

let _db: ReturnType<typeof drizzle> | null = null
let _sqlite: Database.Database | null = null

export function getDb() {
  if (_db) return _db

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

function createTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('xtream', 'm3u')),
      name TEXT NOT NULL,
      server_url TEXT,
      username TEXT,
      password TEXT,
      m3u_url TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'error', 'syncing')),
      disabled INTEGER NOT NULL DEFAULT 0,
      last_sync INTEGER,
      last_error TEXT,
      item_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('live', 'movie', 'series'))
    );

    CREATE TABLE IF NOT EXISTS content (
      id TEXT PRIMARY KEY,
      primary_source_id TEXT NOT NULL REFERENCES sources(id),
      external_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('live', 'movie', 'series', 'episode')),
      title TEXT NOT NULL,
      category_id TEXT,
      tmdb_id INTEGER,
      original_title TEXT,
      year INTEGER,
      plot TEXT,
      poster_url TEXT,
      backdrop_url TEXT,
      rating_imdb REAL,
      rating_tmdb REAL,
      genres TEXT,
      languages TEXT,
      country TEXT,
      director TEXT,
      cast TEXT,
      keywords TEXT,
      runtime INTEGER,
      parent_id TEXT REFERENCES content(id),
      season_number INTEGER,
      episode_number INTEGER,
      container_extension TEXT,
      catchup_supported INTEGER NOT NULL DEFAULT 0,
      catchup_days INTEGER NOT NULL DEFAULT 0,
      enriched INTEGER NOT NULL DEFAULT 0,
      enriched_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS content_sources (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      stream_url TEXT,
      quality TEXT,
      priority INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS epg (
      id TEXT PRIMARY KEY,
      channel_external_id TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      category TEXT
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      content_id TEXT PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
      vector BLOB NOT NULL,
      model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS user_data (
      content_id TEXT PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL DEFAULT 'default',
      favorite INTEGER NOT NULL DEFAULT 0,
      watchlist INTEGER NOT NULL DEFAULT 0,
      last_position INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      last_watched_at INTEGER,
      rating INTEGER
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pin TEXT,
      is_child INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- FTS5 virtual table for full-text search
    -- unicode61 with remove_diacritics=2 strips accents at index AND query time
    -- so "o" matches "ò ô œ ö ó ø" etc, "e" matches "é è ê ë", etc.
    CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
      content_id UNINDEXED,
      title,
      original_title,
      plot,
      cast,
      director,
      genres,
      keywords,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- Junction table: content can belong to multiple categories
    CREATE TABLE IF NOT EXISTS content_categories (
      content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (content_id, category_id)
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_cc_category ON content_categories(category_id);
    CREATE INDEX IF NOT EXISTS idx_content_type ON content(type);
    CREATE INDEX IF NOT EXISTS idx_content_tmdb ON content(tmdb_id);
    CREATE INDEX IF NOT EXISTS idx_content_enriched ON content(enriched);
    CREATE INDEX IF NOT EXISTS idx_content_source ON content(primary_source_id);
    CREATE INDEX IF NOT EXISTS idx_content_category ON content(category_id, primary_source_id);
    CREATE INDEX IF NOT EXISTS idx_content_updated ON content(updated_at);
    CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name, source_id, external_id);
    CREATE INDEX IF NOT EXISTS idx_content_sources_content ON content_sources(content_id);
    CREATE INDEX IF NOT EXISTS idx_content_sources_source ON content_sources(source_id);
    CREATE INDEX IF NOT EXISTS idx_epg_channel ON epg(channel_external_id);
    CREATE INDEX IF NOT EXISTS idx_epg_time ON epg(start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_user_data_profile ON user_data(profile_id);

    -- Settings: simple key-value store for app preferences
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Migrations — safe to run on existing DBs
  try { db.exec(`ALTER TABLE sources ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE sources ADD COLUMN exp_date TEXT`) } catch {}
  try { db.exec(`ALTER TABLE sources ADD COLUMN max_connections INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE sources ADD COLUMN subscription_type TEXT`) } catch {}
  // content_synced: 0 = not yet fetched, 1 = fetched
  try { db.exec(`ALTER TABLE categories ADD COLUMN content_synced INTEGER NOT NULL DEFAULT 0`) } catch {}
  // position: order as returned by the provider API (0-based index)
  try { db.exec(`ALTER TABLE categories ADD COLUMN position INTEGER NOT NULL DEFAULT 0`) } catch {}

  // Migration: content IDs changed from `movie:{id}` to `{sourceId}:movie:{id}`
  // Clear content data so re-sync creates fresh rows. Sources/settings preserved.
  try {
    const migrated = db.prepare(`SELECT value FROM settings WHERE key = 'migration_source_scoped_ids'`).get() as any
    console.log('[DB] Migration check: migrated =', migrated)
    if (!migrated) {
      console.log('[DB] Running migration: clearing content for source-scoped IDs...')
      db.exec(`
        DELETE FROM content_categories;
        DELETE FROM content_sources;
        DELETE FROM embeddings;
        DELETE FROM user_data;
        DELETE FROM content;
        DELETE FROM content_fts;
        UPDATE sources SET item_count = 0, status = 'active';
        UPDATE categories SET content_synced = 0;
        INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_source_scoped_ids', '1');
      `)
      console.log('[DB] Migration complete. Re-sync required.')
    }
  } catch (e) {
    console.error('[DB] Migration FAILED:', e)
  }

  // Insert default profile if not exists
  db.prepare(`
    INSERT OR IGNORE INTO profiles (id, name) VALUES ('default', 'Default')
  `).run()

  // Seed TMDB key if not already set
  db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('tmdb_api_key', '6b1134d6382480dbbecad0055d5ab2e4')
  `).run()
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

/**
 * Rebuild the FTS index with anyAscii normalization if not already done.
 * Runs in the background after startup — batches 500 rows at a time and yields
 * between batches so the main process stays responsive.
 */
export async function rebuildFtsIfNeeded(): Promise<void> {
  if (!_sqlite) return
  const db = _sqlite
  const done = (db.prepare('SELECT value FROM settings WHERE key = ?').get('fts_normalized_v1') as any)?.value
  if (done) return

  console.log('[FTS] Starting background index rebuild with Unicode normalization…')
  const rows = db.prepare(`SELECT id, title, original_title, plot, "cast", director, genres, keywords FROM content`).all() as any[]
  db.exec(`DELETE FROM content_fts`)

  const ins = db.prepare(`INSERT INTO content_fts (content_id, title, original_title, plot, "cast", director, genres, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  const BATCH = 500

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const writeBatch = db.transaction(() => {
      for (const r of chunk) {
        ins.run(r.id, normalizeForSearch(r.title ?? ''), normalizeForSearch(r.original_title ?? ''), normalizeForSearch(r.plot ?? ''), normalizeForSearch(r.cast ?? ''), normalizeForSearch(r.director ?? ''), normalizeForSearch(r.genres ?? ''), normalizeForSearch(r.keywords ?? ''))
      }
    })
    writeBatch()
    // Yield to event loop between batches so the main process stays responsive
    await new Promise(resolve => setImmediate(resolve))
  }

  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('fts_normalized_v1', '1')`).run()
  console.log(`[FTS] Rebuild complete — ${rows.length} rows normalized.`)
}

export function closeDb() {
  _sqlite?.close()
  _sqlite = null
  _db = null
}
