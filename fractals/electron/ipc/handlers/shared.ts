// ─── Shared types, constants, and helper functions ───────────────────────────
// Used across multiple domain handler files.

import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { getSqlite, getSetting } from '../../database/connection'
import { normalizeForSearch } from '../../lib/normalize'
import { parseAdvQuery, buildAdvWhere } from '../../lib/adv-query-parser'

// ─── Minimal row interfaces ─────────────────────────────────────────────────

export interface CountRow { n: number }

export interface SourceRow {
  id: string; type: string; name: string
  server_url: string; username: string; password: string
  m3u_url?: string; epg_url?: string | null; status?: string; disabled?: number
  color_index?: number; last_epg_sync?: number
  ingest_state?: 'added' | 'tested' | 'synced' | 'epg_fetched'
}

// ─── User-data row interfaces (internal) ─────────────────────────────────
interface ChannelUDRow { is_favorite: number; fav_sort_order: number | null }
interface MovieUDRow {
  is_favorite: number; is_watchlisted: number; rating: number | null
  fav_sort_order: number | null; watch_position: number
  last_watched_at: number | null; completed: number
}
interface SeriesUDRow {
  is_favorite: number; is_watchlisted: number
  rating: number | null; fav_sort_order: number | null
}
interface EpisodeUDRow { watch_position: number; last_watched_at: number | null; completed: number }

// g1c content rows. Channels, movies, and series each live in their own table.
export interface ChannelRow {
  id: string; source_id: string; external_id: string; title: string
  category_id?: string; thumbnail_url?: string; stream_url?: string
  tvg_id?: string; epg_channel_id?: string
  catchup_supported?: number; catchup_days?: number
  provider_metadata?: string
}

export interface MovieRow {
  id: string; source_id: string; external_id: string; title: string
  category_id?: string; thumbnail_url?: string; stream_url?: string
  container_extension?: string; provider_metadata?: string
  md_year?: number
}

export interface SeriesRow {
  id: string; source_id: string; external_id: string; title: string
  category_id?: string; thumbnail_url?: string; provider_metadata?: string
  md_year?: number
}

export interface EpisodeRow {
  id: string; series_id: string; external_id: string; title: string
  thumbnail_url?: string; stream_url?: string; container_extension?: string
  season?: number; episode_num?: number
}

export interface DisabledRow { disabled: number }

export const DEFAULT_PROFILE = 'default'

export function dbPath(): string {
  return join(
    app.getPath('userData'),
    'data',
    process.env.FRACTALS_DB ? `fractals-${process.env.FRACTALS_DB}.db` : 'fractaltv.db'
  )
}

// ─── Content type detection ───────────────────────────────────────────────
// Content IDs follow the format `{sourceId}:{kind}:{external_id}` where kind
// is one of 'live' | 'movie' | 'series' | 'episode'.
export type ContentKind = 'channel' | 'movie' | 'series' | 'episode'

export function idKind(contentId: string): ContentKind | null {
  const parts = contentId.split(':')
  if (parts.length < 3) return null
  const k = parts[1]
  if (k === 'live') return 'channel'
  if (k === 'movie') return 'movie'
  if (k === 'series') return 'series'
  if (k === 'episode') return 'episode'
  return null
}

// ─── g1c SELECT fragments ────────────────────────────────────────────────
// The renderer expects a consistent bag of fields across types. NULL fields
// are placeholders for metadata we don't have yet in g1c.

export const CHANNEL_SELECT = `
  c.id,
  c.source_id                AS primary_source_id,
  c.source_id                AS source_ids,
  c.external_id              AS external_id,
  'live'                     AS type,
  c.title                    AS title,
  c.category_id,
  c.thumbnail_url            AS poster_url,
  NULL                       AS container_extension,
  c.catchup_supported,
  c.catchup_days,
  c.epg_channel_id,
  c.tvg_id,
  NULL                       AS canonical_id,
  NULL                       AS original_title,
  c.md_year                  AS year,
  NULL                       AS plot,
  NULL                       AS poster_path,
  NULL                       AS backdrop_url,
  NULL                       AS rating_tmdb,
  NULL                       AS rating_imdb,
  NULL                       AS genres,
  NULL                       AS director,
  NULL                       AS cast,
  NULL                       AS keywords,
  NULL                       AS runtime,
  NULL                       AS tmdb_id,
  0                          AS enriched,
  NULL                       AS enriched_at,
  EXISTS(SELECT 1 FROM epg WHERE epg.channel_external_id = c.epg_channel_id AND epg.source_id = c.source_id LIMIT 1) AS has_epg_data
`

export const MOVIE_SELECT = `
  m.id,
  m.source_id                AS primary_source_id,
  m.source_id                AS source_ids,
  m.external_id              AS external_id,
  'movie'                    AS type,
  m.title                    AS title,
  m.category_id,
  m.thumbnail_url            AS poster_url,
  m.container_extension,
  0                          AS catchup_supported,
  0                          AS catchup_days,
  NULL                       AS epg_channel_id,
  NULL                       AS tvg_id,
  NULL                       AS canonical_id,
  NULL                       AS original_title,
  m.md_year                  AS year,
  NULL                       AS plot,
  NULL                       AS poster_path,
  NULL                       AS backdrop_url,
  NULL                       AS rating_tmdb,
  NULL                       AS rating_imdb,
  NULL                       AS genres,
  NULL                       AS director,
  NULL                       AS cast,
  NULL                       AS keywords,
  m.md_runtime               AS runtime,
  NULL                       AS tmdb_id,
  0                          AS enriched,
  NULL                       AS enriched_at,
  0                          AS has_epg_data,
  m.search_title             AS search_title,
  m.md_prefix                AS md_prefix,
  m.md_language              AS md_language,
  m.md_quality               AS md_quality,
  m.is_nsfw                  AS is_nsfw
`

export const SERIES_SELECT = `
  sr.id,
  sr.source_id               AS primary_source_id,
  sr.source_id               AS source_ids,
  sr.external_id             AS external_id,
  'series'                   AS type,
  sr.title                   AS title,
  sr.category_id,
  sr.thumbnail_url           AS poster_url,
  NULL                       AS container_extension,
  0                          AS catchup_supported,
  0                          AS catchup_days,
  NULL                       AS epg_channel_id,
  NULL                       AS tvg_id,
  NULL                       AS canonical_id,
  NULL                       AS original_title,
  sr.md_year                 AS year,
  NULL                       AS plot,
  NULL                       AS poster_path,
  NULL                       AS backdrop_url,
  NULL                       AS rating_tmdb,
  NULL                       AS rating_imdb,
  NULL                       AS genres,
  NULL                       AS director,
  NULL                       AS cast,
  NULL                       AS keywords,
  NULL                       AS runtime,
  NULL                       AS tmdb_id,
  0                          AS enriched,
  NULL                       AS enriched_at,
  0                          AS has_epg_data,
  sr.search_title            AS search_title,
  sr.md_prefix               AS md_prefix,
  sr.md_language             AS md_language,
  sr.md_quality              AS md_quality,
  sr.is_nsfw                 AS is_nsfw
`

// ─── Enabled-source cache ────────────────────────────────────────────────
// Cached list of non-disabled source ids. Read on every search:query,
// categories:list, and content:browse call — populate lazily, invalidate at
// every source mutation (add/remove/toggle/import/factory-reset).
let enabledSourcesCache: Set<string> | null = null

export function getEnabledSourceIds(sqlite: ReturnType<typeof getSqlite>): Set<string> {
  if (!enabledSourcesCache) {
    const rows = sqlite.prepare(`SELECT id FROM sources WHERE disabled = 0`).all() as { id: string }[]
    enabledSourcesCache = new Set(rows.map(r => r.id))
  }
  return enabledSourcesCache
}

export function invalidateEnabledSources(): void {
  enabledSourcesCache = null
}

// ─── NSFW helpers ────────────────────────────────────────────────────────

/** Reapply user NSFW overrides to categories (wins over rules), then
 *  propagate is_nsfw from categories to content rows. Category rows are
 *  recreated on every resync, so this must run after iptv-org matching
 *  and before content is considered authoritative. */
export function applyNsfwFlags(sqlite: ReturnType<typeof getSqlite>) {
  for (const [table, type] of [
    ['channel_categories', 'live'],
    ['movie_categories',   'movie'],
    ['series_categories',  'series'],
  ] as const) {
    sqlite.prepare(`
      UPDATE ${table}
         SET is_nsfw = (SELECT is_nsfw FROM category_overrides
                         WHERE source_id            = ${table}.source_id
                           AND content_type         = ?
                           AND category_external_id = ${table}.external_id)
       WHERE EXISTS (SELECT 1 FROM category_overrides
                      WHERE source_id            = ${table}.source_id
                        AND content_type         = ?
                        AND category_external_id = ${table}.external_id)
    `).run(type, type)
  }
  sqlite.prepare(`UPDATE channels SET is_nsfw = COALESCE((SELECT is_nsfw FROM channel_categories WHERE id = channels.category_id), 0)`).run()
  sqlite.prepare(`UPDATE movies  SET is_nsfw = COALESCE((SELECT is_nsfw FROM movie_categories   WHERE id = movies.category_id),   0)`).run()
  sqlite.prepare(`UPDATE series  SET is_nsfw = COALESCE((SELECT is_nsfw FROM series_categories  WHERE id = series.category_id),   0)`).run()
}

// ─── Search helpers ──────────────────────────────────────────────────────
// ─── Advanced search (@ prefix) ──────────────────────────────────────────────
// Tokenized query with auto-detected md_* filters + title LIKE fallback.

const ADV_TABLE_CONFIG: Record<string, { select: string; table: string; alias: string; catTable: string; catFk: string }> = {
  live:   { select: 'CHANNEL_SELECT', table: 'channels',  alias: 'c',  catTable: 'channel_categories', catFk: 'c.category_id' },
  movie:  { select: 'MOVIE_SELECT',   table: 'movies',    alias: 'm',  catTable: 'movie_categories',   catFk: 'm.category_id' },
  series: { select: 'SERIES_SELECT',  table: 'series',    alias: 'sr', catTable: 'series_categories',  catFk: 'sr.category_id' },
}

export function g1cAdvSearch(
  advQuery: ReturnType<typeof parseAdvQuery>,
  type: 'live' | 'movie' | 'series',
  categoryName: string | undefined,
  filterIds: string[],
  limit: number, offset: number, skipCount = false,
): { items: unknown[]; total: number } {
  const sqlite = getSqlite()
  const cfg = ADV_TABLE_CONFIG[type]
  const a = cfg.alias
  const selectCols = type === 'live' ? CHANNEL_SELECT : type === 'movie' ? MOVIE_SELECT : SERIES_SELECT

  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN ${cfg.catTable} cat ON cat.id = ${cfg.catFk} AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  const nsfwWhere = getSetting('allow_adult') === '1' ? '' : `AND ${a}.is_nsfw = 0`

  const adv = buildAdvWhere(advQuery, a)
  if (!adv) return { items: [], total: 0 }

  const where = `${adv.where} AND ${a}.source_id IN (${sourceList}) ${nsfwWhere}`
  const allParams = [...catParams, ...adv.params, ...filterIds]

  const items = sqlite.prepare(`
    SELECT ${selectCols}
    FROM ${cfg.table} ${a}
    ${catJoin}
    WHERE ${where}
    LIMIT ? OFFSET ?
  `).all(...allParams, limit, offset) as unknown[]

  if (skipCount) return { items, total: items.length }
  if (items.length === 0) return { items, total: 0 }

  const total = (sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM ${cfg.table} ${a}
    ${catJoin}
    WHERE ${where}
  `).get(...allParams) as { cnt: number }).cnt
  return { items, total }
}

// ─── Plain LIKE search ───────────────────────────────────────────────────────
// LIKE `%query%` on `search_title`. Sync workers populate `search_title`
// inline via `normalizeForSearch` (any-ascii + lowercase) so ligatures /
// diacritics fold bidirectionally ("ae" ↔ "æ", "e" ↔ "é"). No FTS.

export function g1cSearchChannels(
  query: string, categoryName: string | undefined, filterIds: string[],
  limit: number, offset: number, skipCount = false,
): { items: unknown[]; total: number } {
  const sqlite = getSqlite()
  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN channel_categories cat ON cat.id = c.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  const nsfwWhere = getSetting('allow_adult') === '1' ? '' : 'AND c.is_nsfw = 0'
  const normalized = normalizeForSearch(query)
  if (!normalized) return { items: [], total: 0 }
  const like = `%${normalized}%`

  const items = sqlite.prepare(`
    SELECT ${CHANNEL_SELECT}
    FROM channels c
    ${catJoin}
    WHERE c.search_title LIKE ? AND c.source_id IN (${sourceList}) ${nsfwWhere}
    LIMIT ? OFFSET ?
  `).all(...catParams, like, ...filterIds, limit, offset) as unknown[]

  if (skipCount) return { items, total: items.length }
  if (items.length === 0) return { items, total: 0 }

  const total = (sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM channels c
    ${catJoin}
    WHERE c.search_title LIKE ? AND c.source_id IN (${sourceList}) ${nsfwWhere}
  `).get(...catParams, like, ...filterIds) as { cnt: number }).cnt
  return { items, total }
}

export function g1cSearchMovies(
  query: string, categoryName: string | undefined, filterIds: string[],
  limit: number, offset: number, skipCount = false,
): { items: unknown[]; total: number } {
  const sqlite = getSqlite()
  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN movie_categories cat ON cat.id = m.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  const nsfwWhere = getSetting('allow_adult') === '1' ? '' : 'AND m.is_nsfw = 0'
  const normalized = normalizeForSearch(query)
  if (!normalized) return { items: [], total: 0 }
  const like = `%${normalized}%`

  const items = sqlite.prepare(`
    SELECT ${MOVIE_SELECT}
    FROM movies m
    ${catJoin}
    WHERE m.search_title LIKE ? AND m.source_id IN (${sourceList}) ${nsfwWhere}
    LIMIT ? OFFSET ?
  `).all(...catParams, like, ...filterIds, limit, offset) as unknown[]

  if (skipCount) return { items, total: items.length }
  if (items.length === 0) return { items, total: 0 }

  const total = (sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM movies m
    ${catJoin}
    WHERE m.search_title LIKE ? AND m.source_id IN (${sourceList}) ${nsfwWhere}
  `).get(...catParams, like, ...filterIds) as { cnt: number }).cnt
  return { items, total }
}

export function g1cSearchSeries(
  query: string, categoryName: string | undefined, filterIds: string[],
  limit: number, offset: number, skipCount = false,
): { items: unknown[]; total: number } {
  const sqlite = getSqlite()
  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN series_categories cat ON cat.id = sr.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  const nsfwWhere = getSetting('allow_adult') === '1' ? '' : 'AND sr.is_nsfw = 0'
  const normalized = normalizeForSearch(query)
  if (!normalized) return { items: [], total: 0 }
  const like = `%${normalized}%`

  const items = sqlite.prepare(`
    SELECT ${SERIES_SELECT}
    FROM series sr
    ${catJoin}
    WHERE sr.search_title LIKE ? AND sr.source_id IN (${sourceList}) ${nsfwWhere}
    LIMIT ? OFFSET ?
  `).all(...catParams, like, ...filterIds, limit, offset) as unknown[]

  if (skipCount) return { items, total: items.length }
  if (items.length === 0) return { items, total: 0 }

  const total = (sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM series sr
    ${catJoin}
    WHERE sr.search_title LIKE ? AND sr.source_id IN (${sourceList}) ${nsfwWhere}
  `).get(...catParams, like, ...filterIds) as { cnt: number }).cnt
  return { items, total }
}

export function runBrowseSearch(
  type: 'live' | 'movie' | 'series' | undefined,
  categoryName: string | undefined,
  filterIds: string[],
  limit: number,
  offset: number,
  sortBy: 'title' | 'year' | 'rating' | 'updated' = 'updated',
  sortDir: 'asc' | 'desc' = 'desc'
): { items: unknown[], total: number } {
  const sqlite = getSqlite()
  const sourceList = filterIds.map(() => '?').join(',')
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC'

  const allowAdult = getSetting('allow_adult') === '1'

  if (type === 'live') {
    const sortCol: Record<string, string> = { title: 'c.title', year: 'c.md_year', rating: 'c.added_at', updated: 'c.added_at' }
    const catJoin = categoryName ? `JOIN channel_categories cat ON cat.id = c.category_id AND cat.name = ?` : ''
    const catParams: unknown[] = categoryName ? [categoryName] : []
    const nsfwWhere = allowAdult ? '' : 'AND c.is_nsfw = 0'
    const total = (sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM channels c ${catJoin} WHERE c.source_id IN (${sourceList}) ${nsfwWhere}
    `).get(...catParams, ...filterIds) as { cnt: number }).cnt
    const items = sqlite.prepare(`
      SELECT ${CHANNEL_SELECT} FROM channels c ${catJoin}
      WHERE c.source_id IN (${sourceList}) ${nsfwWhere}
      ORDER BY ${sortCol[sortBy] ?? 'c.added_at'} ${dir} LIMIT ? OFFSET ?
    `).all(...catParams, ...filterIds, limit, offset) as unknown[]
    return { items, total }
  }

  if (type === 'movie') {
    const sortCol: Record<string, string> = { title: 'm.title', year: 'm.md_year', rating: 'm.added_at', updated: 'm.added_at' }
    const catJoin = categoryName ? `JOIN movie_categories cat ON cat.id = m.category_id AND cat.name = ?` : ''
    const catParams: unknown[] = categoryName ? [categoryName] : []
    const nsfwWhere = allowAdult ? '' : 'AND m.is_nsfw = 0'
    const total = (sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM movies m ${catJoin} WHERE m.source_id IN (${sourceList}) ${nsfwWhere}
    `).get(...catParams, ...filterIds) as { cnt: number }).cnt
    const items = sqlite.prepare(`
      SELECT ${MOVIE_SELECT} FROM movies m ${catJoin}
      WHERE m.source_id IN (${sourceList}) ${nsfwWhere}
      ORDER BY ${sortCol[sortBy] ?? 'm.added_at'} ${dir} LIMIT ? OFFSET ?
    `).all(...catParams, ...filterIds, limit, offset) as unknown[]
    return { items, total }
  }

  if (type === 'series') {
    const sortCol: Record<string, string> = { title: 'sr.title', year: 'sr.md_year', rating: 'sr.added_at', updated: 'sr.added_at' }
    const catJoin = categoryName ? `JOIN series_categories cat ON cat.id = sr.category_id AND cat.name = ?` : ''
    const catParams: unknown[] = categoryName ? [categoryName] : []
    const nsfwWhere = allowAdult ? '' : 'AND sr.is_nsfw = 0'
    const total = (sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM series sr ${catJoin} WHERE sr.source_id IN (${sourceList}) ${nsfwWhere}
    `).get(...catParams, ...filterIds) as { cnt: number }).cnt
    const items = sqlite.prepare(`
      SELECT ${SERIES_SELECT} FROM series sr ${catJoin}
      WHERE sr.source_id IN (${sourceList}) ${nsfwWhere}
      ORDER BY ${sortCol[sortBy] ?? 'sr.added_at'} ${dir} LIMIT ? OFFSET ?
    `).all(...catParams, ...filterIds, limit, offset) as unknown[]
    return { items, total }
  }

  // type undefined (All): concat live + movies + series. Category name filter
  // is ambiguous across types here, so we ignore it when type is undefined.
  // Each subquery is capped at (limit + offset) so we never load the whole DB.
  const cap = limit + offset
  const chans  = sqlite.prepare(`
    SELECT ${CHANNEL_SELECT} FROM channels c
    WHERE c.source_id IN (${sourceList})
    ORDER BY c.added_at DESC LIMIT ?
  `).all(...filterIds, cap) as unknown[]
  const movies = sqlite.prepare(`
    SELECT ${MOVIE_SELECT} FROM movies m
    WHERE m.source_id IN (${sourceList})
    ORDER BY m.added_at DESC LIMIT ?
  `).all(...filterIds, cap) as unknown[]
  const sers   = sqlite.prepare(`
    SELECT ${SERIES_SELECT} FROM series sr
    WHERE sr.source_id IN (${sourceList})
    ORDER BY sr.added_at DESC LIMIT ?
  `).all(...filterIds, cap) as unknown[]
  const totalRow = sqlite.prepare(`
    SELECT
      (SELECT COUNT(*) FROM channels WHERE source_id IN (${sourceList})) +
      (SELECT COUNT(*) FROM movies   WHERE source_id IN (${sourceList})) +
      (SELECT COUNT(*) FROM series   WHERE source_id IN (${sourceList})) AS n
  `).get(...filterIds, ...filterIds, ...filterIds) as { n: number }
  const merged = [...chans, ...movies, ...sers]
  return { items: merged.slice(offset, offset + limit), total: totalRow.n }
}

// ─── Helpers: user-data mutation + read ──────────────────────────────────

export function readUserData(sqlite: ReturnType<typeof getSqlite>, contentId: string) {
  const kind = idKind(contentId)
  let fav = 0, wl = 0, rating: number | null = null, favSort: number | null = null
  let position = 0, lastWatched: number | null = null, completed = 0

  if (kind === 'channel') {
    const row = sqlite.prepare(`SELECT * FROM channel_user_data WHERE profile_id = ? AND channel_id = ?`).get(DEFAULT_PROFILE, contentId) as ChannelUDRow | undefined
    if (row) { fav = row.is_favorite ?? 0; favSort = row.fav_sort_order ?? null }
  } else if (kind === 'movie') {
    const row = sqlite.prepare(`SELECT * FROM movie_user_data WHERE profile_id = ? AND movie_id = ?`).get(DEFAULT_PROFILE, contentId) as MovieUDRow | undefined
    if (row) {
      fav = row.is_favorite ?? 0; wl = row.is_watchlisted ?? 0
      rating = row.rating ?? null; favSort = row.fav_sort_order ?? null
      position = row.watch_position ?? 0; lastWatched = row.last_watched_at ?? null; completed = row.completed ?? 0
    }
  } else if (kind === 'series') {
    const row = sqlite.prepare(`SELECT * FROM series_user_data WHERE profile_id = ? AND series_id = ?`).get(DEFAULT_PROFILE, contentId) as SeriesUDRow | undefined
    if (row) { fav = row.is_favorite ?? 0; wl = row.is_watchlisted ?? 0; rating = row.rating ?? null; favSort = row.fav_sort_order ?? null }
  } else if (kind === 'episode') {
    const ep = sqlite.prepare(`SELECT series_id FROM episodes WHERE id = ?`).get(contentId) as { series_id?: string } | undefined
    const sud = sqlite.prepare(`SELECT * FROM episode_user_data WHERE profile_id = ? AND episode_id = ?`).get(DEFAULT_PROFILE, contentId) as EpisodeUDRow | undefined
    if (sud) { position = sud.watch_position ?? 0; lastWatched = sud.last_watched_at ?? null; completed = sud.completed ?? 0 }
    if (ep?.series_id) {
      const srow = sqlite.prepare(`SELECT * FROM series_user_data WHERE profile_id = ? AND series_id = ?`).get(DEFAULT_PROFILE, ep.series_id) as SeriesUDRow | undefined
      if (srow) { fav = srow.is_favorite ?? 0; wl = srow.is_watchlisted ?? 0; rating = srow.rating ?? null }
    }
  }

  if (!fav && !wl && !rating && !position && !lastWatched && !completed) return null
  return {
    content_id: contentId,
    favorite: fav,
    watchlist: wl,
    rating,
    last_position: position,
    last_watched_at: lastWatched,
    completed,
    fav_sort_order: favSort,
  }
}

/**
 * Batched variant of {@link readUserData} for bulk IPC. One `WHERE id IN (…)`
 * query per content-kind instead of N sequential point reads — keeps the
 * Browse / Home strips responsive when cards mount in bulk.
 */
export function bulkReadUserData(
  sqlite: ReturnType<typeof getSqlite>,
  contentIds: string[]
): Record<string, any> {
  const out: Record<string, any> = {}
  const byKind: Record<'channel' | 'movie' | 'series' | 'episode', string[]> = {
    channel: [], movie: [], series: [], episode: [],
  }
  for (const id of contentIds) {
    const k = idKind(id)
    if (k) byKind[k].push(id)
  }

  const placeholders = (n: number) => Array(n).fill('?').join(',')
  const emit = (id: string, patch: {
    favorite?: number; watchlist?: number; rating?: number | null;
    last_position?: number; last_watched_at?: number | null; completed?: number;
    fav_sort_order?: number | null;
  }) => {
    const cur = out[id] ?? {
      content_id: id, favorite: 0, watchlist: 0, rating: null,
      last_position: 0, last_watched_at: null, completed: 0, fav_sort_order: null,
    }
    out[id] = { ...cur, ...patch }
  }

  if (byKind.channel.length) {
    const rows = sqlite.prepare(
      `SELECT channel_id, is_favorite, fav_sort_order
         FROM channel_user_data
        WHERE profile_id = ? AND channel_id IN (${placeholders(byKind.channel.length)})`
    ).all(DEFAULT_PROFILE, ...byKind.channel) as { channel_id: string; is_favorite: number; fav_sort_order: number | null }[]
    for (const r of rows) {
      emit(r.channel_id, { favorite: r.is_favorite ?? 0, fav_sort_order: r.fav_sort_order ?? null })
    }
  }

  if (byKind.movie.length) {
    const rows = sqlite.prepare(
      `SELECT movie_id, is_favorite, is_watchlisted, rating, fav_sort_order,
              watch_position, last_watched_at, completed
         FROM movie_user_data
        WHERE profile_id = ? AND movie_id IN (${placeholders(byKind.movie.length)})`
    ).all(DEFAULT_PROFILE, ...byKind.movie) as { movie_id: string; is_favorite: number; is_watchlisted: number; rating: number | null; fav_sort_order: number | null; watch_position: number; last_watched_at: number | null; completed: number }[]
    for (const r of rows) {
      emit(r.movie_id, {
        favorite: r.is_favorite ?? 0,
        watchlist: r.is_watchlisted ?? 0,
        rating: r.rating ?? null,
        fav_sort_order: r.fav_sort_order ?? null,
        last_position: r.watch_position ?? 0,
        last_watched_at: r.last_watched_at ?? null,
        completed: r.completed ?? 0,
      })
    }
  }

  if (byKind.series.length) {
    const rows = sqlite.prepare(
      `SELECT series_id, is_favorite, is_watchlisted, rating, fav_sort_order
         FROM series_user_data
        WHERE profile_id = ? AND series_id IN (${placeholders(byKind.series.length)})`
    ).all(DEFAULT_PROFILE, ...byKind.series) as { series_id: string; is_favorite: number; is_watchlisted: number; rating: number | null; fav_sort_order: number | null }[]
    for (const r of rows) {
      emit(r.series_id, {
        favorite: r.is_favorite ?? 0,
        watchlist: r.is_watchlisted ?? 0,
        rating: r.rating ?? null,
        fav_sort_order: r.fav_sort_order ?? null,
      })
    }
  }

  if (byKind.episode.length) {
    // Episode own-state (position/completed)
    const epRows = sqlite.prepare(
      `SELECT episode_id, watch_position, last_watched_at, completed
         FROM episode_user_data
        WHERE profile_id = ? AND episode_id IN (${placeholders(byKind.episode.length)})`
    ).all(DEFAULT_PROFILE, ...byKind.episode) as { episode_id: string; watch_position: number; last_watched_at: number | null; completed: number }[]
    for (const r of epRows) {
      emit(r.episode_id, {
        last_position: r.watch_position ?? 0,
        last_watched_at: r.last_watched_at ?? null,
        completed: r.completed ?? 0,
      })
    }
    // Parent series lookup → inherits fav / watchlist / rating
    const parentRows = sqlite.prepare(
      `SELECT id AS episode_id, series_id FROM episodes
        WHERE id IN (${placeholders(byKind.episode.length)})`
    ).all(...byKind.episode) as { episode_id: string; series_id: string }[]
    const seriesIds = Array.from(new Set(parentRows.map((r) => r.series_id).filter(Boolean)))
    if (seriesIds.length) {
      const sudRows = sqlite.prepare(
        `SELECT series_id, is_favorite, is_watchlisted, rating
           FROM series_user_data
          WHERE profile_id = ? AND series_id IN (${placeholders(seriesIds.length)})`
      ).all(DEFAULT_PROFILE, ...seriesIds) as { series_id: string; is_favorite: number; is_watchlisted: number; rating: number | null }[]
      const sudById = new Map<string, { series_id: string; is_favorite: number; is_watchlisted: number; rating: number | null }>()
      for (const r of sudRows) sudById.set(r.series_id, r)
      for (const pr of parentRows) {
        const s = sudById.get(pr.series_id)
        if (!s) continue
        emit(pr.episode_id, {
          favorite: s.is_favorite ?? 0,
          watchlist: s.is_watchlisted ?? 0,
          rating: s.rating ?? null,
        })
      }
    }
  }

  // Drop all-zero rows — mirrors the single-row null-return behavior of readUserData.
  for (const id of Object.keys(out)) {
    const d = out[id]
    if (!d.favorite && !d.watchlist && !d.rating && !d.last_position && !d.last_watched_at && !d.completed) {
      delete out[id]
    }
  }
  return out
}

export function toggleFavorite(sqlite: ReturnType<typeof getSqlite>, contentId: string): boolean {
  const kind = idKind(contentId)
  if (kind === 'channel') {
    sqlite.prepare(`
      INSERT INTO channel_user_data (profile_id, channel_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, channel_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, contentId)
    const row = sqlite.prepare(`SELECT is_favorite FROM channel_user_data WHERE profile_id = ? AND channel_id = ?`).get(DEFAULT_PROFILE, contentId) as { is_favorite: number } | undefined
    return !!row?.is_favorite
  }
  if (kind === 'movie') {
    sqlite.prepare(`
      INSERT INTO movie_user_data (profile_id, movie_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, movie_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, contentId)
    const row = sqlite.prepare(`SELECT is_favorite FROM movie_user_data WHERE profile_id = ? AND movie_id = ?`).get(DEFAULT_PROFILE, contentId) as { is_favorite: number } | undefined
    return !!row?.is_favorite
  }
  if (kind === 'series') {
    sqlite.prepare(`
      INSERT INTO series_user_data (profile_id, series_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, series_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, contentId)
    const row = sqlite.prepare(`SELECT is_favorite FROM series_user_data WHERE profile_id = ? AND series_id = ?`).get(DEFAULT_PROFILE, contentId) as { is_favorite: number } | undefined
    return !!row?.is_favorite
  }
  if (kind === 'episode') {
    const ep = sqlite.prepare(`SELECT series_id FROM episodes WHERE id = ?`).get(contentId) as { series_id?: string } | undefined
    if (!ep?.series_id) return false
    return toggleFavorite(sqlite, ep.series_id)
  }
  return false
}

export function toggleWatchlist(sqlite: ReturnType<typeof getSqlite>, contentId: string): boolean {
  const kind = idKind(contentId)
  if (kind === 'movie') {
    sqlite.prepare(`
      INSERT INTO movie_user_data (profile_id, movie_id, is_watchlisted)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, movie_id) DO UPDATE SET is_watchlisted = NOT is_watchlisted
    `).run(DEFAULT_PROFILE, contentId)
    const row = sqlite.prepare(`SELECT is_watchlisted FROM movie_user_data WHERE profile_id = ? AND movie_id = ?`).get(DEFAULT_PROFILE, contentId) as { is_watchlisted: number } | undefined
    return !!row?.is_watchlisted
  }
  if (kind === 'series') {
    sqlite.prepare(`
      INSERT INTO series_user_data (profile_id, series_id, is_watchlisted)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, series_id) DO UPDATE SET is_watchlisted = NOT is_watchlisted
    `).run(DEFAULT_PROFILE, contentId)
    const row = sqlite.prepare(`SELECT is_watchlisted FROM series_user_data WHERE profile_id = ? AND series_id = ?`).get(DEFAULT_PROFILE, contentId) as { is_watchlisted: number } | undefined
    return !!row?.is_watchlisted
  }
  if (kind === 'episode') {
    const ep = sqlite.prepare(`SELECT series_id FROM episodes WHERE id = ?`).get(contentId) as { series_id?: string } | undefined
    if (!ep?.series_id) return false
    return toggleWatchlist(sqlite, ep.series_id)
  }
  // Channels do not have a watchlist.
  return false
}

export function listFavorites(sqlite: ReturnType<typeof getSqlite>, type?: 'live' | 'movie' | 'series'): unknown[] {
  const results: unknown[] = []

  if (!type || type === 'movie') {
    const rows = sqlite.prepare(`
      SELECT ${MOVIE_SELECT},
             ud.fav_sort_order            AS fav_sort_order,
             ud.last_watched_at           AS last_watched_at,
             1                             AS favorite
      FROM movie_user_data ud
      JOIN movies m ON m.id = ud.movie_id
      JOIN sources src ON src.id = m.source_id AND src.disabled = 0
      WHERE ud.is_favorite = 1 AND ud.profile_id = ?
      ORDER BY COALESCE(ud.fav_sort_order, 999999) ASC, ud.last_watched_at DESC
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  if (!type || type === 'series') {
    const rows = sqlite.prepare(`
      SELECT ${SERIES_SELECT},
             ud.fav_sort_order            AS fav_sort_order,
             NULL                          AS last_watched_at,
             1                             AS favorite
      FROM series_user_data ud
      JOIN series sr ON sr.id = ud.series_id
      JOIN sources src ON src.id = sr.source_id AND src.disabled = 0
      WHERE ud.is_favorite = 1 AND ud.profile_id = ?
      ORDER BY COALESCE(ud.fav_sort_order, 999999) ASC
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  if (!type || type === 'live') {
    const rows = sqlite.prepare(`
      SELECT ${CHANNEL_SELECT},
             cud.fav_sort_order            AS fav_sort_order,
             NULL                           AS last_watched_at,
             1                             AS favorite
      FROM channel_user_data cud
      JOIN channels c ON c.id = cud.channel_id
      JOIN sources src ON src.id = c.source_id AND src.disabled = 0
      WHERE cud.is_favorite = 1 AND cud.profile_id = ?
      ORDER BY COALESCE(cud.fav_sort_order, 999999) ASC
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  return results
}

export function listWatchlist(sqlite: ReturnType<typeof getSqlite>, type?: 'live' | 'movie' | 'series'): unknown[] {
  const results: unknown[] = []
  if (!type || type === 'movie') {
    const rows = sqlite.prepare(`
      SELECT ${MOVIE_SELECT},
             ud.last_watched_at           AS last_watched_at
      FROM movie_user_data ud
      JOIN movies m ON m.id = ud.movie_id
      JOIN sources src ON src.id = m.source_id AND src.disabled = 0
      WHERE ud.is_watchlisted = 1 AND ud.profile_id = ?
      ORDER BY ud.last_watched_at DESC
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  if (!type || type === 'series') {
    const rows = sqlite.prepare(`
      SELECT ${SERIES_SELECT}
      FROM series_user_data ud
      JOIN series sr ON sr.id = ud.series_id
      JOIN sources src ON src.id = sr.source_id AND src.disabled = 0
      WHERE ud.is_watchlisted = 1 AND ud.profile_id = ?
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  return results
}

export function listContinueWatching(sqlite: ReturnType<typeof getSqlite>, type?: 'movie' | 'series'): unknown[] {
  const moviesSql = `
    SELECT ${MOVIE_SELECT},
           ud.watch_position AS last_position,
           ud.last_watched_at
    FROM movie_user_data ud
    JOIN movies m ON m.id = ud.movie_id
    JOIN sources src ON src.id = m.source_id AND src.disabled = 0
    WHERE ud.watch_position > 0 AND ud.completed = 0 AND ud.profile_id = ?
    ORDER BY ud.last_watched_at DESC
    LIMIT 20
  `

  // Series: most-recent in-progress episode per parent series.
  // Keyed on episodes.series_id; episode_user_data holds position/last_watched.
  const seriesSql = `
    WITH ranked_episodes AS (
      SELECT
        e.series_id,
        e.id                    AS resume_episode_id,
        e.season                AS resume_season_number,
        e.episode_num           AS resume_episode_number,
        e.title                 AS resume_episode_title,
        ud.watch_position       AS last_position,
        ud.last_watched_at,
        ROW_NUMBER() OVER (PARTITION BY e.series_id ORDER BY ud.last_watched_at DESC) AS rn
      FROM episode_user_data ud
      JOIN episodes e ON e.id = ud.episode_id
      WHERE ud.watch_position > 0 AND ud.completed = 0 AND ud.profile_id = ?
    )
    SELECT ${SERIES_SELECT},
           r.resume_episode_id, r.resume_season_number, r.resume_episode_number,
           r.resume_episode_title, r.last_position, r.last_watched_at
    FROM ranked_episodes r
    JOIN series sr ON sr.id = r.series_id
    JOIN sources src ON src.id = sr.source_id AND src.disabled = 0
    WHERE r.rn = 1
    ORDER BY r.last_watched_at DESC
    LIMIT 20
  `

  if (type === 'movie')  return sqlite.prepare(moviesSql).all(DEFAULT_PROFILE) as unknown[]
  if (type === 'series') return sqlite.prepare(seriesSql).all(DEFAULT_PROFILE) as unknown[]

  const movies = sqlite.prepare(moviesSql).all(DEFAULT_PROFILE) as { last_watched_at: number | null }[]
  const series = sqlite.prepare(seriesSql).all(DEFAULT_PROFILE) as { last_watched_at: number | null }[]
  return [...movies, ...series]
    .sort((a, b) => (b.last_watched_at ?? 0) - (a.last_watched_at ?? 0))
    .slice(0, 20)
}

export function listHistory(sqlite: ReturnType<typeof getSqlite>, limit: number): unknown[] {
  // Movie history.
  const movieRows = sqlite.prepare(`
    SELECT ${MOVIE_SELECT},
           ud.watch_position AS last_position,
           ud.last_watched_at
    FROM movie_user_data ud
    JOIN movies m ON m.id = ud.movie_id
    JOIN sources src ON src.id = m.source_id AND src.disabled = 0
    WHERE ud.last_watched_at IS NOT NULL AND ud.profile_id = ?
    ORDER BY ud.last_watched_at DESC
    LIMIT ?
  `).all(DEFAULT_PROFILE, limit) as { id: string; last_watched_at: number | null }[]

  // Series history — collapse per-series to the most recent episode.
  const episodeRows = sqlite.prepare(`
    WITH ranked_episodes AS (
      SELECT
        e.series_id,
        e.id                    AS resume_episode_id,
        e.season                AS resume_season_number,
        e.episode_num           AS resume_episode_number,
        e.title                 AS resume_episode_title,
        ud.watch_position       AS last_position,
        ud.last_watched_at,
        ROW_NUMBER() OVER (PARTITION BY e.series_id ORDER BY ud.last_watched_at DESC) AS rn
      FROM episode_user_data ud
      JOIN episodes e ON e.id = ud.episode_id
      WHERE ud.last_watched_at IS NOT NULL AND ud.profile_id = ?
    )
    SELECT ${SERIES_SELECT},
           r.resume_episode_id, r.resume_season_number, r.resume_episode_number,
           r.resume_episode_title, r.last_position, r.last_watched_at
    FROM ranked_episodes r
    JOIN series sr ON sr.id = r.series_id
    JOIN sources src ON src.id = sr.source_id AND src.disabled = 0
    WHERE r.rn = 1
    ORDER BY r.last_watched_at DESC
    LIMIT ?
  `).all(DEFAULT_PROFILE, limit) as { id: string; last_watched_at: number | null }[]

  const seen = new Set<string>()
  return [...movieRows, ...episodeRows]
    .sort((a, b) => (b.last_watched_at ?? 0) - (a.last_watched_at ?? 0))
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true })
    .slice(0, limit)
}

// ─── Sync worker map ─────────────────────────────────────────────────────
// `activeSyncWorkers` allows cancel mid-flight.
// Defined here (shared) to avoid circular imports between sources.ts and sync.ts.
export const activeSyncWorkers = new Map<string, Worker>()

// ─── External player paths ───────────────────────────────────────────────

export function findMpv(): string {
  if (process.platform === 'win32') {
    for (const p of [join('C:', 'Program Files', 'mpv', 'mpv.exe'), join('C:', 'Program Files (x86)', 'mpv', 'mpv.exe')]) {
      if (existsSync(p)) return p
    }
  } else if (process.platform === 'darwin') {
    for (const p of ['/Applications/mpv.app/Contents/MacOS/mpv', '/opt/homebrew/bin/mpv', '/usr/local/bin/mpv']) {
      if (existsSync(p)) return p
    }
  } else {
    for (const p of ['/usr/bin/mpv', '/usr/local/bin/mpv', '/snap/bin/mpv']) {
      if (existsSync(p)) return p
    }
  }
  return 'mpv'
}

export function findVlc(): string {
  if (process.platform === 'win32') {
    for (const p of [join('C:', 'Program Files', 'VideoLAN', 'VLC', 'vlc.exe'), join('C:', 'Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe')]) {
      if (existsSync(p)) return p
    }
  } else if (process.platform === 'darwin') {
    for (const p of ['/Applications/VLC.app/Contents/MacOS/VLC', '/opt/homebrew/bin/vlc']) {
      if (existsSync(p)) return p
    }
  } else {
    for (const p of ['/usr/bin/vlc', '/usr/local/bin/vlc', '/snap/bin/vlc']) {
      if (existsSync(p)) return p
    }
  }
  return 'vlc'
}
