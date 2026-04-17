/**
 * ExtractionAlgoV3 — FM-DB as primary source, Wikidata fast-path for metadata.
 *
 * Improvements over v2:
 * 1. FM-DB (`imdb.iamidiotareyoutoo.com`) replaces the two-step Wikidata title
 *    search + IMDb suggest. Single call returns IMDb ID, billing-order cast,
 *    poster, and rank.
 * 2. Uses `search_title` + `md_year` from md population as cleaner inputs —
 *    no IPTV prefix noise, pre-extracted year.
 * 3. Cast comes from FM-DB `#ACTORS` (billing order) instead of Wikidata P161
 *    (arbitrary order, minor actors first).
 * 4. FM-DB rank used as an additional confidence signal.
 * 5. Falls back to v2 Wikidata search path when FM-DB misses.
 * v1 and v2 are untouched.
 */

import type {
  VodEnrichmentInput,
  VodEnrichmentCandidate,
  WikidataSearchResult,
  WikidataEntityDetails,
  WikipediaSummary,
} from './types'
import { fetchEntityDetails } from './sources/wikidata'
import { fetchSummaryByUrl } from './sources/wikipedia'
import { searchFmdb } from './sources/fmdb'
import { scoreCandidate, directMatchConfidence } from './confidence'

export const ALGO_VERSION = 'v3'

// ─── Constants ────────────────────────────────────────────────────────────────

const WD_API = 'https://www.wikidata.org/w/api.php'
const UA = 'FractalTV/3.0 (vod-enrichment; contact: github.com/FractalTV)'
const TIMEOUT_MS = 10_000

const FILM_QIDS = new Set([
  'Q11424', 'Q24862', 'Q506240', 'Q202866', 'Q229390',
  'Q1261214', 'Q226730', 'Q15416',
])
const SERIES_QIDS = new Set([
  'Q5398426', 'Q83371', 'Q1366112', 'Q21191270',
  'Q63952888', 'Q29168811', 'Q3072049', 'Q3455926', 'Q7725310',
])

// ─── Circuit breaker (shared pattern from v2) ─────────────────────────────────

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
      if (cbFailures[host] >= CB_THRESHOLD) { cbPausedUntil[host] = Date.now() + CB_PAUSE_MS; cbFailures[host] = 0 }
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

// ─── Title normalizer (same as v2 — used as fallback when md fields absent) ──

export function normalizeTitle(raw: string): {
  cleanTitle: string
  year: number | null
  languageHint: string | null
} {
  let s = raw.trim()
  let year: number | null = null
  let languageHint: string | null = null

  const prefixMatch = s.match(/^([A-Z]{2}(?:-[A-Z]{2,4})?)\s*[-:]\s+/i)
  if (prefixMatch) {
    languageHint = prefixMatch[1].toLowerCase()
    s = s.slice(prefixMatch[0].length)
  }

  s = s.replace(/\s*[\[(](?:4k|uhd|fhd|hd|hevc|h\.?265|h\.?264|x\.?265|x\.?264|avc|hdr|sdr|multi|dub(?:bed)?|sub(?:bed)?|vf|vostfr|vo|ts|cam|dvdrip|blu-?ray|\d{3,4}p)[\])]?\s*$/gi, '')
  s = s.replace(/\s*[\[(][A-Z]{2,3}[\])]\s*$/, '')

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

// ─── Wikidata helpers (mirrored from v2) ──────────────────────────────────────

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
  if (p31Values.some((v) => FILM_QIDS.has(v) || SERIES_QIDS.has(v))) return true
  // Accept any entity with an IMDb or TMDB ID — strong signal it's a film/series
  return !!(getClaimStringValue(entity, 'P345') || getClaimStringValue(entity, 'P4947'))
}

function entityToSearchResult(entity: any, qid: string): WikidataSearchResult | null {
  if (!entity || !entityIsFilmOrSeries(entity)) return null
  return entityToSearchResultAny(entity, qid)
}

// Used when we already have a trusted IMDb ID — skip the type check entirely
function entityToSearchResultAny(entity: any, qid: string): WikidataSearchResult | null {
  if (!entity) return null
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

async function findByImdbIdV2(imdbId: string): Promise<WikidataSearchResult | null> {
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
    // Trust the IMDb ID — skip film-type validation here
    const r = entityToSearchResultAny(entities[qid], qid)
    if (r) return { ...r, imdb_id: imdbId }
  }
  return null
}

async function searchFilmsByTitleV2(
  title: string,
  year?: number | null,
): Promise<WikidataSearchResult[]> {
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

// ─── Confidence bonus for FM-DB rank ─────────────────────────────────────────

function rankBonus(rank: number | null): number {
  if (rank == null) return 0
  if (rank <= 100) return 0.10
  if (rank <= 1000) return 0.05
  return 0
}

// ─── Candidate builder ────────────────────────────────────────────────────────

async function buildCandidateFromFmdb(
  fmdbImdbId: string,
  fmdbActors: string[],
  fmdbPoster: string | null,
  fmdbRank: number | null,
  input: VodEnrichmentInput,
): Promise<VodEnrichmentCandidate> {
  const sources_used: string[] = ['fmdb']

  // Wikidata fast-path via IMDb ID
  const wdResult = await findByImdbIdV2(fmdbImdbId)
  let details: WikidataEntityDetails | null = null
  let wiki: WikipediaSummary | null = null

  if (wdResult) {
    sources_used.push('wikidata')
    const [d, w] = await Promise.all([
      fetchEntityDetails(wdResult.qid),
      wdResult.wiki_url
        ? fetchSummaryByUrl(wdResult.wiki_url).then((s) => {
            if (s) sources_used.push('wikipedia')
            return s
          })
        : Promise.resolve(null as WikipediaSummary | null),
    ])
    details = d
    wiki = w
  }

  const poster = fmdbPoster ?? wiki?.thumbnail_url ?? details?.image_url ?? null
  const baseScore = wdResult
    ? scoreCandidate(input, wdResult, details!, wiki)
    : 0.5  // FM-DB hit but no Wikidata match — moderate confidence
  const confidence = Math.min(1.0, baseScore + rankBonus(fmdbRank))

  return {
    algo_version: ALGO_VERSION,
    imdb_id: fmdbImdbId,
    tmdb_id: details?.tmdb_id ?? wdResult?.tmdb_id ?? null,
    wikidata_qid: wdResult?.qid ?? null,
    confidence,
    title: wdResult?.title || input.title,
    year: details?.year ?? wdResult?.year ?? input.year ?? null,
    overview: wiki?.extract ?? null,
    runtime_min: details?.duration_min ?? null,
    release_date: null,
    genres: details?.genres ?? [],
    directors: details?.directors ?? [],
    writers: details?.writers ?? [],
    cast: fmdbActors,          // FM-DB billing order, NOT Wikidata P161
    country: details?.countries[0] ?? null,
    language: details?.languages[0] ?? null,
    production_companies: details?.production_companies ?? [],
    awards: details?.awards ?? [],
    poster_url: poster,
    wikipedia_url: wiki?.page_url ?? wdResult?.wiki_url ?? null,
    sources_used,
  }
}

async function buildCandidateFromWikidata(
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

  // No FM-DB path here — cast from Wikidata P161 is still unreliable in fallback.
  // Keep it for now but mark source clearly.
  const confidence = forceConfidence ?? scoreCandidate(input, search, details, wiki)

  return {
    algo_version: ALGO_VERSION,
    imdb_id: details.imdb_id ?? search.imdb_id ?? null,
    tmdb_id: details.tmdb_id ?? search.tmdb_id ?? null,
    wikidata_qid: search.qid,
    confidence,
    title: search.title || input.title,
    year: details.year ?? search.year ?? input.year ?? null,
    overview: wiki?.extract ?? null,
    runtime_min: details.duration_min ?? null,
    release_date: null,
    genres: details.genres,
    directors: details.directors,
    writers: details.writers,
    cast: [],  // P161 dropped — blank > wrong
    country: details.countries[0] ?? null,
    language: details.languages[0] ?? null,
    production_companies: details.production_companies,
    awards: details.awards,
    poster_url: wiki?.thumbnail_url ?? details.image_url ?? null,
    wikipedia_url: wiki?.page_url ?? search.wiki_url ?? null,
    sources_used,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enrich a single title using algo v3.
 * Returns candidates sorted by confidence DESC. Never throws.
 */
export async function enrichTitle(input: VodEnrichmentInput): Promise<VodEnrichmentCandidate[]> {
  try {
    // Always normalize the raw title for external API queries — search_title
    // is for SQLite LIKE and may still contain IPTV prefix noise if md
    // population hasn't run yet.
    const normalized = normalizeTitle(input.title)
    const cleanTitle = normalized.cleanTitle
    const year = input.md_year ?? input.year ?? normalized.year

    const effectiveInput: VodEnrichmentInput = { ...input, title: cleanTitle, year }

    // ── FM-DB primary path ────────────────────────────────────────────────────
    const fmdbQuery = year ? `${cleanTitle} ${year}` : cleanTitle
    const fmdb = await searchFmdb(fmdbQuery)

    if (fmdb?.imdb_id) {
      const candidate = await buildCandidateFromFmdb(
        fmdb.imdb_id,
        fmdb.actors,
        fmdb.poster_url,
        fmdb.rank,
        effectiveInput,
      )
      return [candidate]
    }

    // ── Fallback: Wikidata v2 search path ─────────────────────────────────────
    const searchResults = await searchFilmsByTitleV2(cleanTitle, year)
    if (!searchResults.length) return []

    const top = searchResults.slice(0, 3)
    const candidates = await Promise.all(
      top.map((sr) => buildCandidateFromWikidata(sr, effectiveInput))
    )
    candidates.sort((a, b) => b.confidence - a.confidence)
    return candidates
  } catch {
    return []
  }
}
