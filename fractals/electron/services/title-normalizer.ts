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

// any-ascii is dual ESM/CJS — require() returns { default: fn } depending on bundler
// eslint-disable-next-line @typescript-eslint/no-require-imports
const anyAscii: (s: string) => string = require('any-ascii').default ?? require('any-ascii')

export interface NormalizedTitle {
  normalizedTitle: string
  year?: number
  languageHint?: string
  originHint?: string
  qualityHint?: string
}

// ─── Vocabularies ──────────────────────────────────────────────────────────

/**
 * Known quality tokens (case-insensitive). Anything inside `[...]` or `(...)`
 * matching one of these is captured as `qualityHint`.
 *
 * Kept intentionally small — L14 says the normalizer is "minimal, good enough
 * to collapse obvious duplicates". Exotic tags stay in the title body.
 */
const QUALITY_TOKENS = new Set([
  '4k', '2160p', 'uhd',
  '1080p', '1080i', 'fhd',
  '720p', 'hd',
  '576p', '480p', 'sd',
  'hevc', 'h265', 'h.265', 'x265',
  'h264', 'h.264', 'x264',
  'hdr', 'hdr10', 'dv', 'dolby',
  'multi', 'multisub', 'multiaudio',
  'vip',
])

/**
 * ISO 639-ish language codes we recognize as leading prefixes. Also accept
 * 2-letter country-scoped variants (`AR-IN`, `PT-BR`, …) via a regex shape,
 * not this set.
 */
const LANGUAGE_CODES = new Set([
  'en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'sv', 'no', 'da', 'fi', 'pl',
  'ru', 'uk', 'cs', 'sk', 'hu', 'ro', 'bg', 'el', 'tr', 'ar', 'he', 'fa',
  'hi', 'ur', 'bn', 'ta', 'te', 'ml', 'zh', 'ja', 'ko', 'th', 'vi', 'id',
  'ms', 'tl', 'sr', 'hr', 'sl', 'lt', 'lv', 'et', 'ca', 'eu', 'gl', 'ga',
  'cy', 'is', 'mt', 'sq', 'mk', 'bs', 'af', 'sw', 'am', 'ka', 'hy', 'az',
  'kk', 'uz', 'mn',
])

/**
 * 2-letter ISO country codes (plus a few common 2-letter tags we see in
 * provider feeds). Used to classify trailing `(XX)` / `[XX]` as origin vs
 * language. When a token appears as a leading prefix it's classified as a
 * language hint; when trailing, as an origin hint.
 */
const COUNTRY_CODES = new Set([
  'us', 'uk', 'gb', 'ca', 'au', 'nz', 'ie',
  'fr', 'de', 'es', 'it', 'pt', 'nl', 'be', 'ch', 'at', 'se', 'no', 'dk',
  'fi', 'pl', 'cz', 'sk', 'hu', 'ro', 'bg', 'gr', 'tr', 'ru', 'ua',
  'br', 'mx', 'ar', 'cl', 'co', 'pe', 've',
  'jp', 'kr', 'cn', 'tw', 'hk', 'sg', 'in', 'pk', 'id', 'th', 'vn', 'ph',
  'sa', 'ae', 'eg', 'ma', 'dz', 'tn', 'iq', 'ir', 'il', 'lb', 'sy', 'jo',
  'za', 'ng', 'ke',
])

// ─── Regexes ───────────────────────────────────────────────────────────────

/**
 * Year range 1900–2099. Used for both `(YYYY)` and trailing bare `YYYY`.
 */
const PARENTHESIZED_YEAR_RE = /[([]((?:19|20)\d{2})[)\]]/
const TRAILING_BARE_YEAR_RE = /\s+((?:19|20)\d{2})\s*$/

/**
 * Leading language prefix of the form `XX - ` or `XX-YY - ` (dash-space
 * terminated). Example matches: `EN - `, `FR - `, `AR-IN - `, `PT-BR - `.
 *
 * We don't anchor to the exact language vocabulary here — we also match
 * 2-letter country-scoped variants like `AR-IN` that aren't ISO 639. The
 * caller validates against LANGUAGE_CODES for the plain 2-letter case.
 */
const LEADING_DASH_PREFIX_RE = /^([A-Za-z]{2}(?:-[A-Za-z]{2})?)\s*-\s+/

/**
 * Non-European script detection. We treat a character as "European" if it
 * falls in Latin, Greek, or Cyrillic blocks — those are the scripts any-ascii
 * handles via diacritic/ligature fold without destroying the source.
 *
 * Wait: Cyrillic is non-European per L14's intent (it wants Cyrillic to pass
 * through unchanged so Wikidata can resolve it via multilingual labels). So
 * "European" here means **Latin only** — Latin basic, Latin-1 supplement,
 * Latin Extended-A/B, IPA, Latin Extended Additional, half-width/full-width
 * Latin. Greek and Cyrillic are treated as non-Latin and pass through.
 *
 * This uses Unicode property escapes (ES2018). Requires the `u` flag.
 */
const LATIN_CHAR_RE = /\p{Script=Latin}/u
const NON_LATIN_LETTER_RE = /\p{L}/u

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Split a string into runs of Latin vs non-Latin characters. Non-letter
 * characters (spaces, digits, punctuation) attach to whichever run they fall
 * inside; we fold them with the Latin run (they're already ASCII-safe).
 */
function foldLatinRunsOnly(input: string): string {
  let out = ''
  let buf = ''
  let bufIsLatin = true
  const flush = () => {
    if (!buf) return
    out += bufIsLatin ? anyAscii(buf) : buf
    buf = ''
  }
  for (const ch of input) {
    // Non-letter (digits, punctuation, whitespace) → fold with Latin run.
    // any-ascii is a no-op on ASCII so this is free when buf is already Latin.
    const isLetter = NON_LATIN_LETTER_RE.test(ch)
    const isLatin = !isLetter || LATIN_CHAR_RE.test(ch)
    if (isLatin !== bufIsLatin && buf !== '') {
      flush()
    }
    bufIsLatin = isLatin
    buf += ch
  }
  flush()
  return out
}

/**
 * Collapse runs of whitespace and trim.
 */
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Classify a bracketed/piped tag. Returns what it represents, or null if it's
 * unrecognized (in which case we leave it in the title body).
 */
interface TagClass {
  kind: 'language' | 'origin' | 'quality' | 'year'
  value: string
}
function classifyTag(rawInner: string, position: 'leading' | 'trailing' | 'inner'): TagClass | null {
  const token = rawInner.trim().toLowerCase()
  if (!token) return null

  // Year?
  if (/^(?:19|20)\d{2}$/.test(token)) {
    return { kind: 'year', value: token }
  }

  // Quality?
  if (QUALITY_TOKENS.has(token)) {
    return { kind: 'quality', value: token }
  }

  // Language vs origin: 2-letter code or 2+2 scoped code.
  // Leading tag → language hint. Trailing tag → origin hint. Inner tags
  // default to language (rare; we'd rather extract than leave in title).
  const isLangShape = /^[a-z]{2}(?:-[a-z]{2})?$/.test(token)
  if (isLangShape) {
    if (position === 'trailing') {
      // Prefer origin classification when the base code looks like a country.
      const base = token.split('-')[0]
      if (COUNTRY_CODES.has(base)) return { kind: 'origin', value: token }
      if (LANGUAGE_CODES.has(base)) return { kind: 'origin', value: token }
      return null
    }
    const base = token.split('-')[0]
    if (LANGUAGE_CODES.has(base) || COUNTRY_CODES.has(base)) {
      return { kind: 'language', value: token }
    }
  }

  return null
}

// ─── Main entry ────────────────────────────────────────────────────────────

export function normalize(raw: string): NormalizedTitle {
  if (!raw) return { normalizedTitle: '' }

  // Step 0: NFKC normalization (width, ligatures). Applied first so that all
  // downstream regexes see canonical forms.
  let work = raw.normalize('NFKC')

  const result: NormalizedTitle = { normalizedTitle: '' }

  // Step 1: leading `XX - ` / `XX-YY - ` language prefix.
  // Done before bracketed tag extraction so that a title like
  // `EN - [FR] Movie` would capture `en` as language (first wins).
  const leadMatch = work.match(LEADING_DASH_PREFIX_RE)
  if (leadMatch) {
    const code = leadMatch[1].toLowerCase()
    const base = code.split('-')[0]
    // Accept if the base code is in our language or country vocabularies.
    if (LANGUAGE_CODES.has(base) || COUNTRY_CODES.has(base)) {
      result.languageHint = code
      work = work.slice(leadMatch[0].length)
    }
  }

  // Step 2: extract `(YYYY)` year anywhere (typically trailing). We do this
  // before general bracket stripping so that `(1999)` is recognized as year
  // rather than getting swallowed by the country-code classifier.
  const parenYearMatch = work.match(PARENTHESIZED_YEAR_RE)
  if (parenYearMatch) {
    result.year = parseInt(parenYearMatch[1], 10)
    work = work.slice(0, parenYearMatch.index!) + ' ' + work.slice(parenYearMatch.index! + parenYearMatch[0].length)
  }

  // Step 3: extract leading bracketed/piped tag (e.g. `|UK| Sky Sports`).
  // Only a single leading tag — the very first non-whitespace token.
  {
    const leadingBracketRe = /^\s*[[(|]([^\s[\](){}|]+)[\])|]\s*/
    const m = work.match(leadingBracketRe)
    if (m) {
      const cls = classifyTag(m[1], 'leading')
      if (cls) {
        if (cls.kind === 'language' && !result.languageHint) result.languageHint = cls.value
        else if (cls.kind === 'quality' && !result.qualityHint) result.qualityHint = cls.value
        else if (cls.kind === 'origin' && !result.originHint) result.originHint = cls.value
        else if (cls.kind === 'year' && result.year === undefined) result.year = parseInt(cls.value, 10)
        if (cls) work = work.slice(m[0].length)
      }
    }
  }

  // Step 4: extract trailing bracketed/piped tags, innermost-first. We loop
  // because titles like `Foo (DE) [4K]` have multiple trailing tags.
  {
    const trailingBracketRe = /\s*[[(|]([^\s[\](){}|]+)[\])|]\s*$/
    let guard = 0
    while (guard++ < 6) {
      const m = work.match(trailingBracketRe)
      if (!m) break
      const cls = classifyTag(m[1], 'trailing')
      if (!cls) break
      if (cls.kind === 'language' && !result.languageHint) result.languageHint = cls.value
      else if (cls.kind === 'quality' && !result.qualityHint) result.qualityHint = cls.value
      else if (cls.kind === 'origin' && !result.originHint) result.originHint = cls.value
      else if (cls.kind === 'year' && result.year === undefined) result.year = parseInt(cls.value, 10)
      work = work.slice(0, m.index!)
    }
  }

  // Step 5a: trailing bare quality tokens (no brackets). Catches things like
  // `Sky Sports HD` → title "sky sports", qualityHint "hd". We only strip
  // tokens that appear in QUALITY_TOKENS and only when there is still real
  // title content in front.
  {
    let guard = 0
    while (guard++ < 3) {
      const m = work.match(/\s+([A-Za-z0-9.]+)\s*$/)
      if (!m) break
      const token = m[1].toLowerCase()
      if (!QUALITY_TOKENS.has(token)) break
      const before = work.slice(0, m.index!).trim()
      if (!before) break
      if (!result.qualityHint) result.qualityHint = token
      work = before
    }
  }

  // Step 5b: trailing bare YYYY (no brackets). Only captured when it is
  // clearly metadata — i.e. there is still real title content in front of it.
  // This preserves `1984` and `300` as titles.
  if (result.year === undefined) {
    const m = work.match(TRAILING_BARE_YEAR_RE)
    if (m) {
      const before = work.slice(0, m.index!).trim()
      // Require the preceding content to contain at least one non-digit letter
      // so we don't strip the year from a bare-number title like `1984` or
      // `300`. Multi-word bare numerics (`2001 2` → unlikely) are ignored.
      if (before && /\p{L}/u.test(before)) {
        result.year = parseInt(m[1], 10)
        work = before
      }
    }
  }

  // Step 6: clean remainder — NFKC was already applied. Now lowercase and
  // fold Latin diacritics while preserving non-Latin scripts.
  work = work.toLowerCase()
  work = foldLatinRunsOnly(work)
  work = collapseWhitespace(work)

  result.normalizedTitle = work
  return result
}
