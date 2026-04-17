/**
 * VoD enrichment service — orchestrates extraction algo runs for a full source.
 *
 * Called by the IPC handler for 'vodEnrich:enrich'. Iterates all movies + series
 * for a source, runs ExtractionAlgoV1 per title, persists results to
 * movie_enrichment_g2 / series_enrichment_g2.
 *
 * Rate-limited to be neighbor-friendly with Wikipedia + Wikidata.
 */

import { getSqlite, getSetting } from '../../database/connection'
import { enrichTitle, normalizeTitle, ALGO_VERSION } from './algo-v3'
import { fetchTvmaze } from './sources/tvmaze'
import { fetchTmdb } from './sources/tmdb'
import type { EnrichProgress, VodEnrichmentCandidate, VodEnrichmentForContent, VodEnrichmentRow } from './types'

// Minimum ms between title enrichment calls (Wikipedia/Wikidata rate-limit courtesy)
const REQUEST_DELAY_MS = 600

/** Merge TVmaze data into a candidate. TVmaze wins for cast + genres when it has data. */
function mergeTvmaze(c: VodEnrichmentCandidate, tvmaze: NonNullable<Awaited<ReturnType<typeof fetchTvmaze>>>): VodEnrichmentCandidate {
  return {
    ...c,
    tvmaze_id: tvmaze.tvmaze_id,
    status: tvmaze.status,
    network: tvmaze.network,
    rating: tvmaze.rating,
    cast: tvmaze.cast.length > 0 ? tvmaze.cast : c.cast,
    genres: tvmaze.genres.length > 0 ? tvmaze.genres : c.genres,
    sources_used: [...(c.sources_used ?? []), 'tvmaze'],
  }
}

/** Current enrichment level: 0=off, 1=keyless (v3+TVmaze), 2=TMDB */
function getEnrichmentLevel(): '0' | '1' | '2' {
  return ((getSetting('enrichment_level') as string) || '1') as '0' | '1' | '2'
}

/** Read TMDB API key from settings. Returns null if level !== 2 or key not set. */
function getTmdbApiKey(): string | null {
  if (getEnrichmentLevel() !== '2') return null
  return getSetting('tmdb_api_key') || null
}

/** Merge TMDB data into a candidate. TMDB wins for backdrop, poster, vote average, cast, genres, overview. */
function mergeTmdb(c: VodEnrichmentCandidate, tmdb: NonNullable<Awaited<ReturnType<typeof fetchTmdb>>>): VodEnrichmentCandidate {
  const isSeries = tmdb.season_count !== null || tmdb.episode_count !== null
  return {
    ...c,
    tmdb_id: tmdb.tmdb_id,
    backdrop_url: tmdb.backdrop_url,
    poster_url: tmdb.poster_url ?? c.poster_url,
    tmdb_vote_average: tmdb.vote_average,
    tmdb_vote_count: tmdb.vote_count,
    cast: tmdb.cast.length > 0 ? tmdb.cast : c.cast,
    directors: tmdb.director ? [tmdb.director] : c.directors,
    genres: tmdb.genres.length > 0 ? tmdb.genres : c.genres,
    overview: tmdb.overview ?? c.overview,
    runtime_min: tmdb.runtime_min ?? c.runtime_min,
    // Series-specific — don't overwrite with TMDB's movie status ("Released")
    status: isSeries ? (tmdb.status ?? c.status) : c.status,
    network: isSeries ? (tmdb.network ?? c.network) : c.network,
    creator: tmdb.creator,
    season_count: tmdb.season_count,
    episode_count: tmdb.episode_count,
    sources_used: [...(c.sources_used ?? []), 'tmdb'],
  }
}

/**
 * Augment already-enriched rows with TMDB data if not yet fetched.
 * Non-destructive — updates raw_json in-place, doesn't re-run v3.
 */
async function augmentWithTmdb(contentId: string, db: ReturnType<typeof getSqlite>, apiKey: string) {
  const isMovie = contentId.includes(':movie:')
  const table = isMovie ? 'movie_enrichment_g2' : 'series_enrichment_g2'
  const col = isMovie ? 'movie_id' : 'series_id'

  const existing = db.prepare(
    `SELECT id, imdb_id, tmdb_id, raw_json FROM ${table} WHERE ${col} = ? AND confidence > 0`
  ).all(contentId) as Array<{ id: number; imdb_id: string | null; tmdb_id: string | null; raw_json: string }>

  if (!existing.length) return
  // Already has TMDB data — tmdb_id column is the canonical flag
  if (existing[0].tmdb_id) return

  const imdbId = existing[0].imdb_id
  const tmdb = await fetchTmdb(imdbId, apiKey)
  if (!tmdb) return

  const update = db.prepare(`UPDATE ${table} SET tmdb_id = ?, raw_json = ? WHERE id = ?`)
  for (const row of existing) {
    try {
      const candidate = JSON.parse(row.raw_json) as VodEnrichmentCandidate
      const merged = mergeTmdb(candidate, tmdb)
      update.run(tmdb.tmdb_id, JSON.stringify(merged), row.id)
    } catch {
      // Malformed raw_json — skip
    }
  }
}

/**
 * Augment already-enriched series rows with TVmaze data if not yet fetched.
 * Non-destructive — updates raw_json in-place, doesn't re-run v3.
 */
async function augmentSeriesWithTvmaze(seriesId: string, db: ReturnType<typeof getSqlite>) {
  const existing = db.prepare(
    `SELECT id, imdb_id, tvmaze_id, raw_json FROM series_enrichment_g2 WHERE series_id = ? AND confidence > 0`
  ).all(seriesId) as Array<{ id: number; imdb_id: string | null; tvmaze_id: string | null; raw_json: string }>

  if (!existing.length) return
  // Already has TVmaze
  if (existing[0].tvmaze_id) return

  // Load series title for fallback search
  const seriesRow = db.prepare(`SELECT title, md_year FROM series WHERE id = ?`).get(seriesId) as { title: string; md_year: number | null } | undefined
  if (!seriesRow) return

  const imdbId = existing[0].imdb_id
  const tvmaze = await fetchTvmaze(imdbId, seriesRow.title, seriesRow.md_year)
  if (!tvmaze) return

  const update = db.prepare(
    `UPDATE series_enrichment_g2 SET tvmaze_id = ?, raw_json = ? WHERE id = ?`
  )
  for (const row of existing) {
    try {
      const candidate = JSON.parse(row.raw_json) as VodEnrichmentCandidate
      const merged = mergeTvmaze(candidate, tvmaze)
      update.run(tvmaze.tvmaze_id, JSON.stringify(merged), row.id)
    } catch {
      // Malformed raw_json — skip
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface ContentTitleRow {
  id: string
  title: string
  search_title: string | null
  md_year: number | null
  md_language: string | null
  provider_metadata: string | null
}

function extractImdbFromMetadata(metadata: string | null): { imdb_id?: string; tmdb_id?: string } {
  if (!metadata) return {}
  try {
    const m = JSON.parse(metadata) as Record<string, any>
    return {
      imdb_id: m.imdb_id ?? m.kinopoisk_id ?? undefined,
      tmdb_id: m.tmdb_id ?? undefined,
    }
  } catch {
    return {}
  }
}

/**
 * Enrich all movies + series for a source.
 * Already-enriched titles (any existing rows) are skipped unless `force` is true.
 * Progress callback receives EnrichProgress events.
 */
export async function enrichForSource(
  sourceId: string,
  onProgress: (p: EnrichProgress) => void,
  force = false,
): Promise<{ movies: number; series: number }> {
  if (getEnrichmentLevel() === '0') return { movies: 0, series: 0 }

  const db = getSqlite()

  // Load all movies + series for source (include provider_metadata for imdb_id hints)
  const movies = db.prepare(`
    SELECT id, title, search_title, md_year, md_language, provider_metadata
    FROM movies WHERE source_id = ? ORDER BY title
  `).all(sourceId) as ContentTitleRow[]

  const seriesItems = db.prepare(`
    SELECT id, title, search_title, md_year, md_language, provider_metadata
    FROM series WHERE source_id = ? ORDER BY title
  `).all(sourceId) as ContentTitleRow[]

  const allItems = [
    ...movies.map((m) => ({ ...m, kind: 'movie' as const })),
    ...seriesItems.map((s) => ({ ...s, kind: 'series' as const })),
  ]

  // Split: items needing full enrichment vs. already enriched but missing TVmaze/TMDB
  const toEnrich: typeof allItems = []
  const toAugment: typeof allItems = []
  const enrichLevel = getEnrichmentLevel()
  const tmdbKey = getTmdbApiKey()
  if (!force) {
    for (const item of allItems) {
      const table = item.kind === 'movie' ? 'movie_enrichment_g2' : 'series_enrichment_g2'
      const col = item.kind === 'movie' ? 'movie_id' : 'series_id'
      const selectCols = item.kind === 'series' ? 'tvmaze_id, tmdb_id' : 'tmdb_id'
      const row = db.prepare(`SELECT ${selectCols} FROM ${table} WHERE ${col} = ? AND algo_version = ? LIMIT 1`).get(item.id, ALGO_VERSION) as { tvmaze_id?: string | null; tmdb_id: string | null } | undefined
      if (!row) {
        toEnrich.push(item)
      } else {
        const needsTvmaze = enrichLevel === '1' && item.kind === 'series' && !row.tvmaze_id
        const needsTmdb = enrichLevel === '2' && !!tmdbKey && !row.tmdb_id
        if (needsTvmaze || needsTmdb) toAugment.push(item)
      }
    }
  } else {
    toEnrich.push(...allItems)
  }

  const total = toEnrich.length + toAugment.length
  onProgress({ phase: 'starting', current: 0, total, message: `${total} titles to enrich` })

  let doneMovies = 0
  let doneSeries = 0
  let current = 0

  const insertMovie = db.prepare(`
    INSERT OR REPLACE INTO movie_enrichment_g2
      (movie_id, algo_version, imdb_id, tmdb_id, wikidata_qid, confidence, fetched_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch(), ?)
  `)
  const insertSeries = db.prepare(`
    INSERT OR REPLACE INTO series_enrichment_g2
      (series_id, algo_version, imdb_id, tmdb_id, wikidata_qid, tvmaze_id, confidence, fetched_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), ?)
  `)

  for (const item of toEnrich) {
    current++
    const { imdb_id, tmdb_id } = extractImdbFromMetadata(item.provider_metadata)
    const { year } = normalizeTitle(item.title)
    const effectiveYear = item.md_year ?? year

    onProgress({
      phase: 'enriching',
      current,
      total,
      message: item.title,
    })

    const candidates = await enrichTitle({
      title: item.title,
      year: effectiveYear,
      imdb_id: imdb_id ?? null,
      tmdb_id: tmdb_id ?? null,
      search_title: item.search_title ?? null,
      md_year: item.md_year ?? null,
      md_language: item.md_language ?? null,
    })
    const resolvedImdbId = candidates[0]?.imdb_id ?? imdb_id ?? null
    const tvmaze = enrichLevel === '1' && item.kind === 'series' && candidates.length > 0
      ? await fetchTvmaze(resolvedImdbId, item.title, effectiveYear)
      : null
    const tmdb = enrichLevel === '2' && candidates.length > 0 && tmdbKey
      ? await fetchTmdb(resolvedImdbId, tmdbKey)
      : null

    if (candidates.length === 0) {
      // Sentinel row — prevents re-hitting on every detail open
      const insert = item.kind === 'movie' ? insertMovie : insertSeries
      if (item.kind === 'series') {
        insert.run(item.id, ALGO_VERSION, null, null, null, tvmaze?.tvmaze_id ?? null, 0, '{}')
      } else {
        insert.run(item.id, ALGO_VERSION, null, null, null, 0, '{}')
      }
    } else {
      const insert = item.kind === 'movie' ? insertMovie : insertSeries
      const table = item.kind === 'movie' ? 'movie_enrichment_g2' : 'series_enrichment_g2'
      const col = item.kind === 'movie' ? 'movie_id' : 'series_id'
      db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(item.id)

      for (const c of candidates) {
        let merged = tvmaze ? mergeTvmaze(c, tvmaze) : c
        if (tmdb) merged = mergeTmdb(merged, tmdb)
        if (item.kind === 'series') {
          insertSeries.run(
            item.id, ALGO_VERSION, merged.imdb_id ?? null, merged.tmdb_id ?? null,
            merged.wikidata_qid ?? null, merged.tvmaze_id ?? null, merged.confidence, JSON.stringify(merged),
          )
        } else {
          insertMovie.run(
            item.id, ALGO_VERSION, merged.imdb_id ?? null, merged.tmdb_id ?? null,
            merged.wikidata_qid ?? null, merged.confidence, JSON.stringify(merged),
          )
        }
      }
      if (item.kind === 'movie') doneMovies++
      else doneSeries++
    }

    // Rate limiting — be courteous to Wikipedia + Wikidata
    if (current < total) await delay(REQUEST_DELAY_MS)
  }

  // Augment already-enriched items missing TVmaze (level 1) or TMDB (level 2)
  for (const item of toAugment) {
    current++
    onProgress({ phase: 'enriching', current, total, message: `Augmenting: ${item.title}` })
    if (enrichLevel === '1' && item.kind === 'series') await augmentSeriesWithTvmaze(item.id, db)
    if (enrichLevel === '2' && tmdbKey) await augmentWithTmdb(item.id, db, tmdbKey)
    if (current < total) await delay(300)
  }

  onProgress({ phase: 'done', current: total, total, message: `Enriched ${doneMovies + doneSeries} titles` })
  return { movies: doneMovies, series: doneSeries }
}

/**
 * Enrich a single content item on-demand (called when detail card opens).
 * Skips if rows already exist. Returns candidates after persisting.
 */
export async function enrichSingle(contentId: string, force = false): Promise<VodEnrichmentForContent> {
  if (getEnrichmentLevel() === '0') return getForContent(contentId)

  const db = getSqlite()
  const isMovie = contentId.includes(':movie:')
  const table = isMovie ? 'movie_enrichment_g2' : 'series_enrichment_g2'
  const col = isMovie ? 'movie_id' : 'series_id'
  const contentTable = isMovie ? 'movies' : 'series'

  if (force) {
    db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(contentId)
  } else {
    // Already enriched with current algo version
    const existing = db.prepare(`SELECT 1 FROM ${table} WHERE ${col} = ? AND algo_version = ? AND confidence > 0 LIMIT 1`).get(contentId, ALGO_VERSION)
    if (existing) {
      const level = getEnrichmentLevel()
      // Augment with TVmaze (level 1 series only) or TMDB (level 2)
      if (level === '1' && !isMovie) await augmentSeriesWithTvmaze(contentId, db)
      if (level === '2') {
        const tmdbKey = getTmdbApiKey()
        if (tmdbKey) await augmentWithTmdb(contentId, db, tmdbKey)
      }
      return getForContent(contentId)
    }
  }

  const row = db.prepare(`SELECT title, search_title, md_year, md_language, provider_metadata FROM ${contentTable} WHERE id = ?`).get(contentId) as ContentTitleRow | undefined
  if (!row) return getForContent(contentId)

  const { imdb_id, tmdb_id } = extractImdbFromMetadata(row.provider_metadata)
  const { year } = normalizeTitle(row.title)
  const effectiveYear = row.md_year ?? year

  const level = getEnrichmentLevel()
  const tmdbKey = getTmdbApiKey()

  const candidates = await enrichTitle({
    title: row.title,
    year: effectiveYear,
    imdb_id: imdb_id ?? null,
    tmdb_id: tmdb_id ?? null,
    search_title: row.search_title ?? null,
    md_year: row.md_year ?? null,
    md_language: row.md_language ?? null,
  })
  const resolvedImdbId = candidates[0]?.imdb_id ?? imdb_id ?? null
  const tvmaze = level === '1' && !isMovie && candidates.length > 0
    ? await fetchTvmaze(resolvedImdbId, row.title, effectiveYear)
    : null
  const tmdb = level === '2' && candidates.length > 0 && tmdbKey
    ? await fetchTmdb(resolvedImdbId, tmdbKey)
    : null

  if (candidates.length === 0) {
    if (isMovie) {
      db.prepare(`INSERT OR REPLACE INTO ${table} (${col}, algo_version, imdb_id, tmdb_id, wikidata_qid, confidence, fetched_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, unixepoch(), ?)`)
        .run(contentId, ALGO_VERSION, null, null, null, 0, '{}')
    } else {
      db.prepare(`INSERT OR REPLACE INTO ${table} (${col}, algo_version, imdb_id, tmdb_id, wikidata_qid, tvmaze_id, confidence, fetched_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), ?)`)
        .run(contentId, ALGO_VERSION, null, null, null, tvmaze?.tvmaze_id ?? null, 0, '{}')
    }
  } else {
    db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(contentId)
    for (const c of candidates) {
      let merged = tvmaze ? mergeTvmaze(c, tvmaze) : c
      if (tmdb) merged = mergeTmdb(merged, tmdb)
      if (isMovie) {
        db.prepare(`INSERT OR REPLACE INTO ${table} (${col}, algo_version, imdb_id, tmdb_id, wikidata_qid, confidence, fetched_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, unixepoch(), ?)`)
          .run(contentId, ALGO_VERSION, merged.imdb_id ?? null, merged.tmdb_id ?? null, merged.wikidata_qid ?? null, merged.confidence, JSON.stringify(merged))
      } else {
        db.prepare(`INSERT OR REPLACE INTO ${table} (${col}, algo_version, imdb_id, tmdb_id, wikidata_qid, tvmaze_id, confidence, fetched_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), ?)`)
          .run(contentId, ALGO_VERSION, merged.imdb_id ?? null, merged.tmdb_id ?? null, merged.wikidata_qid ?? null, merged.tvmaze_id ?? null, merged.confidence, JSON.stringify(merged))
      }
    }
  }

  return getForContent(contentId)
}

/**
 * Return enrichment candidates + selection state for a single content item.
 */
export function getForContent(contentId: string): VodEnrichmentForContent {
  const db = getSqlite()

  // Determine content type from id format: {sourceId}:movie:xxx or :series:xxx
  const isMovie = contentId.includes(':movie:')
  const table = isMovie ? 'movie_enrichment_g2' : 'series_enrichment_g2'
  const col = isMovie ? 'movie_id' : 'series_id'
  const contentTable = isMovie ? 'movies' : 'series'

  const rows = db.prepare(`
    SELECT id, ${col} AS content_id, algo_version, imdb_id, tmdb_id, wikidata_qid,
           confidence, fetched_at, raw_json
    FROM ${table}
    WHERE ${col} = ? AND algo_version = ?
    ORDER BY confidence DESC
  `).all(contentId, ALGO_VERSION) as VodEnrichmentRow[]

  const meta = db.prepare(`
    SELECT selected_enrichment_id, enrichment_disabled FROM ${contentTable} WHERE id = ?
  `).get(contentId) as { selected_enrichment_id: number | null; enrichment_disabled: number } | undefined

  return {
    disabled: (meta?.enrichment_disabled ?? 0) === 1,
    selected_id: meta?.selected_enrichment_id ?? null,
    candidates: rows,
  }
}

/**
 * Pin a specific enrichment candidate for a content item.
 */
export function pickCandidate(contentId: string, enrichmentId: number): void {
  const db = getSqlite()
  const isMovie = contentId.includes(':movie:')
  const table = isMovie ? 'movies' : 'series'
  db.prepare(`
    UPDATE ${table}
    SET selected_enrichment_id = ?, enrichment_disabled = 0
    WHERE id = ?
  `).run(enrichmentId, contentId)
}

/**
 * Disable enrichment for a content item (user rejected all candidates).
 */
export function disableEnrichment(contentId: string): void {
  const db = getSqlite()
  const isMovie = contentId.includes(':movie:')
  const table = isMovie ? 'movies' : 'series'
  db.prepare(`
    UPDATE ${table}
    SET enrichment_disabled = 1, selected_enrichment_id = NULL
    WHERE id = ?
  `).run(contentId)
}

/**
 * Reset enrichment selection (re-enable auto-pick).
 */
export function resetEnrichment(contentId: string): void {
  const db = getSqlite()
  const isMovie = contentId.includes(':movie:')
  const table = isMovie ? 'movies' : 'series'
  db.prepare(`
    UPDATE ${table}
    SET enrichment_disabled = 0, selected_enrichment_id = NULL
    WHERE id = ?
  `).run(contentId)
}

/**
 * Count enriched rows per type for status display.
 */
export function getEnrichStatus(): { movies_enriched: number; series_enriched: number } {
  const db = getSqlite()
  const m = db.prepare(
    `SELECT COUNT(DISTINCT movie_id) AS n FROM movie_enrichment_g2 WHERE confidence > 0`
  ).get() as { n: number }
  const s = db.prepare(
    `SELECT COUNT(DISTINCT series_id) AS n FROM series_enrichment_g2 WHERE confidence > 0`
  ).get() as { n: number }
  return { movies_enriched: m?.n ?? 0, series_enriched: s?.n ?? 0 }
}
