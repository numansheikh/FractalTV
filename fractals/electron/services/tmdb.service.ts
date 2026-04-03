/**
 * TMDB enrichment service.
 *
 * Fetches metadata for movies and series from The Movie Database API.
 * Rate-limited to 35 req/s (TMDB allows 40, we stay a bit under).
 *
 * To use: set TMDB_API_KEY environment variable, or call setApiKey() before enriching.
 */

import { getSqlite } from '../database/connection'

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
    // Wait for next refill window
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

  private get key(): string {
    return this.apiKey ?? process.env.TMDB_API_KEY ?? ''
  }

  private async fetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
    if (!this.key) return null
    await limiter.acquire()
    const qs = new URLSearchParams({ api_key: this.key, language: 'en-US', ...params })
    const url = `https://api.themoviedb.org/3${path}?${qs}`
    try {
      const res = await globalThis.fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return null
      return res.json() as Promise<T>
    } catch {
      return null
    }
  }

  async searchMovie(title: string, year?: number): Promise<TmdbMovie | null> {
    const params: Record<string, string> = { query: title }
    if (year) params.year = String(year)
    const data = await this.fetch<{ results: TmdbMovie[] }>('/search/movie', params)
    return data?.results?.[0] ?? null
  }

  async searchTv(title: string, year?: number): Promise<TmdbTv | null> {
    const params: Record<string, string> = { query: title }
    if (year) params.first_air_date_year = String(year)
    const data = await this.fetch<{ results: TmdbTv[] }>('/search/tv', params)
    return data?.results?.[0] ?? null
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
   * Enrich a batch of content items from the DB.
   * Skips already-enriched items. Updates DB in place.
   */
  async enrichBatch(
    contentIds: string[],
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    const sqlite = getSqlite()
    const total = contentIds.length
    let done = 0

    for (const contentId of contentIds) {
      const item = sqlite.prepare('SELECT * FROM content WHERE id = ?').get(contentId) as any
      if (!item || item.enriched) { done++; continue }
      if (item.type === 'live') { done++; continue } // skip live channels

      const year = item.year ?? undefined

      // Clean up title — strip common IPTV prefixes like "IR - ", "TR | ", "US: "
      const cleanTitle = item.title
        .replace(/^[A-Z]{2,4}[\s\-:|]+/i, '')
        .replace(/\s*(HD|FHD|4K|SD|UHD)\s*$/i, '')
        .trim()

      try {
        if (item.type === 'movie') {
          await this.enrichMovie(sqlite, item, cleanTitle, year)
        } else if (item.type === 'series') {
          await this.enrichSeries(sqlite, item, cleanTitle, year)
        }
      } catch {
        // Non-fatal — mark as attempted so we don't retry immediately
      }

      done++
      onProgress?.(done, total)
    }
  }

  private async enrichMovie(sqlite: any, item: any, title: string, year?: number) {
    // Try with year, then without
    let match = await this.searchMovie(title, year)
    if (!match && year) match = await this.searchMovie(title)
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
      UPDATE content SET
        tmdb_id = ?, original_title = ?, year = ?, plot = ?,
        poster_url = ?, backdrop_url = ?,
        rating_tmdb = ?, genres = ?, languages = ?,
        director = ?, cast = ?, keywords = ?,
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
      plot: details.overview,
      cast: cast.join(' '),
      director,
      genres: genres.join(' '),
      keywords: keywords.join(' '),
    })
  }

  private async enrichSeries(sqlite: any, item: any, title: string, year?: number) {
    let match = await this.searchTv(title, year)
    if (!match && year) match = await this.searchTv(title)
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
      UPDATE content SET
        tmdb_id = ?, original_title = ?, year = ?, plot = ?,
        poster_url = ?, backdrop_url = ?,
        rating_tmdb = ?, genres = ?, languages = ?,
        cast = ?, keywords = ?, runtime = ?,
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
      plot: details.overview,
      cast: cast.join(' '),
      director: null,
      genres: genres.join(' '),
      keywords: keywords.join(' '),
    })
  }

  private markEnriched(sqlite: any, contentId: string) {
    sqlite.prepare('UPDATE content SET enriched = 1, enriched_at = unixepoch() WHERE id = ?').run(contentId)
  }

  private updateFts(sqlite: any, contentId: string, fields: {
    title: string; originalTitle?: string; plot?: string
    cast?: string; director?: string | null; genres?: string; keywords?: string
  }) {
    function norm(s?: string | null): string | null {
      if (!s) return null
      return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    }
    sqlite.prepare(`
      INSERT OR REPLACE INTO content_fts (content_id, title, original_title, plot, cast, director, genres, keywords)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contentId,
      norm(fields.title),
      norm(fields.originalTitle),
      norm(fields.plot),
      norm(fields.cast),
      norm(fields.director),
      norm(fields.genres),
      norm(fields.keywords),
    )
  }
}

export const tmdbService = new TmdbService()
