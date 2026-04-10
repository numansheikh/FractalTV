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

/** ISO 639-1 codes that are common in IPTV library titles.
 *  Kept deliberately short — only codes that realistically appear in
 *  provider titles AND are unambiguous as search tokens.
 *  Full ISO 639-1 has 184 codes; we only need the ones users will type.
 */
const ISO_639_1 = new Set([
  'aa','ab','ae','af','ak','am','an','ar','as','av','ay','az',
  'ba','be','bg','bi','bm','bn','bo','br','bs',
  'ca','ce','ch','co','cr','cs','cu','cv','cy',
  'da','de','dv','dz',
  'ee','el','en','eo','es','et','eu',
  'fa','ff','fi','fj','fo','fr','fy',
  'ga','gd','gl','gn','gu','gv',
  'ha','he','hi','ho','hr','ht','hu','hy',
  'hz',
  'ia','id','ie','ig','ii','ik','io','is','it','iu',
  'ja','jv',
  'ka','kg','ki','kj','kk','kl','km','kn','ko','kr','ks','ku','kv','kw','ky',
  'la','lb','lg','li','ln','lo','lt','lu','lv',
  'mg','mh','mi','mk','ml','mn','mr','ms','mt','my',
  'na','nb','nd','ne','ng','nl','nn','no','nr','nv','ny',
  'oc','oj','om','or','os',
  'pa','pi','pl','ps','pt',
  'qu',
  'rm','rn','ro','ru','rw',
  'sa','sc','sd','se','sg','si','sk','sl','sm','sn','so','sq','sr','ss','st','su','sv','sw',
  'ta','te','tg','th','ti','tk','tl','tn','to','tr','ts','tt','tw','ty',
  'ug','uk','ur','uz',
  've','vi','vo',
  'wa','wo',
  'xh',
  'yi','yo',
  'za','zh','zu',
])

const TYPE_KEYWORDS = new Map<string, 'movie' | 'series' | 'live'>([
  ['movie',  'movie'],
  ['movies', 'movie'],
  ['film',   'movie'],
  ['films',  'movie'],
  ['series', 'series'],
  ['show',   'series'],
  ['shows',  'series'],
  ['tv',     'series'],
  ['live',   'live'],
  ['channel','live'],
  ['channels','live'],
])

const YEAR_RE = /^\d{4}$/

function isYear(token: string): boolean {
  if (!YEAR_RE.test(token)) return false
  const n = parseInt(token, 10)
  return n >= 1900 && n <= 2099
}

export interface ParsedQuery {
  /** Raw original query string, trimmed. */
  raw: string
  /** True when the query starts with @. */
  isAdvanced: boolean
  /** ISO 639-1 code if a language token was found, else null. */
  langFilter: string | null
  /**
   * Year if a 4-digit token in 1900–2099 was found, else null.
   * Per L6, this token ALSO appears in titleTokens (dual-interpretation).
   */
  yearFilter: number | null
  /** Content type filter if a type keyword was found, else null. */
  typeFilter: 'movie' | 'series' | 'live' | null
  /**
   * Remaining tokens that form the title/free-text part of the query.
   * In basic mode this is just the full query (no tokenization).
   * In advanced mode, classified tokens are consumed; leftovers go here.
   * Per L6, numeric year tokens are also kept here.
   */
  titleTokens: string[]
  /**
   * Joined titleTokens, ready to pass to FTS5 / LIKE.
   * Empty string if no title tokens remain.
   */
  titleQuery: string
  /**
   * L6 ambiguous-collision flag: true when the user typed a single token that
   * was BOTH consumed as a lang/type filter AND dual-interpreted as a title
   * token (e.g. `@hu`, `@en`, `@live`). The handler should run BOTH queries
   * (lang-only and title-only) and merge, instead of ANDing them.
   *
   * False for normal cases like `@fr matrix` where `fr` is unambiguously a
   * language filter.
   */
  ambiguousLoneToken: boolean
}

/**
 * Parse a raw search query string into structured filters.
 *
 * Safe to call on every keystroke — pure, no I/O.
 */
export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim()

  if (!trimmed.startsWith('@')) {
    return {
      raw: trimmed,
      isAdvanced: false,
      langFilter: null,
      yearFilter: null,
      typeFilter: null,
      titleTokens: trimmed ? [trimmed] : [],
      titleQuery: trimmed,
      ambiguousLoneToken: false,
    }
  }

  // Strip the leading @ and tokenize on whitespace.
  const body = trimmed.slice(1).trim()
  const tokens = body.split(/\s+/).filter(Boolean)

  let langFilter: string | null = null
  let yearFilter: number | null = null
  let typeFilter: 'movie' | 'series' | 'live' | null = null
  const titleTokens: string[] = []

  // Track the original-cased token for any classified filter so we can
  // dual-interpret it as a title token if it ends up being the only thing the
  // user typed (the L6 ambiguous-collision case: `@hu`, `@en`, `@live`).
  let langToken: string | null = null
  let typeToken: string | null = null

  for (const tok of tokens) {
    const lower = tok.toLowerCase()

    // Type keyword — consumed.
    if (!typeFilter && TYPE_KEYWORDS.has(lower)) {
      typeFilter = TYPE_KEYWORDS.get(lower)!
      typeToken = tok
      continue
    }

    // Language — consumed. Checked AFTER type so "live" routes to type.
    if (!langFilter && ISO_639_1.has(lower) && lower.length === 2) {
      langFilter = lower
      langToken = tok
      continue
    }

    // Year — consumed AND always kept as title token (L6).
    // Years are always plausible title fragments (1984, 300, 2001) so the
    // dual-interpretation runs unconditionally.
    if (!yearFilter && isYear(lower)) {
      yearFilter = parseInt(lower, 10)
      titleTokens.push(tok)
      continue
    }

    // Everything else → title token.
    titleTokens.push(tok)
  }

  // L6 ambiguous-collision: if a lang/type was the ONLY thing the user typed
  // (no other title tokens), dual-interpret it as a title token too. This
  // makes `@hu` → also search for "hu*" titles, while `@fr matrix` keeps `fr`
  // as a definitive filter and only searches for "matrix*".
  let ambiguousLoneToken = false
  if (titleTokens.length === 0) {
    if (langToken) {
      titleTokens.push(langToken)
      ambiguousLoneToken = true
    } else if (typeToken) {
      titleTokens.push(typeToken)
      ambiguousLoneToken = true
    }
  }

  return {
    raw: trimmed,
    isAdvanced: true,
    langFilter,
    yearFilter,
    typeFilter,
    titleTokens,
    titleQuery: titleTokens.join(' '),
    ambiguousLoneToken,
  }
}

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
export function buildFts5Query(titleQuery: string): string | null {
  const words = titleQuery.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null

  // Escape FTS5 special characters inside each token.
  const escaped = words.map((w) =>
    '"' + w.replace(/"/g, '""') + '"'
  )

  // Last token gets prefix match (*) if the user is mid-word.
  // If the raw query ended with a space, treat last word as exact.
  const lastIsPrefix = !titleQuery.endsWith(' ')
  if (lastIsPrefix && escaped.length > 0) {
    const last = escaped[escaped.length - 1]
    // Strip closing quote, add *, re-close.
    escaped[escaped.length - 1] = last.slice(0, -1) + '*"'
  }

  return escaped.join(' ')
}
