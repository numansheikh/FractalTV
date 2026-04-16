import type { ImdbSuggestResult } from '../types'

const UA = 'FractalTV/2.0 (vod-enrichment; contact: github.com/numansheikh/FractalTV)'

interface ImdbSuggestItem {
  id?: string
  l?: string      // title
  q?: string      // type ("feature", "TV series", ...)
  y?: number      // year
  s?: string      // stars
  i?: { imageUrl?: string; width?: number; height?: number }
}

/**
 * Query IMDb suggest endpoint (keyless, unofficial).
 * Returns feature films matching the query, filtered by year if provided.
 *
 * URL: https://v2.sg.media-imdb.com/suggestion/{first_char}/{query}.json
 */
export async function searchImdbSuggest(
  title: string,
  year?: number | null,
): Promise<ImdbSuggestResult[]> {
  // Build query string — lowercase, spaces → underscores (IMDb convention)
  const q = title.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  if (!q) return []
  const firstChar = q[0]

  const url = `https://v2.sg.media-imdb.com/suggestion/${firstChar}/${q}.json`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA } })
    clearTimeout(timer)
    if (!res.ok) return []
    const json = await res.json() as { d?: ImdbSuggestItem[] }
    const items: ImdbSuggestItem[] = json.d ?? []

    // Filter to feature films only
    let results: ImdbSuggestResult[] = items
      .filter((item) => item.id?.startsWith('tt') && item.q === 'feature')
      .map((item) => ({
        imdb_id: item.id!,
        title: item.l ?? '',
        year: item.y ?? null,
        poster_url: item.i?.imageUrl ?? null,
      }))

    // Prefer exact year match
    if (year) {
      results.sort((a, b) => {
        const aD = a.year != null ? Math.abs(a.year - year) : 9999
        const bD = b.year != null ? Math.abs(b.year - year) : 9999
        return aD - bD
      })
    }

    return results.slice(0, 5)
  } catch {
    return []
  }
}
