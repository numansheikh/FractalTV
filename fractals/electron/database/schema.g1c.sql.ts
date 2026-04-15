/**
 * g1c schema — 15 tables, split per content type, FTS baked in.
 *
 * This file is the DDL source of truth for the locked g1c redesign.
 * It is NOT yet wired into `connection.ts` — the destructive migration
 * (drop old g1 tables, create these 15) is a separate commit that comes
 * after sync/IPC/frontend rewrites are ready.
 *
 * See `PLAN.md` → "g1c — schema redesign" for the ten locked decisions
 * and the design reasoning.
 *
 * Table surface:
 *   Core (3):      sources, profiles, settings
 *   Content (8):   channel_categories, channels, epg,
 *                  movie_categories, movies,
 *                  series_categories, series, episodes
 *   User data (4): channel_user_data, movie_user_data,
 *                  series_user_data, episode_user_data
 *
 * Normalizer (`search_title`) is populated by the Index pipeline button,
 * NOT at INSERT time. Search uses LIKE on `search_title` — no FTS.
 * Episodes do not carry `search_title`.
 */
export const G1C_SCHEMA_SQL = `
  -- ─── Core ─────────────────────────────────────────────────────────

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
    ingest_state      TEXT NOT NULL DEFAULT 'added' CHECK(ingest_state IN ('added','tested','synced','epg_fetched')),
    created_at        INTEGER NOT NULL DEFAULT (unixepoch())
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

  -- ─── Channels ─────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS channel_categories (
    id          TEXT PRIMARY KEY,        -- '{sourceId}:chancat:{external_id}'
    source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS channels (
    id                  TEXT PRIMARY KEY,  -- '{sourceId}:live:{external_id}'
    source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    category_id         TEXT REFERENCES channel_categories(id) ON DELETE SET NULL,
    external_id         TEXT NOT NULL,

    title               TEXT NOT NULL,
    search_title        TEXT,              -- populated by Index button, NOT at sync

    thumbnail_url       TEXT,
    stream_url          TEXT,
    tvg_id              TEXT,
    epg_channel_id      TEXT,
    catchup_supported   INTEGER NOT NULL DEFAULT 0,
    catchup_days        INTEGER NOT NULL DEFAULT 0,
    provider_metadata   TEXT,               -- JSON bag

    md_country          TEXT,
    md_language         TEXT,
    md_year             INTEGER,
    md_origin           TEXT,
    md_quality          TEXT,

    added_at            INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS epg (
    id                  TEXT PRIMARY KEY,
    source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    channel_external_id TEXT NOT NULL,
    title               TEXT NOT NULL,
    description         TEXT,
    start_time          INTEGER NOT NULL,
    end_time            INTEGER NOT NULL,
    category            TEXT
  );

  -- ─── Movies ───────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS movie_categories (
    id          TEXT PRIMARY KEY,
    source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS movies (
    id                  TEXT PRIMARY KEY,  -- '{sourceId}:movie:{external_id}'
    source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    category_id         TEXT REFERENCES movie_categories(id) ON DELETE SET NULL,
    external_id         TEXT NOT NULL,

    title               TEXT NOT NULL,
    search_title        TEXT,              -- populated by Index button

    thumbnail_url       TEXT,
    stream_url          TEXT,
    container_extension TEXT,
    provider_metadata   TEXT,               -- JSON bag

    md_country          TEXT,
    md_language         TEXT,
    md_year             INTEGER,
    md_origin           TEXT,
    md_quality          TEXT,

    added_at            INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- ─── Series + Episodes ────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS series_categories (
    id          TEXT PRIMARY KEY,
    source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS series (
    id                  TEXT PRIMARY KEY,  -- '{sourceId}:series:{external_id}'
    source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    category_id         TEXT REFERENCES series_categories(id) ON DELETE SET NULL,
    external_id         TEXT NOT NULL,

    title               TEXT NOT NULL,
    search_title        TEXT,              -- populated by Index button

    thumbnail_url       TEXT,
    provider_metadata   TEXT,               -- JSON bag

    md_country          TEXT,
    md_language         TEXT,
    md_year             INTEGER,
    md_origin           TEXT,
    md_quality          TEXT,

    added_at            INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Episodes belong to a series. No search_title (not searchable directly
  -- per locked decision 8 — episodes are found via parent series).
  CREATE TABLE IF NOT EXISTS episodes (
    id                  TEXT PRIMARY KEY,  -- '{sourceId}:episode:{external_id}'
    series_id           TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    external_id         TEXT NOT NULL,

    title               TEXT NOT NULL,
    thumbnail_url       TEXT,
    stream_url          TEXT,
    container_extension TEXT,

    season              INTEGER,
    episode_num         INTEGER,

    added_at            INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- ─── User data (split per type) ───────────────────────────────────

  CREATE TABLE IF NOT EXISTS channel_user_data (
    profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    channel_id        TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    is_favorite       INTEGER NOT NULL DEFAULT 0,
    fav_sort_order    INTEGER,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (profile_id, channel_id)
  );

  CREATE TABLE IF NOT EXISTS movie_user_data (
    profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    movie_id          TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
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
    PRIMARY KEY (profile_id, movie_id)
  );

  CREATE TABLE IF NOT EXISTS series_user_data (
    profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    series_id         TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    is_favorite       INTEGER NOT NULL DEFAULT 0,
    is_watchlisted    INTEGER NOT NULL DEFAULT 0,
    rating            INTEGER,
    fav_sort_order    INTEGER,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (profile_id, series_id)
  );

  -- Episode user_data intentionally omits favorites/watchlist/rating —
  -- those happen at the series level. Only playback state per episode.
  CREATE TABLE IF NOT EXISTS episode_user_data (
    profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    episode_id        TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    watch_position    INTEGER NOT NULL DEFAULT 0,
    watch_duration    INTEGER,
    last_watched_at   INTEGER,
    completed         INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (profile_id, episode_id)
  );

  -- ─── Indexes ──────────────────────────────────────────────────────

  CREATE INDEX IF NOT EXISTS idx_channels_source           ON channels(source_id);
  CREATE INDEX IF NOT EXISTS idx_channels_category         ON channels(category_id, source_id);
  CREATE INDEX IF NOT EXISTS idx_channels_epg              ON channels(epg_channel_id);

  CREATE INDEX IF NOT EXISTS idx_movies_source             ON movies(source_id);
  CREATE INDEX IF NOT EXISTS idx_movies_category           ON movies(category_id, source_id);

  CREATE INDEX IF NOT EXISTS idx_series_source             ON series(source_id);
  CREATE INDEX IF NOT EXISTS idx_series_category           ON series(category_id, source_id);

  CREATE INDEX IF NOT EXISTS idx_episodes_series           ON episodes(series_id);
  CREATE INDEX IF NOT EXISTS idx_episodes_se               ON episodes(series_id, season, episode_num);

  CREATE INDEX IF NOT EXISTS idx_channel_cats_source       ON channel_categories(source_id);
  CREATE INDEX IF NOT EXISTS idx_movie_cats_source         ON movie_categories(source_id);
  CREATE INDEX IF NOT EXISTS idx_series_cats_source        ON series_categories(source_id);

  CREATE INDEX IF NOT EXISTS idx_epg_channel               ON epg(channel_external_id);
  CREATE INDEX IF NOT EXISTS idx_epg_time                  ON epg(start_time, end_time);

  -- ─── iptv-org reference data (g2) ─────────────────────────────────
  -- Flat, denormalized snapshot of multiple iptv-org endpoints merged
  -- into one table at ingest time. Replaced atomically on pull; never
  -- joined at read time. Independent of the channels table — bridge to
  -- tvg_id is deferred to a later mini-phase.

  CREATE TABLE IF NOT EXISTS iptv_channels (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    alt_names         TEXT,
    network           TEXT,
    owners            TEXT,
    country           TEXT,
    category_ids      TEXT,
    is_nsfw           INTEGER NOT NULL DEFAULT 0,
    launched          TEXT,
    closed            TEXT,
    replaced_by       TEXT,
    website           TEXT,
    country_name      TEXT,
    country_flag      TEXT,
    category_labels   TEXT,
    logo_url          TEXT,
    guide_urls        TEXT,
    stream_urls       TEXT,
    is_blocked        INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_iptv_channels_country ON iptv_channels(country);

  CREATE INDEX IF NOT EXISTS idx_channel_ud_favorites      ON channel_user_data(profile_id, is_favorite);
  CREATE INDEX IF NOT EXISTS idx_movie_ud_favorites        ON movie_user_data(profile_id, is_favorite);
  CREATE INDEX IF NOT EXISTS idx_movie_ud_watchlist        ON movie_user_data(profile_id, is_watchlisted);
  CREATE INDEX IF NOT EXISTS idx_movie_ud_recent           ON movie_user_data(profile_id, last_watched_at);
  CREATE INDEX IF NOT EXISTS idx_series_ud_favorites       ON series_user_data(profile_id, is_favorite);
  CREATE INDEX IF NOT EXISTS idx_series_ud_watchlist       ON series_user_data(profile_id, is_watchlisted);
  CREATE INDEX IF NOT EXISTS idx_episode_ud_recent         ON episode_user_data(profile_id, last_watched_at);
`

/**
 * The g1 → g1c destructive migration. Drops the 12 old g1 tables (and
 * their FTS if any) so the CREATE IF NOT EXISTS above can build the new
 * 15-table schema fresh. User re-syncs from providers afterward.
 *
 * This is the hard cut the design intentionally commits to — no in-place
 * migration of rows. See locked decision 1 (canonical removed) + the
 * "data expendable" note in `project_g1c_schema_redesign.md`.
 *
 * NOT YET CALLED from connection.ts. Wiring this up is the next commit.
 */
export const G1C_DROP_OLD_SQL = `
  DROP TABLE IF EXISTS stream_user_data;
  DROP TABLE IF EXISTS series_user_data;
  DROP TABLE IF EXISTS channel_user_data;
  DROP TABLE IF EXISTS stream_categories;
  DROP TABLE IF EXISTS series_source_categories;
  DROP TABLE IF EXISTS streams;
  DROP TABLE IF EXISTS series_sources;
  DROP TABLE IF EXISTS categories;
  DROP TABLE IF EXISTS epg;
`
