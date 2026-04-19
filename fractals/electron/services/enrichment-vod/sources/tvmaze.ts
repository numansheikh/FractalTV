/**
 * TVmaze source — free, no API key required.
 * Rate limit: 20 calls / 10 seconds per IP.
 *
 * We use two endpoints (both return the same show shape):
 *   /lookup/shows?imdb={id}&embed=cast  — direct IMDb ID lookup (preferred)
 *   /singlesearch/shows?q={title}&embed=cast  — title search fallback
 *
 * Only fields we actually display are extracted. No episode metadata, no images.
 */

const BASE = 'https://api.tvmaze.com'
const TIMEOUT_MS = 10_000

export interface TvmazeShowData {
  tvmaze_id: string
  status: string | null       // "Running" | "Ended" | "To Be Determined"
  network: string | null      // "AMC" | "Netflix" | null
  rating: number | null       // 0.0..10.0
  cast: string[]              // top 10 actor names
  genres: string[]
}

function parseShow(data: any): TvmazeShowData {
  const network = data.network?.name ?? data.webChannel?.name ?? null
  const rating = typeof data.rating?.average === 'number' ? data.rating.average : null
  const genres: string[] = Array.isArray(data.genres) ? data.genres.slice(0, 6) : []
  const cast: string[] = []
  if (Array.isArray(data._embedded?.cast)) {
    for (const c of data._embedded.cast.slice(0, 10)) {
      const name = c.person?.name
      if (name && typeof name === 'string') cast.push(name)
    }
  }
  return {
    tvmaze_id: String(data.id),
    status: data.status ?? null,
    network,
    rating,
    cast,
    genres,
  }
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (resp.status === 404) return null
    if (!resp.ok) throw new Error(`TVmaze HTTP ${resp.status}`)
    return await resp.json()
  } catch {
    return null
  }
}

/** Direct lookup by IMDb ID — unambiguous, use when available. */
export async function lookupByImdbId(imdbId: string): Promise<TvmazeShowData | null> {
  const data = await fetchJson(`${BASE}/lookup/shows?imdb=${encodeURIComponent(imdbId)}&embed=cast`)
  if (!data?.id) return null
  return parseShow(data)
}

/** Title search fallback. Returns best match or null. */
export async function searchByTitle(title: string, year?: number | null): Promise<TvmazeShowData | null> {
  const data = await fetchJson(`${BASE}/singlesearch/shows?q=${encodeURIComponent(title)}&embed=cast`)
  if (!data?.id) return null
  // Sanity check: if year is known, reject results more than 2 years off
  if (year && data.premiered) {
    const showYear = parseInt(data.premiered.slice(0, 4), 10)
    if (Math.abs(showYear - year) > 2) return null
  }
  return parseShow(data)
}

/** Fetch TVmaze data, preferring IMDb ID lookup. */
export async function fetchTvmaze(
  imdbId: string | null,
  title: string,
  year?: number | null,
): Promise<TvmazeShowData | null> {
  if (imdbId) {
    const result = await lookupByImdbId(imdbId)
    if (result) return result
  }
  return searchByTitle(title, year)
}
