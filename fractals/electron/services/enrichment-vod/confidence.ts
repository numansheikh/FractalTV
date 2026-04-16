import type { VodEnrichmentInput, WikidataSearchResult, WikidataEntityDetails, WikipediaSummary } from './types'

/**
 * Score a candidate based on how well it matches the input query.
 * Score is 0.0..1.0. Higher = better match.
 *
 * Weights (sum ≤ 1.0):
 *   0.35 — title exact match (case-insensitive)
 *   0.30 — year match
 *   0.25 — imdb_id match (from input or cross-source agreement)
 *   0.10 — has enrichment content (plot, cast, etc.)
 */
export function scoreCandidate(
  input: VodEnrichmentInput,
  search: WikidataSearchResult,
  details: WikidataEntityDetails,
  wiki: WikipediaSummary | null,
): number {
  let score = 0

  // Title match
  const inputTitle = input.title.trim().toLowerCase()
  const candidateTitle = (search.title ?? '').trim().toLowerCase()
  if (candidateTitle === inputTitle) {
    score += 0.35
  } else if (candidateTitle.includes(inputTitle) || inputTitle.includes(candidateTitle)) {
    score += 0.15
  }

  // Year match
  const candidateYear = details.year ?? search.year
  if (input.year && candidateYear) {
    if (candidateYear === input.year) {
      score += 0.30
    } else if (Math.abs(candidateYear - input.year) === 1) {
      score += 0.10  // off by one — release date ambiguity
    }
  } else if (!input.year && !candidateYear) {
    // Neither has year — slight bump for not penalising
    score += 0.05
  }

  // IMDb ID match (strongest identity signal)
  const candidateImdb = details.imdb_id ?? search.imdb_id
  if (input.imdb_id && candidateImdb) {
    if (input.imdb_id === candidateImdb) {
      score += 0.25
    }
  } else if (!input.imdb_id) {
    // No id from input — small bump for having an id at all (cross-source confirmable later)
    if (candidateImdb) score += 0.05
  }

  // Content richness bonus
  const hasContent = (wiki?.extract?.length ?? 0) > 20 ||
    details.directors.length > 0 ||
    details.cast.length > 0
  if (hasContent) score += 0.10

  return Math.min(1.0, score)
}

/**
 * For a direct IMDb ID lookup (input had imdb_id and it matched exactly),
 * return near-max confidence. The 0.05 gap accounts for fringe mismatches.
 */
export function directMatchConfidence(): number {
  return 0.95
}
