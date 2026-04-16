/**
 * VoD enrichment service — orchestrates extraction algo runs for a full source.
 *
 * Called by the IPC handler for 'vodEnrich:enrich'. Iterates all movies + series
 * for a source, runs ExtractionAlgoV1 per title, persists results to
 * movie_enrichment_g2 / series_enrichment_g2.
 *
 * Rate-limited to be neighbor-friendly with Wikipedia + Wikidata.
 */

import { getSqlite } from '../../database/connection'
import { enrichTitle, normalizeTitle, ALGO_VERSION } from './algo-v2'
import type { EnrichProgress, VodEnrichmentForContent, VodEnrichmentRow } from './types'

// Minimum ms between title enrichment calls (Wikipedia/Wikidata rate-limit courtesy)
const REQUEST_DELAY_MS = 600

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface ContentTitleRow {
  id: string
  title: string
  md_year: number | null
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
  const db = getSqlite()

  // Load all movies + series for source (include provider_metadata for imdb_id hints)
  const movies = db.prepare(`
    SELECT id, title, md_year, provider_metadata
    FROM movies WHERE source_id = ? ORDER BY title
  `).all(sourceId) as ContentTitleRow[]

  const seriesItems = db.prepare(`
    SELECT id, title, md_year, provider_metadata
    FROM series WHERE source_id = ? ORDER BY title
  `).all(sourceId) as ContentTitleRow[]

  const allItems = [
    ...movies.map((m) => ({ ...m, kind: 'movie' as const })),
    ...seriesItems.map((s) => ({ ...s, kind: 'series' as const })),
  ]

  // Skip already-enriched unless force
  const toEnrich = force
    ? allItems
    : allItems.filter((item) => {
        const table = item.kind === 'movie' ? 'movie_enrichment_g2' : 'series_enrichment_g2'
        const col = item.kind === 'movie' ? 'movie_id' : 'series_id'
        const row = db.prepare(`SELECT 1 FROM ${table} WHERE ${col} = ? AND algo_version = ? LIMIT 1`).get(item.id, ALGO_VERSION)
        return !row
      })

  const total = toEnrich.length
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
      (series_id, algo_version, imdb_id, tmdb_id, wikidata_qid, confidence, fetched_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch(), ?)
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
    })

    if (candidates.length === 0) {
      // Sentinel row — prevents re-hitting on every detail open
      const insert = item.kind === 'movie' ? insertMovie : insertSeries
      const idCol = item.kind === 'movie' ? item.id : item.id
      insert.run(idCol, ALGO_VERSION, null, null, null, 0, '{}')
    } else {
      // Insert all candidates (highest confidence first)
      const insert = item.kind === 'movie' ? insertMovie : insertSeries
      // Delete old rows for this item first (clean re-run)
      const table = item.kind === 'movie' ? 'movie_enrichment_g2' : 'series_enrichment_g2'
      const col = item.kind === 'movie' ? 'movie_id' : 'series_id'
      db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(item.id)

      for (const c of candidates) {
        insert.run(
          item.id,
          ALGO_VERSION,
          c.imdb_id ?? null,
          c.tmdb_id ?? null,
          c.wikidata_qid ?? null,
          c.confidence,
          JSON.stringify(c),
        )
      }
      if (item.kind === 'movie') doneMovies++
      else doneSeries++
    }

    // Rate limiting — be courteous to Wikipedia + Wikidata
    if (current < total) await delay(REQUEST_DELAY_MS)
  }

  onProgress({ phase: 'done', current: total, total, message: `Enriched ${doneMovies + doneSeries} titles` })
  return { movies: doneMovies, series: doneSeries }
}

/**
 * Enrich a single content item on-demand (called when detail card opens).
 * Skips if rows already exist. Returns candidates after persisting.
 */
export async function enrichSingle(contentId: string, force = false): Promise<VodEnrichmentForContent> {
  const db = getSqlite()
  const isMovie = contentId.includes(':movie:')
  const table = isMovie ? 'movie_enrichment_g2' : 'series_enrichment_g2'
  const col = isMovie ? 'movie_id' : 'series_id'
  const contentTable = isMovie ? 'movies' : 'series'

  if (force) {
    // Wipe existing rows so a fresh fetch runs regardless of prior results
    db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(contentId)
  } else {
    // Already enriched with current algo version (real candidates, not just sentinels)
    const existing = db.prepare(`SELECT 1 FROM ${table} WHERE ${col} = ? AND algo_version = ? AND confidence > 0 LIMIT 1`).get(contentId, ALGO_VERSION)
    if (existing) return getForContent(contentId)
  }

  // Load title/year/metadata for this item
  const row = db.prepare(`SELECT title, md_year, provider_metadata FROM ${contentTable} WHERE id = ?`).get(contentId) as ContentTitleRow | undefined
  if (!row) return getForContent(contentId)

  const { imdb_id, tmdb_id } = extractImdbFromMetadata(row.provider_metadata)
  const { year } = normalizeTitle(row.title)
  const effectiveYear = row.md_year ?? year

  const candidates = await enrichTitle({
    title: row.title,
    year: effectiveYear,
    imdb_id: imdb_id ?? null,
    tmdb_id: tmdb_id ?? null,
  })

  const insert = db.prepare(`
    INSERT OR REPLACE INTO ${table}
      (${col}, algo_version, imdb_id, tmdb_id, wikidata_qid, confidence, fetched_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch(), ?)
  `)

  if (candidates.length === 0) {
    insert.run(contentId, ALGO_VERSION, null, null, null, 0, '{}')
  } else {
    db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(contentId)
    for (const c of candidates) {
      insert.run(contentId, ALGO_VERSION, c.imdb_id ?? null, c.tmdb_id ?? null, c.wikidata_qid ?? null, c.confidence, JSON.stringify(c))
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
