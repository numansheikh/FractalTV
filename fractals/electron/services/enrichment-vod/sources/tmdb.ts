/**
 * TMDB (The Movie Database) source — requires free API key.
 * Rate limit: ~40 requests / 10 seconds on free tier.
 *
 * Flow per item:
 *   1. GET /find/{imdb_id}?external_source=imdb_id  →  resolve TMDB ID
 *   2. GET /movie/{id}?append_to_response=credits   →  full movie data
 *      GET /tv/{id}?append_to_response=credits      →  full TV data
 *
 * Only proceeds when an IMDb ID is known (resolved by v3 algo). Title-based
 * searches are skipped to avoid false positives.
 */

const BASE = 'https://api.themoviedb.org/3'
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500'
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280'
const TIMEOUT_MS = 10_000

export interface TmdbData {
  tmdb_id: string
  backdrop_url: string | null
  poster_url: string | null
  vote_average: number | null
  vote_count: number | null
  cast: string[]           // top 10 actor names
  director: string | null  // movies — first Director from credits.crew
  creator: string | null   // series — first name from created_by
  genres: string[]
  overview: string | null
  runtime_min: number | null  // movies only
  // Series-specific
  season_count: number | null
  episode_count: number | null
  status: string | null       // "Returning Series" | "Ended" | "Canceled"
  network: string | null
}

async function fetchJson(url: string, apiKey: string): Promise<any | null> {
  try {
    const sep = url.includes('?') ? '&' : '?'
    const resp = await fetch(`${url}${sep}api_key=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (resp.status === 404) return null
    if (!resp.ok) throw new Error(`TMDB HTTP ${resp.status}`)
    return await resp.json()
  } catch {
    return null
  }
}

async function findTmdbId(
  imdbId: string,
  apiKey: string,
): Promise<{ tmdbId: string; kind: 'movie' | 'tv' } | null> {
  const data = await fetchJson(
    `${BASE}/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`,
    apiKey,
  )
  if (!data) return null
  const movie = data.movie_results?.[0]
  if (movie?.id) return { tmdbId: String(movie.id), kind: 'movie' }
  const tv = data.tv_results?.[0]
  if (tv?.id) return { tmdbId: String(tv.id), kind: 'tv' }
  return null
}

function parseCast(credits: any): string[] {
  if (!Array.isArray(credits?.cast)) return []
  return credits.cast.slice(0, 10).map((c: any) => c.name).filter(Boolean)
}

function parseGenres(data: any): string[] {
  if (!Array.isArray(data?.genres)) return []
  return data.genres.slice(0, 6).map((g: any) => g.name).filter(Boolean)
}

function parseDirector(credits: any): string | null {
  if (!Array.isArray(credits?.crew)) return null
  const dir = credits.crew.find((c: any) => c.job === 'Director')
  return dir?.name ?? null
}

async function fetchMovieDetails(tmdbId: string, apiKey: string): Promise<TmdbData | null> {
  const data = await fetchJson(`${BASE}/movie/${tmdbId}?append_to_response=credits`, apiKey)
  if (!data?.id) return null
  return {
    tmdb_id: String(data.id),
    backdrop_url: data.backdrop_path ? `${BACKDROP_BASE}${data.backdrop_path}` : null,
    poster_url: data.poster_path ? `${POSTER_BASE}${data.poster_path}` : null,
    vote_average: typeof data.vote_average === 'number' ? data.vote_average : null,
    vote_count: typeof data.vote_count === 'number' ? data.vote_count : null,
    cast: parseCast(data.credits),
    director: parseDirector(data.credits),
    creator: null,
    genres: parseGenres(data),
    overview: data.overview ?? null,
    runtime_min: typeof data.runtime === 'number' && data.runtime > 0 ? data.runtime : null,
    season_count: null,
    episode_count: null,
    status: null,
    network: null,
  }
}

async function fetchSeriesDetails(tmdbId: string, apiKey: string): Promise<TmdbData | null> {
  const data = await fetchJson(`${BASE}/tv/${tmdbId}?append_to_response=credits`, apiKey)
  if (!data?.id) return null
  const network = Array.isArray(data.networks) && data.networks.length > 0
    ? (data.networks[0].name ?? null)
    : null
  const creator = Array.isArray(data.created_by) && data.created_by.length > 0
    ? (data.created_by[0].name ?? null)
    : null
  return {
    tmdb_id: String(data.id),
    backdrop_url: data.backdrop_path ? `${BACKDROP_BASE}${data.backdrop_path}` : null,
    poster_url: data.poster_path ? `${POSTER_BASE}${data.poster_path}` : null,
    vote_average: typeof data.vote_average === 'number' ? data.vote_average : null,
    vote_count: typeof data.vote_count === 'number' ? data.vote_count : null,
    cast: parseCast(data.credits),
    director: null,
    creator,
    genres: parseGenres(data),
    overview: data.overview ?? null,
    runtime_min: null,
    season_count: typeof data.number_of_seasons === 'number' ? data.number_of_seasons : null,
    episode_count: typeof data.number_of_episodes === 'number' ? data.number_of_episodes : null,
    status: data.status ?? null,
    network,
  }
}

/**
 * Fetch TMDB data for a content item using its IMDb ID.
 * Returns null if key is missing, IMDb ID is unavailable, or any request fails.
 * Kind is determined by TMDB's /find result, not the caller — TMDB is authoritative.
 */
export async function fetchTmdb(
  imdbId: string | null,
  apiKey: string,
): Promise<TmdbData | null> {
  if (!imdbId || !apiKey) return null

  const found = await findTmdbId(imdbId, apiKey)
  if (!found) return null

  if (found.kind === 'movie') return fetchMovieDetails(found.tmdbId, apiKey)
  return fetchSeriesDetails(found.tmdbId, apiKey)
}
