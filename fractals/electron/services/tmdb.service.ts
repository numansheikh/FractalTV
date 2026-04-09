/**
 * TMDB enrichment service.
 *
 * Fetches metadata for movies and series from The Movie Database API.
 * Rate-limited to 35 req/s (TMDB allows 40, we stay a bit under).
 *
 * Writes enriched data to the `canonical` table (v2 schema).
 */

import { getSqlite } from '../database/connection'
import { normalizeForSearch } from '../lib/normalize'

// ─── Rate limiter ─────────────────────────────────────────────────────────────

class RateLimiter {
  private tokens: number
  private lastRefill: number
  constructor(private readonly rps: number) {
    this.tokens = rps
    this.lastRefill = Date.now()
  }
  async acquire(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    if (elapsed >= 1000) {
      this.tokens = this.rps
      this.lastRefill = now
    }
    if (this.tokens > 0) {
      this.tokens--
      return
    }
    const wait = 1000 - (Date.now() - this.lastRefill)
    await new Promise((r) => setTimeout(r, wait + 10))
    return this.acquire()
  }
}

const limiter = new RateLimiter(35)

// ─── Types ────────────────────────────────────────────────────────────────────

interface TmdbMovie {
  id: number
  title: string
  original_title: string
  overview: string
  release_date: string
  vote_average: number
  poster_path: string | null
  backdrop_path: string | null
  genre_ids?: number[]
  genres?: { id: number; name: string }[]
}

interface TmdbTv {
  id: number
  name: string
  original_name: string
  overview: string
  first_air_date: string
  vote_average: number
  poster_path: string | null
  backdrop_path: string | null
  genre_ids?: number[]
  genres?: { id: number; name: string }[]
}

interface TmdbMovieDetails extends TmdbMovie {
  genres: { id: number; name: string }[]
  runtime: number
  original_language: string
  credits?: {
    cast: { name: string; order: number }[]
    crew: { name: string; job: string }[]
  }
  keywords?: { keywords: { name: string }[] }
}

interface TmdbTvDetails extends TmdbTv {
  genres: { id: number; name: string }[]
  episode_run_time: number[]
  original_language: string
  credits?: {
    cast: { name: string; order: number }[]
    crew: { name: string; job: string }[]
  }
  keywords?: { results: { name: string }[] }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class TmdbService {
  private apiKey: string | null = null
  private readonly imageBase = 'https://image.tmdb.org/t/p'

  setApiKey(key: string) {
    this.apiKey = key
  }

  hasKey(): boolean {
    return !!(this.apiKey || process.env.TMDB_API_KEY)
  }

  private get key(): string {
    return this.apiKey ?? process.env.TMDB_API_KEY ?? ''
  }

  private async fetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
    if (!this.key) {
      console.warn('[TMDB] No API key set — skipping fetch')
      return null
    }
    await limiter.acquire()
    const qs = new URLSearchParams({ api_key: this.key, language: 'en-US', ...params })
    const url = `https://api.themoviedb.org/3${path}?${qs}`
    try {
      const res = await globalThis.fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) {
        console.warn(`[TMDB] ${path} → HTTP ${res.status}`)
        return null
      }
      return res.json() as Promise<T>
    } catch (err) {
      console.warn(`[TMDB] ${path} → fetch error:`, err)
      return null
    }
  }

  async searchMovie(title: string, year?: number): Promise<TmdbMovie | null> {
    const results = await this.searchMovieMulti(title, year)
    return results[0] ?? null
  }

  async searchMovieMulti(title: string, year?: number, limit = 8): Promise<TmdbMovie[]> {
    const params: Record<string, string> = { query: title }
    if (year) params.year = String(year)
    const data = await this.fetch<{ results: TmdbMovie[] }>('/search/movie', params)
    return (data?.results ?? []).slice(0, limit)
  }

  async searchTv(title: string, year?: number): Promise<TmdbTv | null> {
    const results = await this.searchTvMulti(title, year)
    return results[0] ?? null
  }

  async searchTvMulti(title: string, year?: number, limit = 8): Promise<TmdbTv[]> {
    const params: Record<string, string> = { query: title }
    if (year) params.first_air_date_year = String(year)
    const data = await this.fetch<{ results: TmdbTv[] }>('/search/tv', params)
    return (data?.results ?? []).slice(0, limit)
  }

  async getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails | null> {
    return this.fetch<TmdbMovieDetails>(`/movie/${tmdbId}`, {
      append_to_response: 'credits,keywords',
    })
  }

  async getTvDetails(tmdbId: number): Promise<TmdbTvDetails | null> {
    return this.fetch<TmdbTvDetails>(`/tv/${tmdbId}`, {
      append_to_response: 'credits,keywords',
    })
  }

  posterUrl(path: string | null, size: 'w185' | 'w342' | 'w500' | 'original' = 'w342'): string | null {
    if (!path) return null
    return `${this.imageBase}/${size}${path}`
  }

  backdropUrl(path: string | null, size: 'w780' | 'w1280' | 'original' = 'w780'): string | null {
    if (!path) return null
    return `${this.imageBase}/${size}${path}`
  }

  /**
   * Enrich a batch of canonical items from the DB.
   * Skips already-enriched items. Updates canonical table in place.
   */
  async enrichBatch(
    canonicalIds: string[],
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    const sqlite = getSqlite()
    const total = canonicalIds.length
    let done = 0

    for (const canonicalId of canonicalIds) {
      const item = sqlite.prepare('SELECT * FROM canonical WHERE id = ?').get(canonicalId) as any
      if (!item || item.enriched) { done++; continue }
      if (item.type === 'channel' || item.type === 'episode') { done++; continue }

      const { titles, year } = this.buildSearchCandidates(item.title, item.year)

      try {
        if (item.type === 'movie') {
          await this.enrichMovie(sqlite, item, titles, year)
        } else if (item.type === 'series') {
          await this.enrichSeries(sqlite, item, titles, year)
        }
      } catch {
        // Non-fatal — mark as attempted so we don't retry immediately
      }

      done++
      onProgress?.(done, total)
    }
  }

  /**
   * Enrich a single canonical item using a user-provided search title.
   */
  async enrichWithTitle(canonicalId: string, searchTitle: string, type: string, year?: number): Promise<void> {
    const sqlite = getSqlite()
    const item = sqlite.prepare('SELECT * FROM canonical WHERE id = ?').get(canonicalId) as any
    if (!item) return

    if (type === 'movie') {
      await this.enrichMovie(sqlite, item, [searchTitle], year)
    } else if (type === 'series') {
      await this.enrichSeries(sqlite, item, [searchTitle], year)
    }
  }

  /**
   * Enrich a canonical item with a specific TMDB ID chosen by the user.
   */
  async enrichById(canonicalId: string, tmdbId: number, type: string): Promise<void> {
    const sqlite = getSqlite()
    const item = sqlite.prepare('SELECT * FROM canonical WHERE id = ?').get(canonicalId) as any
    if (!item) return

    // Reset enriched flag so the enrichment writes
    sqlite.prepare('UPDATE canonical SET enriched = 0 WHERE id = ?').run(canonicalId)

    if (type === 'movie') {
      const details = await this.getMovieDetails(tmdbId)
      if (!details) { this.markEnriched(sqlite, canonicalId); return }

      const cast = details.credits?.cast?.sort((a, b) => a.order - b.order).slice(0, 12).map(c => c.name) ?? []
      const director = details.credits?.crew.find(c => c.job === 'Director')?.name ?? null
      const genres = details.genres.map(g => g.name)
      const keywords = details.keywords?.keywords.slice(0, 20).map(k => k.name) ?? []

      sqlite.prepare(`
        UPDATE canonical SET
          tmdb_id = ?, original_title = ?, year = ?, overview = ?,
          poster_path = ?, backdrop_path = ?,
          vote_average = ?, genres = ?, languages = ?,
          director = ?, cast_json = ?, keywords = ?,
          runtime = ?, enriched = 1, enriched_at = unixepoch()
        WHERE id = ?
      `).run(
        details.id,
        details.original_title !== details.title ? details.original_title : null,
        details.release_date ? parseInt(details.release_date.substring(0, 4)) : item.year,
        details.overview || null,
        this.posterUrl(details.poster_path),
        this.backdropUrl(details.backdrop_path),
        details.vote_average > 0 ? details.vote_average : null,
        genres.length ? JSON.stringify(genres) : null,
        details.original_language ?? null,
        director,
        cast.length ? JSON.stringify(cast) : null,
        keywords.length ? JSON.stringify(keywords) : null,
        details.runtime || null,
        canonicalId,
      )

      this.updateFts(sqlite, canonicalId, {
        title: details.title, originalTitle: details.original_title,
        overview: details.overview, cast: cast.join(' '), director,
        genres: genres.join(' '), keywords: keywords.join(' '),
      })
    } else if (type === 'series') {
      const details = await this.getTvDetails(tmdbId)
      if (!details) { this.markEnriched(sqlite, canonicalId); return }

      const cast = details.credits?.cast?.sort((a, b) => a.order - b.order).slice(0, 12).map(c => c.name) ?? []
      const genres = details.genres.map(g => g.name)
      const keywords = details.keywords?.results.slice(0, 20).map(k => k.name) ?? []

      sqlite.prepare(`
        UPDATE canonical SET
          tmdb_id = ?, original_title = ?, year = ?, overview = ?,
          poster_path = ?, backdrop_path = ?,
          vote_average = ?, genres = ?, languages = ?,
          cast_json = ?, keywords = ?, runtime = ?,
          enriched = 1, enriched_at = unixepoch()
        WHERE id = ?
      `).run(
        details.id,
        details.original_name !== details.name ? details.original_name : null,
        details.first_air_date ? parseInt(details.first_air_date.substring(0, 4)) : item.year,
        details.overview || null,
        this.posterUrl(details.poster_path),
        this.backdropUrl(details.backdrop_path),
        details.vote_average > 0 ? details.vote_average : null,
        genres.length ? JSON.stringify(genres) : null,
        details.original_language ?? null,
        cast.length ? JSON.stringify(cast) : null,
        keywords.length ? JSON.stringify(keywords) : null,
        details.episode_run_time?.[0] ?? null,
        canonicalId,
      )

      this.updateFts(sqlite, canonicalId, {
        title: details.name, originalTitle: details.original_name,
        overview: details.overview, cast: cast.join(' '), director: null,
        genres: genres.join(' '), keywords: keywords.join(' '),
      })
    }
  }

  /**
   * Build progressively cleaned title candidates from an IPTV title.
   */
  private buildSearchCandidates(rawTitle: string, dbYear?: number | null): { titles: string[]; year?: number } {
    let base = rawTitle
      .replace(/^[A-Z]{2,4}[\s]*[\-–:|][\s]*/i, '')
      .replace(/\s*(HD|FHD|4K|SD|UHD)\s*$/i, '')
      .trim()

    let year = dbYear ?? undefined
    if (!year) {
      const yearMatch = base.match(/\((\d{4})\)\s*$/)
      if (yearMatch) {
        year = parseInt(yearMatch[1])
        base = base.replace(/\s*\(\d{4}\)\s*$/, '').trim()
      }
    }

    const candidates: string[] = [base]

    const colonIdx = base.indexOf(':')
    if (colonIdx > 2) {
      candidates.push(base.substring(0, colonIdx).trim())
    }

    const dashIdx = base.indexOf(' - ')
    if (dashIdx > 2) {
      candidates.push(base.substring(0, dashIdx).trim())
    }

    const seen = new Set<string>()
    const unique = candidates.filter(t => {
      if (!t || seen.has(t)) return false
      seen.add(t)
      return true
    })

    return { titles: unique, year }
  }

  private async enrichMovie(sqlite: any, item: any, titles: string[], year?: number) {
    let match: TmdbMovie | null = null
    for (const title of titles) {
      match = await this.searchMovie(title, year)
      if (!match && year) match = await this.searchMovie(title)
      if (match) break
    }
    if (!match) {
      this.markEnriched(sqlite, item.id)
      return
    }

    const details = await this.getMovieDetails(match.id)
    if (!details) { this.markEnriched(sqlite, item.id); return }

    const cast = details.credits?.cast
      .sort((a, b) => a.order - b.order)
      .slice(0, 12)
      .map((c) => c.name) ?? []
    const director = details.credits?.crew.find((c) => c.job === 'Director')?.name ?? null
    const genres = details.genres.map((g) => g.name)
    const keywords = details.keywords?.keywords.slice(0, 20).map((k) => k.name) ?? []

    sqlite.prepare(`
      UPDATE canonical SET
        tmdb_id = ?, original_title = ?, year = ?, overview = ?,
        poster_path = ?, backdrop_path = ?,
        vote_average = ?, genres = ?, languages = ?,
        director = ?, cast_json = ?, keywords = ?,
        runtime = ?, enriched = 1, enriched_at = unixepoch()
      WHERE id = ?
    `).run(
      details.id,
      details.original_title !== details.title ? details.original_title : null,
      details.release_date ? parseInt(details.release_date.substring(0, 4)) : item.year,
      details.overview || null,
      this.posterUrl(details.poster_path),
      this.backdropUrl(details.backdrop_path),
      details.vote_average > 0 ? details.vote_average : null,
      genres.length ? JSON.stringify(genres) : null,
      details.original_language ?? null,
      director,
      cast.length ? JSON.stringify(cast) : null,
      keywords.length ? JSON.stringify(keywords) : null,
      details.runtime || null,
      item.id,
    )

    this.updateFts(sqlite, item.id, {
      title: details.title,
      originalTitle: details.original_title,
      overview: details.overview,
      cast: cast.join(' '),
      director,
      genres: genres.join(' '),
      keywords: keywords.join(' '),
    })
  }

  private async enrichSeries(sqlite: any, item: any, titles: string[], year?: number) {
    let match: TmdbTv | null = null
    for (const title of titles) {
      match = await this.searchTv(title, year)
      if (!match && year) match = await this.searchTv(title)
      if (match) break
    }
    if (!match) { this.markEnriched(sqlite, item.id); return }

    const details = await this.getTvDetails(match.id)
    if (!details) { this.markEnriched(sqlite, item.id); return }

    const cast = details.credits?.cast
      .sort((a, b) => a.order - b.order)
      .slice(0, 12)
      .map((c) => c.name) ?? []
    const genres = details.genres.map((g) => g.name)
    const keywords = details.keywords?.results.slice(0, 20).map((k) => k.name) ?? []
    const runtime = details.episode_run_time?.[0] ?? null

    sqlite.prepare(`
      UPDATE canonical SET
        tmdb_id = ?, original_title = ?, year = ?, overview = ?,
        poster_path = ?, backdrop_path = ?,
        vote_average = ?, genres = ?, languages = ?,
        cast_json = ?, keywords = ?, runtime = ?,
        enriched = 1, enriched_at = unixepoch()
      WHERE id = ?
    `).run(
      details.id,
      details.original_name !== details.name ? details.original_name : null,
      details.first_air_date ? parseInt(details.first_air_date.substring(0, 4)) : item.year,
      details.overview || null,
      this.posterUrl(details.poster_path),
      this.backdropUrl(details.backdrop_path),
      details.vote_average > 0 ? details.vote_average : null,
      genres.length ? JSON.stringify(genres) : null,
      details.original_language ?? null,
      cast.length ? JSON.stringify(cast) : null,
      keywords.length ? JSON.stringify(keywords) : null,
      runtime,
      item.id,
    )

    this.updateFts(sqlite, item.id, {
      title: details.name,
      originalTitle: details.original_name,
      overview: details.overview,
      cast: cast.join(' '),
      director: null,
      genres: genres.join(' '),
      keywords: keywords.join(' '),
    })
  }

  private markEnriched(sqlite: any, canonicalId: string) {
    sqlite.prepare('UPDATE canonical SET enriched = 1, enriched_at = unixepoch() WHERE id = ?').run(canonicalId)
  }

  private updateFts(sqlite: any, canonicalId: string, fields: {
    title: string; originalTitle?: string; overview?: string
    cast?: string; director?: string | null; genres?: string; keywords?: string
  }) {
    sqlite.prepare(`
      INSERT OR REPLACE INTO canonical_fts (canonical_id, title, original_title, overview, cast_json, director, genres, keywords)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      canonicalId,
      normalizeForSearch(fields.title ?? ''),
      normalizeForSearch(fields.originalTitle ?? ''),
      normalizeForSearch(fields.overview ?? ''),
      normalizeForSearch(fields.cast ?? ''),
      normalizeForSearch(fields.director ?? ''),
      normalizeForSearch(fields.genres ?? ''),
      normalizeForSearch(fields.keywords ?? ''),
    )
  }
}

export const tmdbService = new TmdbService()
