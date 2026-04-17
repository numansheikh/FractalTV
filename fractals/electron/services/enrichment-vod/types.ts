/**
 * VoD enrichment types — g2 keyless enrichment (Wikipedia + Wikidata + IMDb suggest).
 * No API keys required. TMDB-with-key deferred to a future generation.
 */

export interface VodEnrichmentInput {
  title: string
  year?: number | null
  imdb_id?: string | null  // from Xtream provider_metadata if available
  tmdb_id?: string | null  // from Xtream provider_metadata if available
  // md population fields — used by v3 for cleaner title/year inputs
  search_title?: string | null
  md_year?: number | null
  md_language?: string | null
}

export interface VodEnrichmentCandidate {
  algo_version: 'v1' | 'v2' | 'v3'
  imdb_id: string | null
  tmdb_id: string | null
  wikidata_qid: string | null
  confidence: number  // 0.0..1.0

  // Display fields (all nullable — partial fill is the norm)
  title: string
  year: number | null
  overview: string | null
  runtime_min: number | null
  release_date: string | null  // YYYY-MM-DD

  genres: string[]
  directors: string[]
  writers: string[]
  cast: string[]  // up to 10
  country: string | null
  language: string | null
  production_companies: string[]
  awards: string[]

  // Images
  poster_url: string | null  // best available (wikipedia thumbnail or wikidata P18 or imdb)

  // Links
  wikipedia_url: string | null
  sources_used: string[]  // which sources contributed data
}

// DB row (flat) — raw_json carries VodEnrichmentCandidate
export interface VodEnrichmentRow {
  id: number
  content_id: string  // movie_id or series_id (poly, scoped by table)
  algo_version: string
  imdb_id: string | null
  tmdb_id: string | null
  wikidata_qid: string | null
  confidence: number
  fetched_at: number
  raw_json: string  // JSON.stringify(VodEnrichmentCandidate)
}

// Shape returned by vodEnrich:getForContent IPC call
export interface VodEnrichmentForContent {
  disabled: boolean
  selected_id: number | null
  candidates: VodEnrichmentRow[]  // sorted by confidence DESC
}

// Progress events emitted during enrichment run
export type EnrichPhase = 'starting' | 'enriching' | 'done' | 'error'
export interface EnrichProgress {
  phase: EnrichPhase
  current: number
  total: number
  message?: string
  error?: string
}

// Wikidata SPARQL result shapes
export interface WikidataSparqlBinding {
  type: string
  value: string
}
export interface WikidataSparqlResponse {
  results: {
    bindings: Record<string, WikidataSparqlBinding | undefined>[]
  }
}

export interface WikidataSearchResult {
  qid: string
  title: string
  year: number | null
  imdb_id: string | null
  tmdb_id: string | null
  wiki_url: string | null
}

export interface WikidataEntityDetails {
  qid: string
  imdb_id: string | null
  tmdb_id: string | null
  year: number | null
  duration_min: number | null
  directors: string[]
  writers: string[]
  cast: string[]
  genres: string[]
  countries: string[]
  languages: string[]
  production_companies: string[]
  awards: string[]
  image_url: string | null  // Wikimedia Commons URL
}

// Wikipedia REST summary shape (relevant fields only)
export interface WikipediaSummary {
  title: string
  description: string | null
  extract: string | null
  wikibase_item: string | null  // e.g. "Q83495"
  thumbnail_url: string | null
  page_url: string | null
}

// IMDb suggest result
export interface ImdbSuggestResult {
  imdb_id: string
  title: string
  year: number | null
  poster_url: string | null
}
