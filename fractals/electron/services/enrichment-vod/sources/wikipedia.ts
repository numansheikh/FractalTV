import type { WikipediaSummary } from '../types'

const REST_BASE = 'https://en.wikipedia.org/api/rest_v1/page/summary'
const UA = 'FractalTV/2.0 (vod-enrichment; contact: github.com/numansheikh/FractalTV)'

/**
 * Fetch Wikipedia REST summary for a known page title.
 * Page title should be URL-safe (spaces as underscores).
 * Returns null on 404 or network error.
 */
export async function fetchSummaryByTitle(pageTitle: string): Promise<WikipediaSummary | null> {
  const encoded = encodeURIComponent(pageTitle.replace(/ /g, '_'))
  const url = `${REST_BASE}/${encoded}`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA } })
    clearTimeout(timer)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Wikipedia summary HTTP ${res.status}`)
    const json = await res.json() as Record<string, any>
    return {
      title: json.title ?? pageTitle,
      description: json.description ?? null,
      extract: json.extract ?? null,
      wikibase_item: json.wikibase_item ?? null,
      thumbnail_url: json.thumbnail?.source ?? json.originalimage?.source ?? null,
      page_url: json.content_urls?.desktop?.page ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Fetch Wikipedia summary from a full Wikipedia article URL.
 * E.g. "https://en.wikipedia.org/wiki/The_Matrix" → fetch summary for "The_Matrix".
 */
export async function fetchSummaryByUrl(wikiUrl: string): Promise<WikipediaSummary | null> {
  // Extract page title from URL
  const match = wikiUrl.match(/\/wiki\/([^#?]+)/)
  if (!match) return null
  return fetchSummaryByTitle(decodeURIComponent(match[1]))
}
