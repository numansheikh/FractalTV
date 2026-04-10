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
import type { Candidate, ExternalIdType, LookupHints, MetadataProvider, ProviderHints } from '../provider';
import type { RateLimiter } from '../rate-limiter';
/** Subset of the raw IMDb suggest payload we actually consume. */
interface RawImdbItem {
    id?: string;
    l?: string;
    q?: string;
    qid?: string;
    y?: number | string;
    i?: [string, number, number];
    s?: string;
}
/** IMDb suggest metadata provider. */
export declare class ImdbSuggestProvider implements MetadataProvider {
    private readonly rateLimiter;
    readonly name = "imdb-suggest";
    readonly priority = 10;
    constructor(rateLimiter: RateLimiter);
    supports(hints: ProviderHints): boolean;
    lookupByTitle(query: string, hints: LookupHints): Promise<Candidate[]>;
    lookupByExternalId(_type: ExternalIdType, _id: string): Promise<Candidate | null>;
    private fetchJsonp;
}
/**
 * Normalize a raw query to the slug IMDb expects:
 * - Lowercase
 * - Strip everything but alphanum + whitespace
 * - Collapse runs of whitespace into a single `_`
 *
 * Empty/whitespace-only input yields `''` — caller must skip.
 */
export declare function toQuerySlug(query: string): string;
/**
 * Strip the `imdb$<slug>(` prefix and trailing `)` from a JSONP body before
 * handing it to `JSON.parse`. Returns `null` if the envelope doesn't match.
 */
export declare function parseJsonp(body: string, slug: string): {
    d?: RawImdbItem[];
} | null;
/**
 * Derive a thumbnail URL from the full poster URL by injecting `._V1_SX300`
 * before the final extension. Amazon's image pipeline accepts the transform
 * inline — no extra HTTP round-trip.
 */
export declare function deriveThumbnailUrl(posterUrl: string): string;
export {};
