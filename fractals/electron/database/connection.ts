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

  // Register ligature folding for FTS indexing (g2)
  _sqlite.function('fold_ligatures', (s: unknown) => {
    if (typeof s !== 'string') return s
    return s
      .replace(/œ/gi, 'oe')
      .replace(/æ/gi, 'ae')
      .replace(/ß/g, 'ss')
      .replace(/\uFB01/g, 'fi')
      .replace(/\uFB02/g, 'fl')
      .replace(/ĳ/gi, 'ij')
  })

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
  // ─── Pre-create migrations (destructive: force CREATE block to rebuild) ───

  // Early iptv_channels schema had dead columns (subdivision, city, languages,
  // logo) that don't exist in the real iptv-org channels.json. Drop it so
  // CREATE TABLE IF NOT EXISTS below rebuilds the current shape. User re-pulls
  // via Settings → Refresh.
  const hasLegacyIptvChannels = db.prepare(
    `SELECT 1 FROM pragma_table_info('iptv_channels') WHERE name = 'logo'`
  ).get()
  if (hasLegacyIptvChannels) {
    console.log('[DB] Dropping legacy iptv_channels table (pre-current schema)')
    db.exec('DROP TABLE iptv_channels')
  }

  // g3: channel_user_data re-keys from stream_id → canonical_channel_id.
  // Data is expendable (pre-release, user re-favorites after migration).
  const chanUdHasStreamId = db.prepare(
    `SELECT 1 FROM pragma_table_info('channel_user_data') WHERE name = 'stream_id'`
  ).get()
  if (chanUdHasStreamId) {
    console.log('[DB] Migrating channel_user_data: re-keying to canonical_channel_id (data dropped)')
    db.exec(`DROP TABLE channel_user_data`)
  }

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

    -- ─── Canonical channel identity (g3) ─────────────────────────────
    -- One row per real-world channel. Live streams point here via FK.
    -- Denormalized: all iptv-org fields copied in at match time so runtime
    -- reads never join iptv_channels. Synthetic canonicals (unmatched streams)
    -- have iptv_org_id = NULL and only title populated from stream title.

    CREATE TABLE IF NOT EXISTS canonical_channels (
      id              TEXT PRIMARY KEY,       -- local UUID
      title           TEXT NOT NULL,
      alt_names       TEXT,                   -- JSON array of iptv-org aliases
      country         TEXT,
      network         TEXT,
      owners          TEXT,                   -- JSON array
      categories      TEXT,                   -- JSON array
      is_nsfw         INTEGER NOT NULL DEFAULT 0,
      launched        TEXT,
      closed          TEXT,
      replaced_by     TEXT,
      website         TEXT,
      logo_url        TEXT,
      iptv_org_id     TEXT,                   -- NULL for synthetic rows
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_canonical_iptv_org ON canonical_channels(iptv_org_id);
    CREATE INDEX IF NOT EXISTS idx_canonical_title    ON canonical_channels(title);

    -- ─── Streams (raw provider inventory + normalizer hints) ────────────
    -- g3: canonical_channel_id links live streams to canonical_channels.
    --     user_flagged is a placeholder for future stream health UX.
    -- Episodes link to series_sources via parent_series_id.

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

      -- g3: canonical identity + stream health flag
      canonical_channel_id  TEXT REFERENCES canonical_channels(id) ON DELETE SET NULL,
      user_flagged          INTEGER NOT NULL DEFAULT 0,

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
      profile_id              TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      canonical_channel_id    TEXT NOT NULL REFERENCES canonical_channels(id) ON DELETE CASCADE,
      is_favorite             INTEGER NOT NULL DEFAULT 0,
      preferred_stream_id     TEXT,                        -- user's preferred variant (NULL = auto-best)
      fav_sort_order          INTEGER,
      created_at              INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at              INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (profile_id, canonical_channel_id)
    );

    -- ─── Indexes ──────────────────────────────────────────────────────

    -- Streams access patterns
    CREATE INDEX IF NOT EXISTS idx_streams_source          ON streams(source_id);
    CREATE INDEX IF NOT EXISTS idx_streams_type            ON streams(type);
    CREATE INDEX IF NOT EXISTS idx_streams_source_type     ON streams(source_id, type);
    CREATE INDEX IF NOT EXISTS idx_streams_category        ON streams(category_id, source_id);
    CREATE INDEX IF NOT EXISTS idx_streams_epg             ON streams(epg_channel_id);
    CREATE INDEX IF NOT EXISTS idx_streams_parent_series   ON streams(parent_series_id);
    CREATE INDEX IF NOT EXISTS idx_streams_canonical       ON streams(canonical_channel_id, type);

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

    -- ─── FTS5 (g3) — canonical channels ─────────────────────────────
    -- Live channel search hits canonical_fts first; FTS hit → canonical_id
    -- → fan out to streams for variant resolution. VoD stays on content_fts.
    CREATE VIRTUAL TABLE IF NOT EXISTS canonical_fts USING fts5(
      id UNINDEXED,
      title,
      alt_names,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- ─── FTS5 (g2) ──────────────────────────────────────────────────
    CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
      id UNINDEXED,
      source_id UNINDEXED,
      type UNINDEXED,
      title,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- ─── iptv-org channel database (g3) ─────────────────────────────
    -- Schema mirrors iptv-org /api/channels.json exactly. Sibling files
    -- (logos.json, streams.json, languages.json) are pulled separately
    -- in later cuts — not mixed into this table.
    CREATE TABLE IF NOT EXISTS iptv_channels (
      id            TEXT PRIMARY KEY,
      name          TEXT,
      alt_names     TEXT,                  -- JSON array
      network       TEXT,
      owners        TEXT,                  -- JSON array
      country       TEXT,
      categories    TEXT,                  -- JSON array
      is_nsfw       INTEGER NOT NULL DEFAULT 0,
      launched      TEXT,
      closed        TEXT,
      replaced_by   TEXT,
      website       TEXT,
      logo          TEXT                   -- best-pick URL from logos.json
    );
    CREATE INDEX IF NOT EXISTS idx_iptv_channels_name ON iptv_channels(name);
  `)

  // ─── Additive migrations (run against existing tables from CREATE above) ───

  // g3: streams gains canonical_channel_id + user_flagged. Fresh DBs already
  // have these columns from the CREATE block; pragma check no-ops. Fires only
  // on pre-g3 DBs where the CREATE block was a no-op on existing streams.
  const streamsHasCanonical = db.prepare(
    `SELECT 1 FROM pragma_table_info('streams') WHERE name = 'canonical_channel_id'`
  ).get()
  if (!streamsHasCanonical) {
    console.log('[DB] Migrating streams: adding canonical_channel_id + user_flagged')
    db.exec(`ALTER TABLE streams ADD COLUMN canonical_channel_id TEXT REFERENCES canonical_channels(id) ON DELETE SET NULL`)
    db.exec(`ALTER TABLE streams ADD COLUMN user_flagged INTEGER NOT NULL DEFAULT 0`)
  }

  // g3: canonical_channels gains alt_names (JSON array of iptv-org aliases).
  // Used by canonical_fts so searches like "CP" can find "Canal Plus".
  // Pre-existing rows get NULL and are repopulated on next canonical build.
  const canonicalHasAltNames = db.prepare(
    `SELECT 1 FROM pragma_table_info('canonical_channels') WHERE name = 'alt_names'`
  ).get()
  if (!canonicalHasAltNames) {
    console.log('[DB] Migrating canonical_channels: adding alt_names')
    db.exec(`ALTER TABLE canonical_channels ADD COLUMN alt_names TEXT`)
  }

  // iptv_channels gains `logo` column for the URL picked from iptv-org's
  // sibling logos.json feed (channels.json carries no logos).
  const iptvHasLogo = db.prepare(
    `SELECT 1 FROM pragma_table_info('iptv_channels') WHERE name = 'logo'`
  ).get()
  if (!iptvHasLogo) {
    console.log('[DB] Migrating iptv_channels: adding logo')
    db.exec(`ALTER TABLE iptv_channels ADD COLUMN logo TEXT`)
  }

  // Seed default settings if missing
  const seedSetting = (key: string, value: string) =>
    db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run(key, value)
  seedSetting('iptv_channels_url', 'https://iptv-org.github.io/api/channels.json')
  seedSetting('iptv_channels_ttl_days', '15')
  // g3: channel card badge config — JSON array, ordered by display position
  // Available values: 'country' | 'variants' | 'sources' | 'network' | 'category' | 'nsfw' | 'defunct'
  seedSetting('channel_card_badges', JSON.stringify(['country', 'variants', 'sources']))

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
