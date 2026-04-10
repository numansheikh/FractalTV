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

    -- ─── Canonical identity (V3 — per-type tables) ────────────────────
    -- INTEGER PKs (L11). content_hash is a unique lookup index, not PK.
    -- Oracle columns are nullable; populated by the enrichment worker (Phase C).

    CREATE TABLE IF NOT EXISTS canonical_vod (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_title      TEXT NOT NULL,
      year                  INTEGER,
      content_hash          TEXT NOT NULL UNIQUE,
      imdb_id               TEXT,
      tmdb_id               INTEGER,
      wikidata_qid          TEXT,
      multilingual_labels   TEXT,                          -- JSON
      poster_url            TEXT,
      thumbnail_url         TEXT,
      poster_w              INTEGER,
      poster_h              INTEGER,
      oracle_status         TEXT NOT NULL DEFAULT 'pending' CHECK(oracle_status IN ('pending','resolved','no_match','failed')),
      oracle_version        INTEGER NOT NULL DEFAULT 0,
      oracle_attempted_at   INTEGER,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS canonical_series (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_title      TEXT NOT NULL,
      year                  INTEGER,                       -- series start year
      content_hash          TEXT NOT NULL UNIQUE,
      imdb_id               TEXT,
      tmdb_id               INTEGER,
      wikidata_qid          TEXT,
      multilingual_labels   TEXT,
      poster_url            TEXT,
      thumbnail_url         TEXT,
      poster_w              INTEGER,
      poster_h              INTEGER,
      oracle_status         TEXT NOT NULL DEFAULT 'pending' CHECK(oracle_status IN ('pending','resolved','no_match','failed')),
      oracle_version        INTEGER NOT NULL DEFAULT 0,
      oracle_attempted_at   INTEGER,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Episodes as first-class entities (Q3). Per-episode enrichment is
    -- deferred to a Phase C sub-phase — imdb_id/plot/air_date stay NULL until then.
    CREATE TABLE IF NOT EXISTS episodes (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_series_id   INTEGER NOT NULL REFERENCES canonical_series(id) ON DELETE CASCADE,
      season                INTEGER NOT NULL,
      episode               INTEGER NOT NULL,
      title                 TEXT,
      air_date              TEXT,
      imdb_id               TEXT,
      plot                  TEXT,
      oracle_status         TEXT NOT NULL DEFAULT 'pending',
      created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(canonical_series_id, season, episode)
    );

    CREATE TABLE IF NOT EXISTS canonical_live (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name        TEXT NOT NULL,
      iptv_org_id           TEXT,                          -- e.g. 'BBCOne.uk'
      country               TEXT,                          -- ISO code
      languages             TEXT,                          -- JSON array of ISO codes
      categories            TEXT,                          -- JSON array of iptv-org taxonomy
      network               TEXT,
      owners                TEXT,                          -- JSON array
      logo_url              TEXT,
      is_nsfw               INTEGER NOT NULL DEFAULT 0,
      broadcast_area        TEXT,
      content_hash          TEXT NOT NULL UNIQUE,          -- sha1(iptv_org_id) or sha1(name+country+network)
      oracle_status         TEXT NOT NULL DEFAULT 'pending' CHECK(oracle_status IN ('pending','resolved','no_match','failed')),
      oracle_version        INTEGER NOT NULL DEFAULT 0,
      oracle_attempted_at   INTEGER,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ─── FTS5 per-type (L4 basic mode fast path) ──────────────────────

    CREATE VIRTUAL TABLE IF NOT EXISTS canonical_vod_fts USING fts5(
      canonical_id UNINDEXED,
      normalized_title,
      multilingual_labels,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS canonical_series_fts USING fts5(
      canonical_id UNINDEXED,
      normalized_title,
      multilingual_labels,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS canonical_live_fts USING fts5(
      canonical_id UNINDEXED,
      canonical_name,
      categories,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- ─── Streams (raw provider inventory + L14 hints + polymorphic FK) ─
    -- Single-table design (associations merged into streams — no JOIN on the
    -- canonical→display path). Polymorphic FK: exactly one of canonical_vod_id,
    -- episode_id, canonical_live_id must be set (or all null = unmatched).
    -- The CHECK constraint ties the polymorphism to the type discriminator.

    CREATE TABLE IF NOT EXISTS streams (
      id                    TEXT PRIMARY KEY,              -- '{sourceId}:{type}:{stream_id}'
      source_id             TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      type                  TEXT NOT NULL CHECK(type IN ('live', 'movie', 'episode')),
      stream_id             TEXT NOT NULL,                 -- provider's raw id

      -- Provider-raw fields
      title                 TEXT NOT NULL,                 -- raw provider title, untouched (L14)
      thumbnail_url         TEXT,
      stream_url            TEXT,
      container_extension   TEXT,
      category_id           TEXT,
      tvg_id                TEXT,
      epg_channel_id        TEXT,
      catchup_supported     INTEGER NOT NULL DEFAULT 0,
      catchup_days          INTEGER NOT NULL DEFAULT 0,
      provider_metadata     TEXT,                          -- JSON bag for extras the provider returned

      -- L14 normalizer outputs (derived at sync time)
      language_hint         TEXT,
      origin_hint           TEXT,
      quality_hint          TEXT,
      year_hint             INTEGER,

      -- Polymorphic canonical link — exactly one set once matched
      canonical_vod_id      INTEGER REFERENCES canonical_vod(id) ON DELETE SET NULL,
      episode_id            INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
      canonical_live_id     INTEGER REFERENCES canonical_live(id) ON DELETE SET NULL,

      added_at              INTEGER NOT NULL DEFAULT (unixepoch()),

      CHECK (
        (type = 'movie'   AND episode_id IS NULL AND canonical_live_id IS NULL) OR
        (type = 'episode' AND canonical_vod_id IS NULL AND canonical_live_id IS NULL) OR
        (type = 'live'    AND canonical_vod_id IS NULL AND episode_id IS NULL)
      )
    );

    -- Junction: a stream can belong to multiple categories (source-owned taxonomy)
    CREATE TABLE IF NOT EXISTS stream_categories (
      stream_id    TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
      category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (stream_id, category_id)
    );

    -- Series parents — not playable streams, so they can't live in the
    -- streams table (CHECK constraint bans type='series'). They sit in a
    -- sibling table keyed the same way ({sourceId}:series:{series_id}) and
    -- FK into canonical_series for identity. Episodes remain in streams
    -- with type='episode' + episode_id FK.
    CREATE TABLE IF NOT EXISTS series_sources (
      id                  TEXT PRIMARY KEY,              -- '{sourceId}:series:{series_id}'
      source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      canonical_series_id INTEGER NOT NULL REFERENCES canonical_series(id) ON DELETE CASCADE,
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

    -- ─── User data — four tables, each with exactly its own columns ───
    -- Q4: movies & series favorite/watchlist/rating at canonical level,
    --     watch progress per stream, live channel favorite per stream.

    CREATE TABLE IF NOT EXISTS canonical_vod_user_data (
      profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      canonical_vod_id  INTEGER NOT NULL REFERENCES canonical_vod(id) ON DELETE CASCADE,
      is_favorite       INTEGER NOT NULL DEFAULT 0,
      is_watchlisted    INTEGER NOT NULL DEFAULT 0,
      rating            INTEGER,
      fav_sort_order    INTEGER,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (profile_id, canonical_vod_id)
    );

    CREATE TABLE IF NOT EXISTS canonical_series_user_data (
      profile_id           TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      canonical_series_id  INTEGER NOT NULL REFERENCES canonical_series(id) ON DELETE CASCADE,
      is_favorite          INTEGER NOT NULL DEFAULT 0,
      is_watchlisted       INTEGER NOT NULL DEFAULT 0,
      rating               INTEGER,
      fav_sort_order       INTEGER,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (profile_id, canonical_series_id)
    );

    CREATE TABLE IF NOT EXISTS stream_user_data (
      profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      stream_id         TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
      watch_position    INTEGER NOT NULL DEFAULT 0,
      watch_duration    INTEGER,
      last_watched_at   INTEGER,
      completed         INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (profile_id, stream_id)
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

    -- Canonical identity lookups (content_hash is already UNIQUE; these cover oracle + cross-ref)
    CREATE INDEX IF NOT EXISTS idx_canonical_vod_imdb      ON canonical_vod(imdb_id);
    CREATE INDEX IF NOT EXISTS idx_canonical_vod_tmdb      ON canonical_vod(tmdb_id);
    CREATE INDEX IF NOT EXISTS idx_canonical_vod_oracle    ON canonical_vod(oracle_status);

    CREATE INDEX IF NOT EXISTS idx_canonical_series_imdb   ON canonical_series(imdb_id);
    CREATE INDEX IF NOT EXISTS idx_canonical_series_tmdb   ON canonical_series(tmdb_id);
    CREATE INDEX IF NOT EXISTS idx_canonical_series_oracle ON canonical_series(oracle_status);

    CREATE INDEX IF NOT EXISTS idx_episodes_series         ON episodes(canonical_series_id);

    CREATE INDEX IF NOT EXISTS idx_canonical_live_iptv     ON canonical_live(iptv_org_id);
    CREATE INDEX IF NOT EXISTS idx_canonical_live_oracle   ON canonical_live(oracle_status);

    -- Streams access patterns: browse grids filter by source+type+category
    CREATE INDEX IF NOT EXISTS idx_streams_source          ON streams(source_id);
    CREATE INDEX IF NOT EXISTS idx_streams_type            ON streams(type);
    CREATE INDEX IF NOT EXISTS idx_streams_source_type     ON streams(source_id, type);
    CREATE INDEX IF NOT EXISTS idx_streams_category        ON streams(category_id, source_id);
    CREATE INDEX IF NOT EXISTS idx_streams_epg             ON streams(epg_channel_id);
    CREATE INDEX IF NOT EXISTS idx_streams_vod_link        ON streams(canonical_vod_id);
    CREATE INDEX IF NOT EXISTS idx_streams_episode_link    ON streams(episode_id);
    CREATE INDEX IF NOT EXISTS idx_streams_live_link       ON streams(canonical_live_id);

    CREATE INDEX IF NOT EXISTS idx_series_sources_source    ON series_sources(source_id);
    CREATE INDEX IF NOT EXISTS idx_series_sources_canonical ON series_sources(canonical_series_id);
    CREATE INDEX IF NOT EXISTS idx_series_sources_category  ON series_sources(category_id, source_id);

    -- Categories + EPG (unchanged from V2)
    CREATE INDEX IF NOT EXISTS idx_sc_category             ON stream_categories(category_id);
    CREATE INDEX IF NOT EXISTS idx_categories_name         ON categories(name, source_id, external_id);
    CREATE INDEX IF NOT EXISTS idx_epg_channel             ON epg(channel_external_id);
    CREATE INDEX IF NOT EXISTS idx_epg_time                ON epg(start_time, end_time);

    -- User data access patterns
    CREATE INDEX IF NOT EXISTS idx_vod_ud_favorites        ON canonical_vod_user_data(profile_id, is_favorite);
    CREATE INDEX IF NOT EXISTS idx_vod_ud_watchlist        ON canonical_vod_user_data(profile_id, is_watchlisted);
    CREATE INDEX IF NOT EXISTS idx_series_ud_favorites     ON canonical_series_user_data(profile_id, is_favorite);
    CREATE INDEX IF NOT EXISTS idx_series_ud_watchlist     ON canonical_series_user_data(profile_id, is_watchlisted);
    CREATE INDEX IF NOT EXISTS idx_stream_ud_recent        ON stream_user_data(profile_id, last_watched_at);
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

/**
 * Legacy V2 FTS rebuild helper. V3 uses per-type FTS tables populated at sync
 * time by the sync worker (Phase D) — no background rebuild needed. Kept as a
 * no-op stub so the existing handlers.ts import still resolves until Phase D
 * lands and cleans it up.
 */
export async function rebuildFtsIfNeeded(): Promise<void> {
  return
}

export function closeDb() {
  _sqlite?.close()
  _sqlite = null
  _db = null
}
