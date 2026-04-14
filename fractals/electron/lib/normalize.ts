// any-ascii is a dual ESM/CJS package — require() returns { default: fn }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const anyAscii: (s: string) => string = require('any-ascii').default ?? require('any-ascii')

/**
 * Shared normalizer for search. Used in two places:
 *   1. Sync workers — populate `search_title` on channels/movies/series at INSERT time.
 *   2. Search-time — normalize the user's query before the LIKE comparison.
 *
 * Both sides go through this same function, which is why diacritic / ligature
 * search is bidirectional (ae↔æ, e↔é, ss↔ß, oe↔œ).
 *
 * Current scope:
 *   • lowercase
 *   • diacritic strip (é→e, ü→u, ñ→n, etc.)
 *   • ligature fold (æ→ae, ß→ss, œ→oe, etc.)
 *
 * Future cleanups (punctuation strip, whitespace collapse, leading-article
 * strip) layer in here — update the function and re-sync.
 */
export function normalizeForSearch(text: string): string {
  if (!text) return ''
  return anyAscii(text).toLowerCase()
}
