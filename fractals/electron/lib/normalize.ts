// any-ascii is a dual ESM/CJS package — require() returns { default: fn }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const anyAscii: (s: string) => string = require('any-ascii').default ?? require('any-ascii')

/**
 * Shared normalizer for g1c search. Used in two places:
 *   1. Index pipeline step — populates `search_title` on channels/movies/series
 *      from the raw `title` column.
 *   2. Search-time — normalizes the user's query string before passing to FTS MATCH.
 *
 * Scope is minimal (per locked g1c decision):
 *   • lowercase
 *   • diacritic strip (é→e, ü→u, ñ→n, etc. — any-ascii handles these)
 *   • ligature fold (æ→ae, ß→ss, œ→oe, etc. — any-ascii handles these too)
 *
 * Explicitly NOT done:
 *   • punctuation strip
 *   • whitespace collapse
 *   • leading-article strip ("The ", "A ", "An ")
 *
 * FTS tokenizer is `unicode61 remove_diacritics 0` — it trusts this function to
 * have done the folding already, so both ends use the same single source of truth.
 */
export function normalizeForSearch(text: string): string {
  if (!text) return ''
  return anyAscii(text).toLowerCase()
}
