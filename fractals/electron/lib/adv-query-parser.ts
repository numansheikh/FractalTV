import { normalizeForSearch } from './normalize'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdvClause {
  column: string | null   // md_year, md_language, md_quality, md_prefix, or null (title-only)
  value: string | number  // the column value to match
  token: string           // original token for title LIKE fallback
  explicit: boolean       // true = field:value syntax (no OR fallback)
}

export interface AdvQuery {
  clauses: AdvClause[]
}

// ─── Lookup tables ────────────────────────────────────────────────────────────

// Language: English names + ISO codes + IPTV prefix codes → md_language value
const LANGUAGE_LOOKUP: Record<string, string> = {
  // English names
  english: 'en', french: 'fr', german: 'de', spanish: 'es', arabic: 'ar',
  italian: 'it', russian: 'ru', turkish: 'tr', polish: 'pl', portuguese: 'pt',
  hindi: 'hi', dutch: 'nl', swedish: 'sv', greek: 'el', danish: 'da',
  romanian: 'ro', bulgarian: 'bg', hungarian: 'hu', norwegian: 'no',
  icelandic: 'is', hebrew: 'he', kurdish: 'ku', persian: 'fa', farsi: 'fa',
  urdu: 'ur', tamil: 'ta', telugu: 'te', malayalam: 'ml', kannada: 'kn',
  punjabi: 'pa', bengali: 'bn', albanian: 'sq', afrikaans: 'af', filipino: 'fil',
  // ISO 639-1 codes (self-mapping)
  en: 'en', fr: 'fr', de: 'de', es: 'es', ar: 'ar', it: 'it', ru: 'ru',
  tr: 'tr', pl: 'pl', pt: 'pt', hi: 'hi', nl: 'nl', sv: 'sv', el: 'el',
  da: 'da', ro: 'ro', bg: 'bg', hu: 'hu', no: 'no', is: 'is', he: 'he',
  ku: 'ku', fa: 'fa', ur: 'ur', ta: 'ta', te: 'te', ml: 'ml', kn: 'kn',
  pa: 'pa', bn: 'bn', sq: 'sq', af: 'af', fil: 'fil', so: 'so',
}

// IPTV prefix codes → md_prefix value (uppercase)
// Only codes that map to a language — platform prefixes (NF, SC, etc.) excluded
// since they're less likely search terms
const PREFIX_LOOKUP: Record<string, string> = {
  en: 'EN', eng: 'ENG', fr: 'FR', de: 'DE', ar: 'AR', es: 'ES', pl: 'PL',
  ir: 'IR', in: 'IN', al: 'AL', gr: 'GR', nl: 'NL', se: 'SE', pt: 'PT',
  br: 'BR', ru: 'RU', tr: 'TR', dk: 'DK', ro: 'RO', bg: 'BG', hu: 'HU',
  no: 'NO', il: 'IL', ph: 'PH', pk: 'PK',
  // Platform prefixes users might search for
  nf: 'NF', sc: 'SC', amz: 'AMZ',
}

// Quality keywords → md_quality value
const QUALITY_LOOKUP: Record<string, string> = {
  '4k': '4K', '2160p': '4K', uhd: '4K',
  '1080p': '1080p', fullhd: '1080p',
  '720p': '720p', hd: 'HD',
  bluray: 'BluRay', 'blu-ray': 'BluRay',
  'web-dl': 'WEB-DL', webdl: 'WEB-DL',
  lq: 'LQ',
}

// Explicit field:value mapping → column name
const FIELD_MAP: Record<string, string> = {
  year: 'md_year',
  lang: 'md_language',
  language: 'md_language',
  quality: 'md_quality',
  prefix: 'md_prefix',
  country: 'md_country',
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function isYear(s: string): boolean {
  if (!/^[12]\d{3}$/.test(s)) return false
  const n = Number(s)
  return n >= 1888 && n <= 2030
}

/**
 * Parse an @-stripped advanced query string into structured clauses.
 */
export function parseAdvQuery(raw: string): AdvQuery {
  const clauses: AdvClause[] = []
  const tokens = tokenize(raw)

  for (const token of tokens) {
    // 1. Check field:value syntax
    const colonIdx = token.indexOf(':')
    if (colonIdx > 0 && colonIdx < token.length - 1) {
      const field = token.slice(0, colonIdx).toLowerCase()
      const val = token.slice(colonIdx + 1)
      const column = FIELD_MAP[field]
      if (column) {
        clauses.push({
          column,
          value: column === 'md_year' ? Number(val) : val,
          token,
          explicit: true,
        })
        continue
      }
    }

    const lower = token.toLowerCase()

    // 2. Check year (4-digit number)
    if (isYear(token)) {
      clauses.push({ column: 'md_year', value: Number(token), token, explicit: false })
      continue
    }

    // 3. Check quality
    const quality = QUALITY_LOOKUP[lower]
    if (quality) {
      clauses.push({ column: 'md_quality', value: quality, token, explicit: false })
      continue
    }

    // 4. Check language (English names first — longer, less ambiguous)
    const lang = LANGUAGE_LOOKUP[lower]
    if (lang && lower.length > 2) {
      // Only auto-detect language for names longer than 2 chars (avoid "it", "no", "in" ambiguity)
      clauses.push({ column: 'md_language', value: lang, token, explicit: false })
      continue
    }

    // 5. Check prefix (2-3 letter codes, only when uppercase in original)
    if (token === token.toUpperCase() && token.length >= 2 && token.length <= 4) {
      const prefix = PREFIX_LOOKUP[lower]
      if (prefix) {
        clauses.push({ column: 'md_prefix', value: prefix, token, explicit: false })
        continue
      }
    }

    // 6. Unrecognized → title-only
    clauses.push({ column: null, value: token, token, explicit: false })
  }

  return { clauses }
}

/**
 * Tokenize: split on spaces, but respect "quoted strings" as single tokens.
 */
function tokenize(raw: string): string[] {
  const tokens: string[] = []
  const re = /"([^"]+)"|(\S+)/g
  let m
  while ((m = re.exec(raw)) !== null) {
    tokens.push(m[1] ?? m[2])
  }
  return tokens
}

// ─── SQL builder ──────────────────────────────────────────────────────────────

/**
 * Build a WHERE clause fragment and params from parsed AdvQuery.
 * `alias` is the table alias (c, m, sr).
 * Returns { where: string, params: unknown[] } to be AND-ed with other conditions.
 * Returns null if no clauses (caller should skip).
 */
export function buildAdvWhere(query: AdvQuery, alias: string): { where: string; params: unknown[] } | null {
  if (!query.clauses.length) return null

  const parts: string[] = []
  const params: unknown[] = []

  for (const clause of query.clauses) {
    if (clause.explicit) {
      // field:value → exact match only
      parts.push(`${alias}.${clause.column} = ?`)
      params.push(clause.value)
    } else if (clause.column) {
      // Auto-detected → (column = value OR search_title LIKE '%token%')
      const normalized = normalizeForSearch(clause.token)
      if (normalized) {
        parts.push(`(${alias}.${clause.column} = ? OR ${alias}.search_title LIKE ?)`)
        params.push(clause.value, `%${normalized}%`)
      } else {
        parts.push(`${alias}.${clause.column} = ?`)
        params.push(clause.value)
      }
    } else {
      // Title-only
      const normalized = normalizeForSearch(clause.token)
      if (normalized) {
        parts.push(`${alias}.search_title LIKE ?`)
        params.push(`%${normalized}%`)
      }
    }
  }

  if (!parts.length) return null
  return { where: parts.join(' AND '), params }
}
