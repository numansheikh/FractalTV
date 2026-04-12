import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, renameSync, existsSync } from 'fs'
import * as schema from './schema'

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

  // V3 cutover: if an existing DB is on the V2 schema (has a `canonical` table
  // with a TEXT id column and rich-meta fields), rename it aside and start fresh.
  // Data is considered expendable at V3 cutover — user re-imports sources.
  // A timestamped rename is used (not delete) as a last-resort safety net on top
  // of the backup that was taken before the cutover.
  if (existsSync(DB_PATH)) {
    try {
      const probe = new Database(DB_PATH, { readonly: true })
      const isV2 = probe.prepare(
        `SELECT 1 FROM pragma_table_info('canonical') WHERE name = 'tmdb_id'`
      ).get()
      probe.close()
      if (isV2) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const aside = `${DB_PATH}.v2-${stamp}`
        console.log(`[DB] V2 schema detected — renaming aside to ${aside}`)
        renameSync(DB_PATH, aside)
        // Also rename WAL/SHM if present so they don't attach to the new DB
        for (const ext of ['-wal', '-shm']) {
          if (existsSync(DB_PATH + ext)) {
            try { renameSync(DB_PATH + ext, aside + ext) } catch {}
          }
        }
      }
    } catch (e) {
      console.warn('[DB] V2 probe failed (likely corrupt or inaccessible):', e)
    }
  }

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
 * V3 schema — single source of truth. Raw SQL for performance (only `sources`
 * is queried through Drizzle). See `fractals/docs/data-search-v3-plan.md` for
 * the full design rationale (L1–L14 locked decisions).
 */
function createTables(db: Database.Database) {
  db.exec(`
    -- ─── Provider metadata (untouched from V2) ────────────────────────

    CREATE TABLE IF NOT EXISTS sources (
      id                TEXT PRIMARY KEY,
      type              TEXT NOT NULL CHECK(type IN ('xtream', 'm3u')),
      name              TEXT NOT NULL,
      server_url        TEXT,
      username          TEXT,
      password          TEXT,
      m3u_url           TEXT,
      status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'error', 'syncing')),
      disabled          INTEGER NOT NULL DEFAULT 0,
      last_sync         INTEGER,
      last_error        TEXT,
      item_count        INTEGER NOT NULL DEFAULT 0,
      exp_date          TEXT,
      max_connections   INTEGER,
      subscription_type TEXT,
      last_epg_sync     INTEGER,
      color_index       INTEGER,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS categories (
      id              TEXT PRIMARY KEY,
      source_id       TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      external_id     TEXT NOT NULL,
      name            TEXT NOT NULL,
      type            TEXT NOT NULL CHECK(type IN ('live', 'movie', 'series')),
      content_synced  INTEGER NOT NULL DEFAULT 0,
      position        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS epg (
      id                  TEXT PRIMARY KEY,
      channel_external_id TEXT NOT NULL,
      source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      title               TEXT NOT NULL,
      description         TEXT,
      start_time          INTEGER NOT NULL,
      end_time            INTEGER NOT NULL,
      category            TEXT
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      pin         TEXT,
      is_child    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- ─── Streams (raw provider inventory + normalizer hints) ────────────
    -- g1 tier: no canonical tables, no polymorphic FKs. Streams are the
    -- primary content entity. Episodes link to series_sources via parent_series_id.

    CREATE TABLE IF NOT EXISTS streams (
      id                    TEXT PRIMARY KEY,              -- '{sourceId}:{type}:{stream_id}'
      source_id             TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      type                  TEXT NOT NULL CHECK(type IN ('live', 'movie', 'episode')),
      stream_id             TEXT NOT NULL,                 -- provider's raw id

      -- Provider-raw fields
      title                 TEXT NOT NULL,
      thumbnail_url         TEXT,
      stream_url            TEXT,
      container_extension   TEXT,
      category_id           TEXT,
      tvg_id                TEXT,
      epg_channel_id        TEXT,
      catchup_supported     INTEGER NOT NULL DEFAULT 0,
      catchup_days          INTEGER NOT NULL DEFAULT 0,
      provider_metadata     TEXT,                          -- JSON bag for extras

      -- Normalizer outputs (derived at sync time)
      language_hint         TEXT,
      origin_hint           TEXT,
      quality_hint          TEXT,
      year_hint             INTEGER,

      -- Episode → parent series link (NULL for non-episodes)
      parent_series_id      TEXT REFERENCES series_sources(id) ON DELETE SET NULL,

      added_at              INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS stream_categories (
      stream_id    TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
      category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (stream_id, category_id)
    );

    -- Series parents — not playable streams.
    CREATE TABLE IF NOT EXISTS series_sources (
      id                  TEXT PRIMARY KEY,              -- '{sourceId}:series:{series_id}'
      source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      series_external_id  TEXT NOT NULL,
      title               TEXT NOT NULL,
      thumbnail_url       TEXT,
      category_id         TEXT,
      language_hint       TEXT,
      origin_hint         TEXT,
      quality_hint        TEXT,
      year_hint           INTEGER,
      added_at            INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS series_source_categories (
      series_source_id TEXT NOT NULL REFERENCES series_sources(id) ON DELETE CASCADE,
      category_id      TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (series_source_id, category_id)
    );

    -- ─── User data ───────────────────────────────────────────────────
    -- g1: all user data keyed by stream/series_source ID (no canonical layer).

    CREATE TABLE IF NOT EXISTS stream_user_data (
      profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      stream_id         TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
      is_favorite       INTEGER NOT NULL DEFAULT 0,
      is_watchlisted    INTEGER NOT NULL DEFAULT 0,
      rating            INTEGER,
      fav_sort_order    INTEGER,
      watch_position    INTEGER NOT NULL DEFAULT 0,
      watch_duration    INTEGER,
      last_watched_at   INTEGER,
      completed         INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (profile_id, stream_id)
    );

    CREATE TABLE IF NOT EXISTS series_user_data (
      profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      series_source_id  TEXT NOT NULL REFERENCES series_sources(id) ON DELETE CASCADE,
      is_favorite       INTEGER NOT NULL DEFAULT 0,
      is_watchlisted    INTEGER NOT NULL DEFAULT 0,
      rating            INTEGER,
      fav_sort_order    INTEGER,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (profile_id, series_source_id)
    );

    CREATE TABLE IF NOT EXISTS channel_user_data (
      profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      stream_id         TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
      is_favorite       INTEGER NOT NULL DEFAULT 0,
      fav_sort_order    INTEGER,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (profile_id, stream_id)
    );

    -- ─── Indexes ──────────────────────────────────────────────────────

    -- Streams access patterns
    CREATE INDEX IF NOT EXISTS idx_streams_source          ON streams(source_id);
    CREATE INDEX IF NOT EXISTS idx_streams_type            ON streams(type);
    CREATE INDEX IF NOT EXISTS idx_streams_source_type     ON streams(source_id, type);
    CREATE INDEX IF NOT EXISTS idx_streams_category        ON streams(category_id, source_id);
    CREATE INDEX IF NOT EXISTS idx_streams_epg             ON streams(epg_channel_id);
    CREATE INDEX IF NOT EXISTS idx_streams_parent_series   ON streams(parent_series_id);

    CREATE INDEX IF NOT EXISTS idx_series_sources_source   ON series_sources(source_id);
    CREATE INDEX IF NOT EXISTS idx_series_sources_category ON series_sources(category_id, source_id);

    -- Categories + EPG
    CREATE INDEX IF NOT EXISTS idx_sc_category             ON stream_categories(category_id);
    CREATE INDEX IF NOT EXISTS idx_categories_name         ON categories(name, source_id, external_id);
    CREATE INDEX IF NOT EXISTS idx_epg_channel             ON epg(channel_external_id);
    CREATE INDEX IF NOT EXISTS idx_epg_time                ON epg(start_time, end_time);

    -- User data access patterns
    CREATE INDEX IF NOT EXISTS idx_stream_ud_favorites     ON stream_user_data(profile_id, is_favorite);
    CREATE INDEX IF NOT EXISTS idx_stream_ud_watchlist     ON stream_user_data(profile_id, is_watchlisted);
    CREATE INDEX IF NOT EXISTS idx_stream_ud_recent        ON stream_user_data(profile_id, last_watched_at);
    CREATE INDEX IF NOT EXISTS idx_series_ud_favorites     ON series_user_data(profile_id, is_favorite);
    CREATE INDEX IF NOT EXISTS idx_series_ud_watchlist     ON series_user_data(profile_id, is_watchlisted);
    CREATE INDEX IF NOT EXISTS idx_channel_ud_favorites    ON channel_user_data(profile_id, is_favorite);
  `)

  // Reset any sources stuck in 'syncing' from a previous crashed/killed run
  db.prepare(`UPDATE sources SET status = 'active' WHERE status = 'syncing'`).run()

  // Insert default profile if not exists
  db.prepare(`INSERT OR IGNORE INTO profiles (id, name) VALUES ('default', 'Default')`).run()
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

/** No-op stub — FTS rebuild deferred to g2 tier. */
export async function rebuildFtsIfNeeded(): Promise<void> {
  return
}

export function closeDb() {
  _sqlite?.close()
  _sqlite = null
  _db = null
}
