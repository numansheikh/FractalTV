// any-ascii is a dual ESM/CJS package — require() returns { default: fn }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const anyAscii: (s: string) => string = require('any-ascii').default ?? require('any-ascii')

/**
 * Normalize text for FTS indexing and query matching.
 * Converts Unicode to ASCII approximations so searches like "bla" find "Blå",
 * "ae" finds "Æ", "o" finds "ø", "ss" finds "ß", etc.
 * The FTS5 tokenizer (unicode61 remove_diacritics 2) handles simple accents like
 * é→e, ü→u, ñ→n already — this covers ligatures and special letters it can't decompose.
 */
export function normalizeForSearch(text: string): string {
  if (!text) return ''
  return anyAscii(text).toLowerCase()
}
