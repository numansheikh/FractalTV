/**
 * ExtractionAlgoV1 — keyless VoD enrichment pipeline.
 *
 * Input:  { title, year?, imdb_id?, tmdb_id? }
 * Output: VodEnrichmentCandidate[] sorted by confidence DESC
 *
 * Pipeline per title:
 *   1. If imdb_id provided → Wikidata direct lookup (fast, unambiguous)
 *   2. Otherwise → Wikidata label search → top-3 candidates
 *   3. For each candidate: Wikipedia summary + Wikidata entity details (parallel)
 *   4. IMDb suggest (poster + confirm id)
 *   5. Merge, score, sort
 *
 * All HTTP calls, no LLM, fully deterministic.
 */

import type {
  VodEnrichmentInput,
  VodEnrichmentCandidate,
  WikidataSearchResult,
  WikidataEntityDetails,
  WikipediaSummary,
} from './types'
import { searchFilmsByTitle, findByImdbId, fetchEntityDetails } from './sources/wikidata'
import { fetchSummaryByUrl, fetchSummaryByTitle } from './sources/wikipedia'
import { searchImdbSuggest } from './sources/imdb-suggest'
import { scoreCandidate, directMatchConfidence } from './confidence'

export const ALGO_VERSION = 'v1'

// Extract year from provider title like "Movie Title (2019)" or "Movie Title 2019"
export function extractYearFromTitle(title: string): { title: string; year: number | null } {
  const parenMatch = title.match(/^(.*?)\s*\((\d{4})\)\s*$/)
  if (parenMatch) {
    return { title: parenMatch[1].trim(), year: Number(parenMatch[2]) }
  }
  const trailingMatch = title.match(/^(.*?)\s+(\d{4})\s*$/)
  if (trailingMatch) {
    const year = Number(trailingMatch[2])
    if (year >= 1900 && year <= 2100) {
      return { title: trailingMatch[1].trim(), year }
    }
  }
  return { title, year: null }
}

async function buildCandidate(
  search: WikidataSearchResult,
  input: VodEnrichmentInput,
  forceConfidence?: number,
): Promise<VodEnrichmentCandidate> {
  const sources_used: string[] = ['wikidata']

  // Fetch details + Wikipedia in parallel
  const [details, wiki] = await Promise.all([
    fetchEntityDetails(search.qid),
    search.wiki_url
      ? fetchSummaryByUrl(search.wiki_url).then((s) => {
          if (s) sources_used.push('wikipedia')
          return s
        })
      : Promise.resolve(null as WikipediaSummary | null),
  ])

  // IMDb suggest for high-res poster
  let posterUrl: string | null =
    wiki?.thumbnail_url ?? details.image_url ?? null
  const imdbId = details.imdb_id ?? search.imdb_id
  if (!posterUrl || imdbId) {
    const suggestTitle = input.title
    const suggestYear = details.year ?? search.year ?? input.year
    const suggestions = await searchImdbSuggest(suggestTitle, suggestYear)
    const match = imdbId
      ? suggestions.find((s) => s.imdb_id === imdbId)
      : suggestions[0]
    if (match) {
      if (match.poster_url) posterUrl = match.poster_url
      sources_used.push('imdb-suggest')
    }
  }

  const confidence =
    forceConfidence ?? scoreCandidate(input, search, details, wiki)

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
    wikipedia_url: wiki?.page_url ?? search.wiki_url ?? null,
    sources_used,
  }
}

/**
 * Enrich a single title. Returns candidates sorted by confidence DESC.
 * Returns empty array on total failure; never throws.
 */
export async function enrichTitle(input: VodEnrichmentInput): Promise<VodEnrichmentCandidate[]> {
  try {
    // Normalise title — strip embedded year if present
    const extracted = extractYearFromTitle(input.title)
    const cleanTitle = extracted.title
    const year = input.year ?? extracted.year

    const effectiveInput: VodEnrichmentInput = {
      ...input,
      title: cleanTitle,
      year,
    }

    // — Fast path: direct IMDb ID lookup (unambiguous) —
    if (input.imdb_id) {
      const found = await findByImdbId(input.imdb_id)
      if (found) {
        const candidate = await buildCandidate(found, effectiveInput, directMatchConfidence())
        return [candidate]
      }
    }

    // — Search path: title label search on Wikidata —
    const searchResults = await searchFilmsByTitle(cleanTitle, year)
    if (!searchResults.length) return []

    // Build top-3 candidates in parallel (each makes 2-3 HTTP calls)
    const top = searchResults.slice(0, 3)
    const candidates = await Promise.all(
      top.map((sr) => buildCandidate(sr, effectiveInput))
    )

    // Sort by confidence DESC
    candidates.sort((a, b) => b.confidence - a.confidence)
    return candidates
  } catch {
    return []
  }
}
