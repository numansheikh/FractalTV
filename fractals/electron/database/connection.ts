import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import * as schema from './schema'
import { normalizeForSearch } from '../lib/normalize'

const DB_NAME = process.env.FRACTALS_DB
  ? `fractals-${process.env.FRACTALS_DB}.db`
  : 'fractaltv.db'
const DB_DIR = join(app.getPath('userData'), 'data')
const DB_PATH = join(DB_DIR, DB_NAME)

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
  // V2 cutover migration — must run BEFORE CREATE TABLE statements
  // Drop old user_data (content_id PK) if it exists, then rename user_data_v2 → user_data
  try {
    const hasOldUD = db.prepare(`SELECT 1 FROM pragma_table_info('user_data') WHERE name = 'content_id'`).get()
    if (hasOldUD) db.exec(`DROP TABLE user_data`)
  } catch {}

  // Drop v1 tables (safe on fresh DBs — IF EXISTS)
  db.exec(`
    DROP TABLE IF EXISTS content_categories;
    DROP TABLE IF EXISTS content_sources;
    DROP TABLE IF EXISTS content_fts;
    DROP TABLE IF EXISTS content;
  `)

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
      canonical_id TEXT PRIMARY KEY REFERENCES canonical(id) ON DELETE CASCADE,
      vector BLOB NOT NULL,
      model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pin TEXT,
      is_child INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Settings: simple key-value store for app preferences
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- ── Canonical identity — deduplicated, persistent, source-independent ──

    CREATE TABLE IF NOT EXISTS canonical (
      id             TEXT PRIMARY KEY,
      type           TEXT NOT NULL,        -- 'channel' | 'movie' | 'series' | 'episode'
      title          TEXT NOT NULL,
      original_title TEXT,
      year           INTEGER,
      tmdb_id        INTEGER,
      tvg_id         TEXT,                 -- for channel EPG matching
      poster_path    TEXT,
      backdrop_path  TEXT,
      vote_average   REAL,
      rating_imdb    REAL,
      genres         TEXT,
      overview       TEXT,
      cast_json      TEXT,
      director       TEXT,
      keywords       TEXT,
      languages      TEXT,
      country        TEXT,
      runtime        INTEGER,
      enriched       INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER DEFAULT (unixepoch()),
      enriched_at    INTEGER
    );

    -- FTS5 on canonical — single search target, cross-language
    CREATE VIRTUAL TABLE IF NOT EXISTS canonical_fts USING fts5(
      canonical_id UNINDEXED,
      title,
      original_title,
      overview,
      cast_json,
      director,
      genres,
      keywords,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- ── Provider streams — ephemeral, cascades on source delete ────────────

    CREATE TABLE IF NOT EXISTS streams (
      id                    TEXT PRIMARY KEY,  -- '{sourceId}:{type}:{stream_id}'
      canonical_id          TEXT REFERENCES canonical(id) ON DELETE SET NULL,
      source_id             TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      type                  TEXT NOT NULL,     -- 'live' | 'movie' | 'series' | 'episode'
      stream_id             TEXT NOT NULL,
      title                 TEXT NOT NULL,
      category_id           TEXT,
      tvg_id                TEXT,
      thumbnail_url         TEXT,
      stream_url            TEXT,
      container_extension   TEXT,
      catchup_supported     INTEGER NOT NULL DEFAULT 0,
      catchup_days          INTEGER NOT NULL DEFAULT 0,
      epg_channel_id        TEXT,
      parent_canonical_id   TEXT REFERENCES canonical(id) ON DELETE CASCADE,
      season_number         INTEGER,
      episode_number        INTEGER,
      added_at              INTEGER DEFAULT (unixepoch())
    );

    -- Junction table: streams can belong to multiple categories
    CREATE TABLE IF NOT EXISTS stream_categories (
      stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (stream_id, category_id)
    );

    -- User data anchored to canonical — survives source deletion
    CREATE TABLE IF NOT EXISTS user_data (
      canonical_id    TEXT NOT NULL REFERENCES canonical(id) ON DELETE CASCADE,
      profile_id      TEXT NOT NULL DEFAULT 'default',
      is_favorite     INTEGER DEFAULT 0,
      fav_sort_order  INTEGER,
      is_watchlisted  INTEGER DEFAULT 0,
      rating          INTEGER,
      watch_position  INTEGER DEFAULT 0,
      watch_duration  INTEGER,
      last_watched_at INTEGER,
      completed       INTEGER DEFAULT 0,
      created_at      INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (canonical_id, profile_id)
    );

    -- Indexes (only columns guaranteed in original CREATE TABLE)
    CREATE INDEX IF NOT EXISTS idx_canonical_type     ON canonical(type);
    CREATE INDEX IF NOT EXISTS idx_canonical_tvg_id   ON canonical(tvg_id);
    CREATE INDEX IF NOT EXISTS idx_canonical_tmdb     ON canonical(tmdb_id);
    CREATE INDEX IF NOT EXISTS idx_streams_canonical  ON streams(canonical_id);
    CREATE INDEX IF NOT EXISTS idx_streams_source     ON streams(source_id);
    CREATE INDEX IF NOT EXISTS idx_streams_type       ON streams(type);
    CREATE INDEX IF NOT EXISTS idx_sc_category        ON stream_categories(category_id);
    CREATE INDEX IF NOT EXISTS idx_categories_name    ON categories(name, source_id, external_id);
    CREATE INDEX IF NOT EXISTS idx_epg_channel        ON epg(channel_external_id);
    CREATE INDEX IF NOT EXISTS idx_epg_time           ON epg(start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_ud_profile_fav     ON user_data(profile_id, is_favorite);
  `)

  // Migrations — safe to run on existing DBs (columns already in CREATE TABLE for fresh DBs)
  try { db.exec(`ALTER TABLE sources ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE sources ADD COLUMN exp_date TEXT`) } catch {}
  try { db.exec(`ALTER TABLE sources ADD COLUMN max_connections INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE sources ADD COLUMN subscription_type TEXT`) } catch {}
  try { db.exec(`ALTER TABLE sources ADD COLUMN last_epg_sync INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE sources ADD COLUMN color_index INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE categories ADD COLUMN content_synced INTEGER NOT NULL DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE categories ADD COLUMN position INTEGER NOT NULL DEFAULT 0`) } catch {}

  // Canonical table migrations (columns added during v2 cutover)
  try { db.exec(`ALTER TABLE canonical ADD COLUMN backdrop_path TEXT`) } catch {}
  try { db.exec(`ALTER TABLE canonical ADD COLUMN rating_imdb REAL`) } catch {}
  try { db.exec(`ALTER TABLE canonical ADD COLUMN genres TEXT`) } catch {}
  try { db.exec(`ALTER TABLE canonical ADD COLUMN overview TEXT`) } catch {}
  try { db.exec(`ALTER TABLE canonical ADD COLUMN cast_json TEXT`) } catch {}
  try { db.exec(`ALTER TABLE canonical ADD COLUMN director TEXT`) } catch {}
  try { db.exec(`ALTER TABLE canonical ADD COLUMN keywords TEXT`) } catch {}
  try { db.exec(`ALTER TABLE canonical ADD COLUMN languages TEXT`) } catch {}
  try { db.exec(`ALTER TABLE canonical ADD COLUMN country TEXT`) } catch {}
  try { db.exec(`ALTER TABLE canonical ADD COLUMN runtime INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE canonical ADD COLUMN enriched INTEGER NOT NULL DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE canonical ADD COLUMN enriched_at INTEGER`) } catch {}

  // Streams table migrations
  try { db.exec(`ALTER TABLE streams ADD COLUMN catchup_supported INTEGER NOT NULL DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE streams ADD COLUMN catchup_days INTEGER NOT NULL DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE streams ADD COLUMN epg_channel_id TEXT`) } catch {}
  try { db.exec(`ALTER TABLE streams ADD COLUMN parent_canonical_id TEXT REFERENCES canonical(id) ON DELETE CASCADE`) } catch {}
  try { db.exec(`ALTER TABLE streams ADD COLUMN season_number INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE streams ADD COLUMN episode_number INTEGER`) } catch {}

  // Indexes on migrated columns (must come after ALTER TABLEs above)
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_canonical_enriched ON canonical(enriched)`) } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_streams_source_type ON streams(source_id, type)`) } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_streams_category ON streams(category_id, source_id)`) } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_streams_epg ON streams(epg_channel_id)`) } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_streams_parent ON streams(parent_canonical_id)`) } catch {}


  // Migrate source color from settings table → sources.color_index
  try {
    const migrated = db.prepare(`SELECT value FROM settings WHERE key = 'migration_source_color_column'`).get() as any
    if (!migrated) {
      const colorRows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'source_color_%'`).all() as any[]
      const update = db.prepare(`UPDATE sources SET color_index = ? WHERE id = ?`)
      const upsert = db.transaction(() => {
        for (const row of colorRows) {
          const sourceId = row.key.replace('source_color_', '')
          update.run(parseInt(row.value), sourceId)
        }
        db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_source_color_column', '1')`).run()
      })
      upsert()
    }
  } catch (e) {
    console.error('[DB] source color migration failed:', e)
  }

  // Reset any sources stuck in 'syncing' from a previous crashed/killed run
  db.prepare(`UPDATE sources SET status = 'active' WHERE status = 'syncing'`).run()

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
  const done = (db.prepare('SELECT value FROM settings WHERE key = ?').get('fts_normalized_v2') as any)?.value
  if (done) return

  console.log('[FTS] Starting background index rebuild with Unicode normalization…')
  const rows = db.prepare(`SELECT id, title, original_title, overview, cast_json, director, genres, keywords FROM canonical`).all() as any[]
  db.exec(`DELETE FROM canonical_fts`)

  const ins = db.prepare(`INSERT INTO canonical_fts (canonical_id, title, original_title, overview, cast_json, director, genres, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  const BATCH = 500

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const writeBatch = db.transaction(() => {
      for (const r of chunk) {
        ins.run(r.id, normalizeForSearch(r.title ?? ''), normalizeForSearch(r.original_title ?? ''), normalizeForSearch(r.overview ?? ''), normalizeForSearch(r.cast_json ?? ''), normalizeForSearch(r.director ?? ''), normalizeForSearch(r.genres ?? ''), normalizeForSearch(r.keywords ?? ''))
      }
    })
    writeBatch()
    await new Promise(resolve => setImmediate(resolve))
  }

  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('fts_normalized_v2', '1')`).run()
  console.log(`[FTS] Rebuild complete — ${rows.length} rows normalized.`)
}

export function closeDb() {
  _sqlite?.close()
  _sqlite = null
  _db = null
}
