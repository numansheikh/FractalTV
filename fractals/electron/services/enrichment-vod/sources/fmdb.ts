/**
 * FM-DB API client — keyless IMDb wrapper.
 * Returns billing-order cast (#ACTORS), IMDb ID, poster, and rank in a single call.
 * Endpoint: https://imdb.iamidiotareyoutoo.com/search?q={query}
 */

const FMDB_BASE = 'https://imdb.iamidiotareyoutoo.com/search'
const UA = 'FractalTV/3.0 (vod-enrichment; contact: github.com/FractalTV)'
const TIMEOUT_MS = 10_000

export interface FmdbResult {
  imdb_id: string | null
  title: string
  year: number | null
  actors: string[]      // billing order, from '#ACTORS' comma-separated
  poster_url: string | null
  rank: number | null   // IMDb rank — lower = more popular
}

// Circuit breaker
const cbFailures: Record<string, number> = {}
const cbPausedUntil: Record<string, number> = {}
const CB_THRESHOLD = 5
const CB_PAUSE_MS = 30_000
const CB_HOST = 'imdb.iamidiotareyoutoo.com'

export async function searchFmdb(query: string): Promise<FmdbResult | null> {
  if (cbPausedUntil[CB_HOST] && Date.now() < cbPausedUntil[CB_HOST]) return null

  const url = `${FMDB_BASE}?q=${encodeURIComponent(query)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA },
    })
    if (!res.ok) {
      cbFailures[CB_HOST] = (cbFailures[CB_HOST] ?? 0) + 1
      if (cbFailures[CB_HOST] >= CB_THRESHOLD) {
        cbPausedUntil[CB_HOST] = Date.now() + CB_PAUSE_MS
        cbFailures[CB_HOST] = 0
      }
      return null
    }
    cbFailures[CB_HOST] = 0

    const json = await res.json() as any
    const desc = json?.description?.[0]
    if (!desc) return null

    const actorsRaw: string = desc['#ACTORS'] ?? ''
    const actors = actorsRaw
      ? actorsRaw.split(',').map((a: string) => a.trim()).filter(Boolean)
      : []

    return {
      imdb_id: (desc['#IMDB_ID'] as string) || null,
      title: (desc['#TITLE'] as string) ?? '',
      year: desc['#YEAR'] ? Number(desc['#YEAR']) : null,
      actors,
      poster_url: (desc['#IMG_POSTER'] as string) || null,
      rank: desc['#RANK'] != null ? Number(desc['#RANK']) : null,
    }
  } catch {
    cbFailures[CB_HOST] = (cbFailures[CB_HOST] ?? 0) + 1
    if (cbFailures[CB_HOST] >= CB_THRESHOLD) {
      cbPausedUntil[CB_HOST] = Date.now() + CB_PAUSE_MS
      cbFailures[CB_HOST] = 0
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}
