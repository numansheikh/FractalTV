/**
 * Wikidata provider — Phase C of the V3 data-model rollout.
 *
 * Uses the public Wikidata REST-ish API at `https://www.wikidata.org/w/api.php`
 * via two actions:
 *
 * 1. `wbsearchentities`   — keyword search (title → Q-ID shortlist)
 * 2. `query` + `list=search` — CirrusSearch `haswbstatement:` for cross-ref
 *     lookups (tconst / tmdb → Q-ID)
 * 3. `wbgetentities`      — fetch labels, descriptions, claims by Q-ID
 *
 * ─── Relevant Wikidata properties ────────────────────────────────────────
 * P31  = instance of  (we filter for Q11424 = film, Q5398426 = TV series)
 * P345 = IMDb ID      (tconst)
 * P4947 = TMDB ID     (integer)
 * P577 = publication date  (ISO 8601 → parse year)
 * P1476 = title       (original title; we prefer this over label when present)
 *
 * ─── wbgetentities JSON shape (abridged) ─────────────────────────────────
 * {
 *   "entities": {
 *     "Q83495": {
 *       "labels": { "en": { "language": "en", "value": "The Matrix" }, ... },
 *       "descriptions": { ... },
 *       "claims": {
 *         "P31":   [{ "mainsnak": { "datavalue": { "value": { "id": "Q11424" } } } }],
 *         "P345":  [{ "mainsnak": { "datavalue": { "value": "tt0133093" } } }],
 *         "P4947": [{ "mainsnak": { "datavalue": { "value": "603" } } }],
 *         "P577":  [{ "mainsnak": { "datavalue": { "value": { "time": "+1999-03-31T00:00:00Z" } } } }],
 *         "P1476": [{ "mainsnak": { "datavalue": { "value": { "text": "The Matrix", "language": "en" } } } }],
 *         ...
 *       }
 *     }
 *   }
 * }
 *
 * Claim datavalues come in several shapes:
 * - `value.id` — wikibase-entityid (P31 target)
 * - `value` as string — external-id (P345, P4947)
 * - `value.time` — time (P577, ISO with leading `+` sign)
 * - `value.text`/`value.language` — monolingualtext (P1476)
 * All of them live under `mainsnak.datavalue.value` and ALL of them can be
 * missing for deprecated/unknown-value claims. Defensive parsing required.
 */

import type {
  Candidate,
  ExternalIdType,
  LookupHints,
  MetadataProvider,
  ProviderHints,
} from '../provider'
import type { RateLimiter } from '../rate-limiter'

const PROVIDER_NAME = 'wikidata'
const API_BASE = 'https://www.wikidata.org/w/api.php'
const USER_AGENT = 'Fractals/0.2 (https://github.com/FractalTV; enrichment pipeline)'
const REQUEST_TIMEOUT_MS = 10000
const MAX_SEARCH_RESULTS = 10

/** P31 target Q-IDs we consider. */
const QID_FILM = 'Q11424'
const QID_TV_SERIES = 'Q5398426'

/** Languages we pull labels for (top ~15 by coverage). */
export const MULTILINGUAL_LANGS = [
  'en', 'fr', 'de', 'es', 'it', 'ru', 'ar', 'zh', 'ja', 'ko',
  'hi', 'pt', 'tr', 'pl', 'nl',
] as const

interface WbLabel {
  language?: string
  value?: string
}

interface WbClaim {
  mainsnak?: {
    snaktype?: string
    datavalue?: {
      type?: string
      value?: unknown
    }
  }
}

interface WbEntity {
  id?: string
  labels?: Record<string, WbLabel>
  descriptions?: Record<string, WbLabel>
  claims?: Record<string, WbClaim[]>
}

interface WbGetEntitiesResponse {
  entities?: Record<string, WbEntity>
}

interface WbSearchResult {
  id?: string
  label?: string
  description?: string
}

interface WbSearchResponse {
  search?: WbSearchResult[]
}

interface QuerySearchItem {
  title?: string
}

interface QuerySearchResponse {
  query?: {
    search?: QuerySearchItem[]
  }
}

/** Wikidata metadata provider. */
export class WikidataProvider implements MetadataProvider {
  public readonly name = PROVIDER_NAME
  public readonly priority = 20

  constructor(private readonly rateLimiter: RateLimiter) {}

  supports(_hints: ProviderHints): boolean {
    // Wikidata has multilingual coverage — it's always a candidate.
    return true
  }

  async lookupByTitle(query: string, hints: LookupHints): Promise<Candidate[]> {
    // Wikidata is the VoD oracle — live channels are iptv-org's domain.
    if (hints.type === 'live') return []
    const vodType: 'movie' | 'series' = hints.type
    const trimmed = query.trim()
    if (!trimmed) return []

    const lang = hints.languageHint || 'en'
    const search = await this.wbSearchEntities(trimmed, lang, MAX_SEARCH_RESULTS)
    if (!search.length) return []

    const qids = search.map((r) => r.id).filter(isNonEmptyString)
    if (!qids.length) return []

    const entities = await this.wbGetEntities(qids)
    if (!entities) return []

    const typeFilter = vodType === 'series' ? QID_TV_SERIES : QID_FILM

    const candidates: Candidate[] = []
    for (const qid of qids) {
      const entity = entities[qid]
      if (!entity) continue
      if (!entityIsInstanceOf(entity, typeFilter)) continue
      const candidate = entityToCandidate(entity, vodType, lang)
      if (candidate) candidates.push(candidate)
    }
    return candidates
  }

  async lookupByExternalId(type: ExternalIdType, id: string): Promise<Candidate | null> {
    if (!id) return null

    if (type === 'wikidata') {
      const entities = await this.wbGetEntities([id])
      const entity = entities?.[id]
      if (!entity) return null
      const resolvedType = resolveEntityType(entity)
      if (!resolvedType) return null
      return entityToCandidate(entity, resolvedType, 'en')
    }

    const propertyId =
      type === 'imdb' ? 'P345' : type === 'tmdb' ? 'P4947' : null
    if (!propertyId) return null

    const qids = await this.findQidsByStatement(propertyId, id)
    if (!qids.length) return null

    // Defensive: multiple Q-IDs matching a single tconst "shouldn't happen"
    // but Wikidata has duplicates occasionally. We take the first entity
    // that resolves to a supported type.
    const entities = await this.wbGetEntities(qids)
    if (!entities) return null
    for (const qid of qids) {
      const entity = entities[qid]
      if (!entity) continue
      const resolvedType = resolveEntityType(entity)
      if (!resolvedType) continue
      const candidate = entityToCandidate(entity, resolvedType, 'en')
      if (candidate) return candidate
    }
    return null
  }

  // ─── API call helpers ────────────────────────────────────────────────

  private async wbSearchEntities(
    query: string,
    language: string,
    limit: number
  ): Promise<WbSearchResult[]> {
    const params = new URLSearchParams({
      action: 'wbsearchentities',
      search: query,
      language,
      uselang: language,
      type: 'item',
      limit: String(limit),
      format: 'json',
      origin: '*',
    })
    const json = await this.fetchJson<WbSearchResponse>(`${API_BASE}?${params.toString()}`)
    return json?.search ?? []
  }

  private async wbGetEntities(
    ids: string[]
  ): Promise<Record<string, WbEntity> | null> {
    if (!ids.length) return null
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: ids.join('|'),
      props: 'labels|descriptions|claims',
      languages: MULTILINGUAL_LANGS.join('|'),
      format: 'json',
      origin: '*',
    })
    const json = await this.fetchJson<WbGetEntitiesResponse>(
      `${API_BASE}?${params.toString()}`
    )
    return json?.entities ?? null
  }

  private async findQidsByStatement(
    property: string,
    value: string
  ): Promise<string[]> {
    const params = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: `haswbstatement:${property}=${value}`,
      srlimit: '5',
      format: 'json',
      origin: '*',
    })
    const json = await this.fetchJson<QuerySearchResponse>(
      `${API_BASE}?${params.toString()}`
    )
    const hits = json?.query?.search ?? []
    return hits
      .map((h) => h.title)
      .filter(isNonEmptyString)
      .filter((t) => /^Q\d+$/.test(t))
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    await this.rateLimiter.acquire(PROVIDER_NAME)
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        })
        if (!res.ok) {
          this.rateLimiter.reportFailure(PROVIDER_NAME, res.status)
          return null
        }
        const json = (await res.json()) as T
        this.rateLimiter.reportSuccess(PROVIDER_NAME)
        return json
      } finally {
        clearTimeout(timer)
      }
    } catch {
      this.rateLimiter.reportFailure(PROVIDER_NAME)
      return null
    } finally {
      this.rateLimiter.release(PROVIDER_NAME)
    }
  }
}

// ─── Pure helpers (exported for unit tests) ──────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/**
 * Read the first claim for a property, pass its datavalue.value to `pick`,
 * and return whatever `pick` returns. Missing / deprecated / novalue claims
 * all short-circuit to `undefined` rather than throwing.
 */
function firstClaimValue<T>(
  entity: WbEntity,
  prop: string,
  pick: (value: unknown) => T | undefined
): T | undefined {
  const claims = entity.claims?.[prop]
  if (!claims || !claims.length) return undefined
  for (const c of claims) {
    const v = c.mainsnak?.datavalue?.value
    if (v === undefined) continue
    const picked = pick(v)
    if (picked !== undefined) return picked
  }
  return undefined
}

/** Is this entity an instance of (directly or via P31) the given Q-ID? */
export function entityIsInstanceOf(entity: WbEntity, qid: string): boolean {
  const claims = entity.claims?.P31
  if (!claims) return false
  for (const c of claims) {
    const v = c.mainsnak?.datavalue?.value
    if (v && typeof v === 'object' && 'id' in v && (v as { id?: string }).id === qid) {
      return true
    }
  }
  return false
}

/** Resolve P31 to our canonical movie/series type, or undefined if neither. */
export function resolveEntityType(entity: WbEntity): 'movie' | 'series' | undefined {
  if (entityIsInstanceOf(entity, QID_FILM)) return 'movie'
  if (entityIsInstanceOf(entity, QID_TV_SERIES)) return 'series'
  return undefined
}

/** Parse a P577 time datavalue (e.g. `+1999-03-31T00:00:00Z`) to a year integer. */
export function parsePublicationYear(v: unknown): number | undefined {
  if (!v || typeof v !== 'object' || !('time' in v)) return undefined
  const time = (v as { time?: unknown }).time
  if (typeof time !== 'string') return undefined
  const match = /^[+-]?(\d{1,4})-\d{2}-\d{2}/.exec(time)
  if (!match) return undefined
  const year = parseInt(match[1], 10)
  return Number.isFinite(year) ? year : undefined
}

/** Extract a monolingualtext `text` field (e.g. P1476 original title). */
export function parseMonolingualText(v: unknown): string | undefined {
  if (!v || typeof v !== 'object' || !('text' in v)) return undefined
  const text = (v as { text?: unknown }).text
  return typeof text === 'string' && text.length > 0 ? text : undefined
}

/** Extract a plain string value (external-id / string datavalues). */
function parseStringValue(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** Extract the numeric TMDB id (stored as string in Wikidata). */
function parseTmdbId(v: unknown): number | undefined {
  const s = parseStringValue(v)
  if (!s) return undefined
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : undefined
}

function collectLabels(entity: WbEntity): Record<string, string> {
  const out: Record<string, string> = {}
  if (!entity.labels) return out
  for (const lang of MULTILINGUAL_LANGS) {
    const entry = entity.labels[lang]
    if (entry && typeof entry.value === 'string' && entry.value.length > 0) {
      out[lang] = entry.value
    }
  }
  return out
}

/**
 * Convert a resolved entity into our Candidate shape. Returns null if the
 * entity is too sparse to be useful (no Q-ID or no usable title).
 */
export function entityToCandidate(
  entity: WbEntity,
  type: 'movie' | 'series',
  preferredLang: string
): Candidate | null {
  const qid = entity.id
  if (!qid) return null

  const labels = collectLabels(entity)

  const originalTitle = firstClaimValue(entity, 'P1476', parseMonolingualText)
  const preferredLabel =
    labels[preferredLang] || labels['en'] || pickFirstLabel(labels)

  const title = originalTitle || preferredLabel
  if (!title) return null

  const imdbId = firstClaimValue(entity, 'P345', parseStringValue)
  const tmdbId = firstClaimValue(entity, 'P4947', parseTmdbId)
  const year = firstClaimValue(entity, 'P577', parsePublicationYear)

  return {
    externalIds: {
      wikidataQid: qid,
      ...(imdbId ? { imdbId } : {}),
      ...(tmdbId !== undefined ? { tmdbId } : {}),
    },
    title,
    year,
    type,
    multilingualLabels: Object.keys(labels).length ? labels : undefined,
    rawSource: PROVIDER_NAME,
  }
}

function pickFirstLabel(labels: Record<string, string>): string | undefined {
  for (const key of Object.keys(labels)) {
    const v = labels[key]
    if (v) return v
  }
  return undefined
}
