/**
 * ExtractionAlgoV2 — improved keyless VoD enrichment pipeline.
 *
 * Improvements over v1:
 * 1. Title normalizer — strips IPTV provider prefixes (IN-, EN-, AR-IN-),
 *    quality tags ([4K], [HEVC]), origin hints ([US]), and year from title body
 *    before searching. Fixes "IN - The Matrix Revolutions (2003)" class of failures.
 * 2. wbsearchentities API instead of SPARQL for title search — faster, fuzzy,
 *    handles partial/alternate titles better.
 * 3. haswbstatement CirrusSearch for IMDb ID fast-path — more reliable than
 *    direct P345 SPARQL lookup.
 * 4. 10s AbortController timeouts on all HTTP calls.
 * 5. Simple circuit breaker — pauses a failing host for 30s after 5 consecutive
 *    failures, preventing hung overnight batch runs.
 */

import type {
  VodEnrichmentInput,
  VodEnrichmentCandidate,
  WikidataSearchResult,
  WikidataEntityDetails,
  WikipediaSummary,
} from './types'
import { fetchEntityDetails } from './sources/wikidata'
import { fetchSummaryByUrl, fetchSummaryByTitle } from './sources/wikipedia'
import { searchImdbSuggest } from './sources/imdb-suggest'
import { scoreCandidate, directMatchConfidence } from './confidence'

export const ALGO_VERSION = 'v2'

// ─── Constants ────────────────────────────────────────────────────────────────

const WD_API = 'https://www.wikidata.org/w/api.php'
const UA = 'FractalTV/2.0 (vod-enrichment; contact: github.com/FractalTV)'
const TIMEOUT_MS = 10_000

// P31 (instance of) QIDs for films and series
const FILM_QIDS = new Set([
  'Q11424',   // film
  'Q24862',   // short film
  'Q506240',  // television film
  'Q202866',  // animated film
  'Q229390',  // animated short film
  'Q1261214', // direct-to-video film
  'Q226730',  // television special
  'Q15416',   // documentary film
])
const SERIES_QIDS = new Set([
  'Q5398426', // TV series
  'Q83371',   // TV season
  'Q1366112', // television miniseries  ← single-season / cancelled shows
  'Q21191270',// scripted television series
  'Q63952888',// streaming television series (Netflix etc.)
  'Q29168811',// animated television series
  'Q3072049', // miniseries
  'Q3455926', // television special
  'Q7725310', // literary work (broad fallback)
])

// ─── Circuit breaker ──────────────────────────────────────────────────────────

const cbFailures: Record<string, number> = {}
const cbPausedUntil: Record<string, number> = {}
const CB_THRESHOLD = 5
const CB_PAUSE_MS = 30_000

async function fetchJsonSafe(url: string): Promise<any> {
  let host: string
  try { host = new URL(url).hostname } catch { return null }

  if (cbPausedUntil[host] && Date.now() < cbPausedUntil[host]) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA },
    })
    if (!res.ok) {
      cbFailures[host] = (cbFailures[host] ?? 0) + 1
      if (cbFailures[host] >= CB_THRESHOLD) {
        cbPausedUntil[host] = Date.now() + CB_PAUSE_MS
        cbFailures[host] = 0
      }
      return null
    }
    cbFailures[host] = 0
    return res.json()
  } catch {
    cbFailures[host] = (cbFailures[host] ?? 0) + 1
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ─── Title normalizer ─────────────────────────────────────────────────────────

/**
 * Strip IPTV provider noise from a raw title before searching.
 * Handles: "IN - The Matrix Revolutions (2003)", "EN: Inception [4K]", etc.
 */
export function normalizeTitle(raw: string): {
  cleanTitle: string
  year: number | null
  languageHint: string | null
} {
  let s = raw.trim()
  let year: number | null = null
  let languageHint: string | null = null

  // Strip language/country prefix: "IN - ", "EN - ", "AR-IN - ", "FR: " etc.
  const prefixMatch = s.match(/^([A-Z]{2}(?:-[A-Z]{2,4})?)\s*[-:]\s+/i)
  if (prefixMatch) {
    languageHint = prefixMatch[1].toLowerCase()
    s = s.slice(prefixMatch[0].length)
  }

  // Strip trailing quality tags: [4K], [HEVC], (1080p), [MULTI], etc.
  s = s.replace(/\s*[\[(](?:4k|uhd|fhd|hd|hevc|h\.?265|h\.?264|x\.?265|x\.?264|avc|hdr|sdr|multi|dub(?:bed)?|sub(?:bed)?|vf|vostfr|vo|ts|cam|dvdrip|blu-?ray|\d{3,4}p)[\])]?\s*$/gi, '')

  // Strip trailing bracketed origin hint: [US], [UK], (FR) etc.
  s = s.replace(/\s*[\[(][A-Z]{2,3}[\])]\s*$/, '')

  // Extract year: "Title (2003)" or "Title 2003"
  const parenYear = s.match(/^(.*?)\s*\((\d{4})\)\s*$/)
  if (parenYear) {
    s = parenYear[1].trim()
    year = Number(parenYear[2])
  } else {
    const trailingYear = s.match(/^(.+?)\s+(\d{4})\s*$/)
    if (trailingYear) {
      const y = Number(trailingYear[2])
      if (y >= 1900 && y <= 2100) { s = trailingYear[1].trim(); year = y }
    }
  }

  return { cleanTitle: s.trim(), year, languageHint }
}

// ─── Wikidata v2 helpers (wbsearchentities + wbgetentities) ──────────────────

function getClaimStringValue(entity: any, prop: string): string | null {
  const claims = entity?.claims?.[prop]
  if (!claims?.length) return null
  const sv = claims[0]?.mainsnak?.datavalue?.value
  if (typeof sv === 'string') return sv
  if (sv?.id) return sv.id as string
  if (sv?.time) return sv.time as string
  if (sv?.text) return sv.text as string
  return null
}

function getAllClaimStringValues(entity: any, prop: string): string[] {
  const claims: any[] = entity?.claims?.[prop] ?? []
  return claims.map((c: any) => {
    const sv = c?.mainsnak?.datavalue?.value
    if (typeof sv === 'string') return sv
    if (sv?.id) return sv.id
    if (sv?.text) return sv.text
    return null
  }).filter(Boolean) as string[]
}

function entityIsFilmOrSeries(entity: any): boolean {
  const p31Values = getAllClaimStringValues(entity, 'P31')
  return p31Values.some((v) => FILM_QIDS.has(v) || SERIES_QIDS.has(v))
}

function entityToSearchResult(entity: any, qid: string): WikidataSearchResult | null {
  if (!entity || !entityIsFilmOrSeries(entity)) return null
  const yearTime = getClaimStringValue(entity, 'P577')
  const yearMatch = yearTime?.match(/[+-](\d{4})/)
  const year = yearMatch ? Number(yearMatch[1]) : null
  const wikiTitle = entity?.sitelinks?.enwiki?.title
  const wikiUrl = wikiTitle
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`
    : null
  return {
    qid,
    title: entity?.labels?.en?.value ?? '',
    year,
    imdb_id: getClaimStringValue(entity, 'P345'),
    tmdb_id: getClaimStringValue(entity, 'P4947'),
    wiki_url: wikiUrl,
  }
}

async function wbGetEntities(qids: string[]): Promise<Record<string, any>> {
  if (!qids.length) return {}
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: qids.join('|'),
    props: 'labels|claims|sitelinks',
    languages: 'en',
    sitefilter: 'enwiki',
    format: 'json',
    origin: '*',
  })
  const json = await fetchJsonSafe(`${WD_API}?${params}`)
  return json?.entities ?? {}
}

async function searchFilmsByTitleV2(
  title: string,
  year?: number | null,
  _languageHint?: string | null,
): Promise<WikidataSearchResult[]> {
  // Always search in English — IPTV prefix hints (IN, AR, FR) are region/country
  // codes, not valid Wikidata language codes. Use 'en' for reliable coverage.
  const searchParams = new URLSearchParams({
    action: 'wbsearchentities',
    search: title,
    language: 'en',
    uselang: 'en',
    type: 'item',
    limit: '10',
    format: 'json',
    origin: '*',
  })
  const searchJson = await fetchJsonSafe(`${WD_API}?${searchParams}`)
  const qids: string[] = (searchJson?.search ?? []).map((r: any) => r.id).filter(Boolean)
  if (!qids.length) return []

  const entities = await wbGetEntities(qids)
  const results: WikidataSearchResult[] = []
  for (const qid of qids) {
    const r = entityToSearchResult(entities[qid], qid)
    if (r) results.push(r)
  }

  if (year && results.length > 1) {
    results.sort((a, b) => {
      const aD = a.year != null ? Math.abs(a.year - year) : 9999
      const bD = b.year != null ? Math.abs(b.year - year) : 9999
      return aD - bD
    })
  }
  return results
}

async function findByImdbIdV2(imdbId: string): Promise<WikidataSearchResult | null> {
  // Use CirrusSearch haswbstatement — more reliable than direct SPARQL P345 lookup
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: `haswbstatement:P345=${imdbId}`,
    srlimit: '5',
    format: 'json',
    origin: '*',
  })
  const json = await fetchJsonSafe(`${WD_API}?${params}`)
  const hits: string[] = (json?.query?.search ?? [])
    .map((h: any) => h.title)
    .filter((t: any) => typeof t === 'string' && /^Q\d+$/.test(t))
  if (!hits.length) return null

  const entities = await wbGetEntities(hits)
  for (const qid of hits) {
    const r = entityToSearchResult(entities[qid], qid)
    if (r) return { ...r, imdb_id: imdbId }
  }
  return null
}

// ─── Candidate builder (same as v1) ──────────────────────────────────────────

async function buildCandidate(
  search: WikidataSearchResult,
  input: VodEnrichmentInput,
  forceConfidence?: number,
): Promise<VodEnrichmentCandidate> {
  const sources_used: string[] = ['wikidata']

  const [details, wiki] = await Promise.all([
    fetchEntityDetails(search.qid),
    search.wiki_url
      ? fetchSummaryByUrl(search.wiki_url).then((s) => {
          if (s) sources_used.push('wikipedia')
          return s
        })
      : Promise.resolve(null as WikipediaSummary | null),
  ])

  let posterUrl: string | null = wiki?.thumbnail_url ?? details.image_url ?? null
  const imdbId = details.imdb_id ?? search.imdb_id
  if (!posterUrl || imdbId) {
    const suggestYear = details.year ?? search.year ?? input.year
    const suggestions = await searchImdbSuggest(input.title, suggestYear)
    const match = imdbId
      ? suggestions.find((s) => s.imdb_id === imdbId)
      : suggestions[0]
    if (match) {
      if (match.poster_url) posterUrl = match.poster_url
      sources_used.push('imdb-suggest')
    }
  }

  const confidence = forceConfidence ?? scoreCandidate(input, search, details, wiki)

  return {
    algo_version: ALGO_VERSION,
    imdb_id: imdbId ?? null,
    tmdb_id: details.tmdb_id ?? search.tmdb_id ?? null,
    wikidata_qid: search.qid,
    confidence,
    title: search.title || input.title,
    year: details.year ?? search.year ?? input.year ?? null,
    overview: wiki?.extract ?? null,
    runtime_min: details.duration_min,
    release_date: null,
    genres: details.genres,
    directors: details.directors,
    writers: details.writers,
    cast: details.cast,
    country: details.countries[0] ?? null,
    language: details.languages[0] ?? null,
    production_companies: details.production_companies,
    awards: details.awards,
    poster_url: posterUrl,
    status: null,
    network: null,
    rating: null,
    tvmaze_id: null,
    wikipedia_url: wiki?.page_url ?? search.wiki_url ?? null,
    sources_used,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enrich a single title using algo v2.
 * Returns candidates sorted by confidence DESC. Never throws.
 */
export async function enrichTitle(input: VodEnrichmentInput): Promise<VodEnrichmentCandidate[]> {
  try {
    // Normalize — strip IPTV provider prefixes, quality tags, year
    const { cleanTitle, year: extractedYear, languageHint } = normalizeTitle(input.title)
    const year = input.year ?? extractedYear

    const effectiveInput: VodEnrichmentInput = {
      ...input,
      title: cleanTitle,
      year,
    }

    // Fast path: direct IMDb ID lookup
    if (input.imdb_id) {
      const found = await findByImdbIdV2(input.imdb_id)
      if (found) {
        const candidate = await buildCandidate(found, effectiveInput, directMatchConfidence())
        return [candidate]
      }
    }

    // Search path: wbsearchentities title search
    const searchResults = await searchFilmsByTitleV2(cleanTitle, year, languageHint)
    if (!searchResults.length) return []

    const top = searchResults.slice(0, 3)
    const candidates = await Promise.all(
      top.map((sr) => buildCandidate(sr, effectiveInput))
    )

    candidates.sort((a, b) => b.confidence - a.confidence)
    return candidates
  } catch {
    return []
  }
}
