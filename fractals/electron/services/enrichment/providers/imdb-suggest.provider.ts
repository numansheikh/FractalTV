/**
 * IMDb suggest provider — Phase C of the V3 data-model rollout.
 *
 * Endpoint: `https://sg.media-imdb.com/suggests/{firstLetterLowercased}/{querySlug}.json`
 * This is the same unofficial JSONP endpoint the IMDb website search dropdown
 * uses. It is English-biased, rate-unlimited but capacity-limited, and
 * returns tconst IDs + poster URLs in a single call (L8's "free identity +
 * light poster" goal).
 *
 * Response shape (unofficial, based on observed traffic):
 * ```
 * imdb$the_matrix({
 *   "v": 1,
 *   "q": "the_matrix",
 *   "d": [
 *     {
 *       "id": "tt0133093",       // tconst
 *       "l": "The Matrix",         // title
 *       "q": "feature",            // type string
 *       "qid": "movie",            // type id
 *       "y": 1999,                 // year (number OR "????")
 *       "i": [
 *         "https://m.media-amazon.com/images/M/xxx.jpg",
 *         width_px, height_px
 *       ],
 *       "s": "Keanu Reeves, Laurence Fishburne"  // cast stars (optional, unused)
 *     },
 *     ...
 *   ]
 * })
 * ```
 *
 * Thumbnail transform: IMDb/Amazon poster URLs accept an `._V1_SX300.jpg`
 * suffix (inserted before the final extension) that returns a ~300px-wide
 * variant — no extra HTTP call required.
 */

import type {
  Candidate,
  ExternalIdType,
  LookupHints,
  MetadataProvider,
  ProviderHints,
} from '../provider'
import type { RateLimiter } from '../rate-limiter'

const PROVIDER_NAME = 'imdb-suggest'
const BASE_URL = 'https://sg.media-imdb.com/suggests'
const REQUEST_TIMEOUT_MS = 8000

/** Subset of the raw IMDb suggest payload we actually consume. */
interface RawImdbItem {
  id?: string
  l?: string
  q?: string
  qid?: string
  y?: number | string
  i?: [string, number, number]
  s?: string
}

/** IMDb suggest metadata provider. */
export class ImdbSuggestProvider implements MetadataProvider {
  public readonly name = PROVIDER_NAME
  public readonly priority = 10

  constructor(private readonly rateLimiter: RateLimiter) {}

  supports(hints: ProviderHints): boolean {
    // IMDb suggest is English-biased. Accept Latin script and missing script
    // hints; reject non-Latin unless the caller explicitly flagged the title
    // as English (rare but possible — English title stored in a non-Latin
    // locale).
    if (hints.script === 'non-latin') {
      return hints.languageHint === 'en'
    }
    return true
  }

  async lookupByTitle(query: string, hints: LookupHints): Promise<Candidate[]> {
    // IMDb suggest is VoD-only — live channels are iptv-org's domain.
    if (hints.type === 'live') return []
    const slug = toQuerySlug(query)
    if (!slug) return []
    const firstLetter = slug.charAt(0).toLowerCase()
    if (!firstLetter) return []

    const url = `${BASE_URL}/${firstLetter}/${slug}.json`
    const raw = await this.fetchJsonp(url, slug)
    if (!raw || !Array.isArray(raw.d)) return []

    const candidates: Candidate[] = []
    for (const item of raw.d as RawImdbItem[]) {
      const candidate = toCandidate(item)
      if (!candidate) continue
      if (candidate.type !== hints.type) continue
      candidates.push(candidate)
    }
    return candidates
  }

  // IMDb suggest does not support tconst reverse lookup — it is a title-prefix
  // endpoint only. Wikidata handles tconst → identity via `haswbstatement`.
  async lookupByExternalId(_type: ExternalIdType, _id: string): Promise<Candidate | null> {
    return null
  }

  private async fetchJsonp(
    url: string,
    slug: string
  ): Promise<{ d?: RawImdbItem[] } | null> {
    await this.rateLimiter.acquire(PROVIDER_NAME)
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      let text: string
      try {
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) {
          this.rateLimiter.reportFailure(PROVIDER_NAME, res.status)
          return null
        }
        text = await res.text()
      } finally {
        clearTimeout(timer)
      }
      const parsed = parseJsonp(text, slug)
      if (!parsed) {
        this.rateLimiter.reportFailure(PROVIDER_NAME)
        return null
      }
      this.rateLimiter.reportSuccess(PROVIDER_NAME)
      return parsed
    } catch {
      this.rateLimiter.reportFailure(PROVIDER_NAME)
      return null
    } finally {
      this.rateLimiter.release(PROVIDER_NAME)
    }
  }
}

/**
 * Normalize a raw query to the slug IMDb expects:
 * - Lowercase
 * - Strip everything but alphanum + whitespace
 * - Collapse runs of whitespace into a single `_`
 *
 * Empty/whitespace-only input yields `''` — caller must skip.
 */
export function toQuerySlug(query: string): string {
  if (!query) return ''
  const lowered = query.toLowerCase().normalize('NFKD')
  // Replace non-alphanumeric (except spaces) with space, then collapse to underscore.
  const stripped = lowered.replace(/[^a-z0-9\s]+/g, ' ').trim()
  if (!stripped) return ''
  return stripped.replace(/\s+/g, '_')
}

/**
 * Strip the `imdb$<slug>(` prefix and trailing `)` from a JSONP body before
 * handing it to `JSON.parse`. Returns `null` if the envelope doesn't match.
 */
export function parseJsonp(
  body: string,
  slug: string
): { d?: RawImdbItem[] } | null {
  if (!body) return null
  const trimmed = body.trim()
  // Expected envelope: `imdb$<slug>(<json>)` — but some responses use different
  // callback names on edge cases, so fall back to a lenient generic regex.
  const prefix = `imdb$${slug}(`
  if (trimmed.startsWith(prefix) && trimmed.endsWith(')')) {
    const inner = trimmed.slice(prefix.length, -1)
    return safeParse(inner)
  }
  const match = /^[A-Za-z_$][\w$]*\((.*)\)\s*$/s.exec(trimmed)
  if (match && match[1]) {
    return safeParse(match[1])
  }
  return null
}

function safeParse(json: string): { d?: RawImdbItem[] } | null {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

function toCandidate(item: RawImdbItem): Candidate | null {
  if (!item || typeof item.id !== 'string' || !item.id.startsWith('tt')) return null
  if (typeof item.l !== 'string' || !item.l) return null

  const type = resolveType(item)
  if (!type) return null

  const year = resolveYear(item.y)
  const poster = resolvePoster(item.i)

  return {
    externalIds: { imdbId: item.id },
    title: item.l,
    year,
    type,
    posterUrl: poster.posterUrl,
    thumbnailUrl: poster.thumbnailUrl,
    posterW: poster.posterW,
    posterH: poster.posterH,
    rawSource: PROVIDER_NAME,
  }
}

/**
 * Map the IMDb `q`/`qid` fields to our canonical `'movie'` | `'series'`.
 * Anything else (short, video game, podcast, TV episode, etc.) returns null
 * and is dropped upstream.
 */
function resolveType(item: RawImdbItem): 'movie' | 'series' | null {
  if (item.q === 'feature') return 'movie'
  if (item.qid === 'tvSeries' || item.q === 'TV series') return 'series'
  if (item.qid === 'movie') return 'movie'
  return null
}

function resolveYear(y: unknown): number | undefined {
  if (typeof y === 'number' && Number.isFinite(y)) return y
  if (typeof y === 'string') {
    const n = parseInt(y, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

/**
 * Derive a thumbnail URL from the full poster URL by injecting `._V1_SX300`
 * before the final extension. Amazon's image pipeline accepts the transform
 * inline — no extra HTTP round-trip.
 */
export function deriveThumbnailUrl(posterUrl: string): string {
  if (!posterUrl) return posterUrl
  const dot = posterUrl.lastIndexOf('.')
  if (dot <= 0) return posterUrl
  const stem = posterUrl.slice(0, dot)
  const ext = posterUrl.slice(dot)
  return `${stem}._V1_SX300${ext}`
}

function resolvePoster(i: RawImdbItem['i']): {
  posterUrl?: string
  thumbnailUrl?: string
  posterW?: number
  posterH?: number
} {
  if (!Array.isArray(i) || typeof i[0] !== 'string') return {}
  const posterUrl = i[0]
  const posterW = typeof i[1] === 'number' ? i[1] : undefined
  const posterH = typeof i[2] === 'number' ? i[2] : undefined
  return {
    posterUrl,
    thumbnailUrl: deriveThumbnailUrl(posterUrl),
    posterW,
    posterH,
  }
}
