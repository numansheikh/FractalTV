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
import type { Candidate, ExternalIdType, LookupHints, MetadataProvider, ProviderHints } from '../provider';
import type { RateLimiter } from '../rate-limiter';
/** Languages we pull labels for (top ~15 by coverage). */
export declare const MULTILINGUAL_LANGS: readonly ["en", "fr", "de", "es", "it", "ru", "ar", "zh", "ja", "ko", "hi", "pt", "tr", "pl", "nl"];
interface WbLabel {
    language?: string;
    value?: string;
}
interface WbClaim {
    mainsnak?: {
        snaktype?: string;
        datavalue?: {
            type?: string;
            value?: unknown;
        };
    };
}
interface WbEntity {
    id?: string;
    labels?: Record<string, WbLabel>;
    descriptions?: Record<string, WbLabel>;
    claims?: Record<string, WbClaim[]>;
}
/** Wikidata metadata provider. */
export declare class WikidataProvider implements MetadataProvider {
    private readonly rateLimiter;
    readonly name = "wikidata";
    readonly priority = 20;
    constructor(rateLimiter: RateLimiter);
    supports(_hints: ProviderHints): boolean;
    lookupByTitle(query: string, hints: LookupHints): Promise<Candidate[]>;
    lookupByExternalId(type: ExternalIdType, id: string): Promise<Candidate | null>;
    private wbSearchEntities;
    private wbGetEntities;
    private findQidsByStatement;
    private fetchJson;
}
/** Is this entity an instance of (directly or via P31) the given Q-ID? */
export declare function entityIsInstanceOf(entity: WbEntity, qid: string): boolean;
/** Resolve P31 to our canonical movie/series type, or undefined if neither. */
export declare function resolveEntityType(entity: WbEntity): 'movie' | 'series' | undefined;
/** Parse a P577 time datavalue (e.g. `+1999-03-31T00:00:00Z`) to a year integer. */
export declare function parsePublicationYear(v: unknown): number | undefined;
/** Extract a monolingualtext `text` field (e.g. P1476 original title). */
export declare function parseMonolingualText(v: unknown): string | undefined;
/**
 * Convert a resolved entity into our Candidate shape. Returns null if the
 * entity is too sparse to be useful (no Q-ID or no usable title).
 */
export declare function entityToCandidate(entity: WbEntity, type: 'movie' | 'series', preferredLang: string): Candidate | null;
export {};
