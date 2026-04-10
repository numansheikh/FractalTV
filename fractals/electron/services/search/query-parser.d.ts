/**
 * Search query parser — V3 Phase F (L4 + L5 + L6).
 *
 * Two modes, encoded in the query string itself (L4):
 *   Basic   — no @ prefix. Fast path: FTS5 on canonical only.
 *   Advanced — leading @. Position-invariant token classifier.
 *
 * Advanced vocabulary (trimmed per user decisions):
 *   Language  — ISO 639-1 two-letter codes  (fr, ar, en, de, hi, zh, …)
 *   Year      — 4-digit number 1900–2099 (L6: also kept as title token)
 *   Type      — movie | series | live
 *
 * Dropped from original plan: source aliases (redundant with source dot),
 * quality tokens (stored column, not a search dimension).
 *
 * L6 dual-interpretation for numeric tokens:
 *   A 4-digit number in range 1900–2099 is BOTH a year filter candidate AND
 *   a title token. The caller runs both interpretations and merges results,
 *   ranking exact canonical title matches highest.
 *
 * L5 soft year: year is a rank-boost, not an exclusion. The SQL layer
 * uses it as a score boost and a tiebreaker, not a WHERE clause.
 */
export interface ParsedQuery {
    /** Raw original query string, trimmed. */
    raw: string;
    /** True when the query starts with @. */
    isAdvanced: boolean;
    /** ISO 639-1 code if a language token was found, else null. */
    langFilter: string | null;
    /**
     * Year if a 4-digit token in 1900–2099 was found, else null.
     * Per L6, this token ALSO appears in titleTokens (dual-interpretation).
     */
    yearFilter: number | null;
    /** Content type filter if a type keyword was found, else null. */
    typeFilter: 'movie' | 'series' | 'live' | null;
    /**
     * Remaining tokens that form the title/free-text part of the query.
     * In basic mode this is just the full query (no tokenization).
     * In advanced mode, classified tokens are consumed; leftovers go here.
     * Per L6, numeric year tokens are also kept here.
     */
    titleTokens: string[];
    /**
     * Joined titleTokens, ready to pass to FTS5 / LIKE.
     * Empty string if no title tokens remain.
     */
    titleQuery: string;
}
/**
 * Parse a raw search query string into structured filters.
 *
 * Safe to call on every keystroke — pure, no I/O.
 */
export declare function parseQuery(raw: string): ParsedQuery;
/**
 * Build an FTS5 match expression from a title query string.
 *
 * FTS5 quirks handled:
 *   - Special chars (", *, ^) are escaped.
 *   - Trailing space on the last token = exact word (don't prefix-match).
 *   - No trailing space = prefix match with *.
 *   - Multi-word queries become AND of prefix matches.
 *   - Empty input returns null (caller should skip FTS entirely).
 */
export declare function buildFts5Query(titleQuery: string): string | null;
