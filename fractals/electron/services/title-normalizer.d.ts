/**
 * Title normalizer — L14 of the V3 data-search plan.
 *
 * Parses a raw provider title into:
 *   - `normalizedTitle` — cleaned string used for hashing and oracle lookup
 *   - `year` — metadata year (drives content_hash alongside normalizedTitle)
 *   - `languageHint`, `originHint`, `qualityHint` — structured hints for the
 *     association row
 *
 * Rules (see fractals/docs/data-search-v3-plan.md → L14):
 *   • Strip-and-capture leading language prefixes (`EN - `, `|UK|`, `[FR]`, …)
 *   • Strip-and-capture trailing origin tags (`(DE)`, `[US]`, …)
 *   • Strip-and-capture quality tags (`[4K]`, `(1080p)`, `(HEVC)`, `[MULTI]`, …)
 *   • Strip-and-capture year in `(YYYY)` or trailing bare `YYYY` (1900–2099)
 *   • Do NOT strip numbers embedded in the title body (`1984`, `300`, `2001`)
 *   • NFKC → lowercase → European-only diacritic fold via any-ascii
 *   • Non-European scripts (Arabic, Cyrillic, CJK, Hebrew, …) pass through
 *   • Collapse whitespace
 */
export interface NormalizedTitle {
    normalizedTitle: string;
    year?: number;
    languageHint?: string;
    originHint?: string;
    qualityHint?: string;
}
export declare function normalize(raw: string): NormalizedTitle;
