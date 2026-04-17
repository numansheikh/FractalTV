import { normalizeForSearch } from './normalize'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedTitle {
  searchTitle: string       // anyAscii + lowercase of clean title
  mdPrefix: string | null   // raw provider tag: "EN", "4K-AR", "NF", "AR-SUBS"
  mdLanguage: string | null // ISO 639-1 code mapped from prefix; null for platform prefixes
  mdYear: number | null     // from (YYYY) pattern, validated 1888–2026
  mdQuality: string | null  // "4K" | "1080p" | "720p" | "HD" | "BluRay" | "WEB-DL" | "LQ"
  isNsfw: 0 | 1             // weighted keyword scoring
}

// ─── Prefix → ISO language lookup ────────────────────────────────────────────

const PREFIX_TO_LANGUAGE: Record<string, string> = {
  EN: 'en', ENG: 'en',
  FR: 'fr', QFR: 'fr',
  DE: 'de',
  AR: 'ar', 'AR-SUBS': 'ar', 'AR-DUB': 'ar', 'AR-IN': 'ar', 'AR-EG': 'ar',
  'AR-SHAM': 'ar', 'AR-KH': 'ar', 'AR-TR-S': 'ar', 'AR-ANM-S': 'ar',
  'AR-DE': 'ar', 'AR-AS': 'ar', 'AR-AS-S': 'ar', 'AR-TR-D': 'ar',
  'AR-LI': 'ar', 'AR-DOC-S': 'ar',
  ES: 'es', 'ES-DO': 'es', LAT: 'es',
  PL: 'pl', 'PL 4K': 'pl',
  IR: 'fa',
  IN: 'hi', 'IN-EN': 'hi', 'IN-TL': 'te', 'IN-MM': 'ml', 'IN-TU': 'te',
  AL: 'sq',
  GR: 'el',
  NL: 'nl',
  SE: 'sv',
  PT: 'pt', BR: 'pt',
  RU: 'ru',
  IT: 'it',
  TR: 'tr',
  DK: 'da',
  RO: 'ro',
  BG: 'bg',
  TM: 'ta',
  TL: 'te',
  MA: 'ml',
  ML: 'ml',
  KN: 'kn',
  PB: 'pa',
  BN: 'bn',
  UR: 'ur',
  HU: 'hu',
  NO: 'no',
  IS: 'is',
  IL: 'he',
  KU: 'ku', 'KU-S': 'ku',
  TG: 'tg',
  AF: 'af',
  PH: 'fil',
  PK: 'ur',
  'SO-IN': 'so',
  'IN-KN': 'kn',
  STH: 'te',
  // Platform prefixes → no language
  NF: null, SC: null, EX: null, AMZ: null, TOP: null, PRMT: null,
  'D+': null, 'OSN+': null, 'NF-DO': null, '4K-D+': null, '4K-OSN+': null,
  SOC: null,
}

// ─── NSFW signals ─────────────────────────────────────────────────────────────

// Hard signals: any match → isNsfw = 1 immediately
//const NSFW_HARD_PREFIXES = ['[x]', '[X]']
const NSFW_HARD_PREFIXES = ['[xxx]', '[XXX]']

const NSFW_HARD_STUDIOS = [
  'brazzers', 'fakefaxi', 'faketaxi', 'blacked', 'bangbros', 'realitykings',
  'teamskeet', 'tremag', 'pornhub', 'xvideos', 'xhamster', 'naughtyamerica',
  'digitalplayground', 'evilangel', 'wankz', 'mofos', 'mofosnetwork',
  'girlsway', 'sweetheartvideo', 'lesbea', 'eroticax',
]



const NSFW_HARD_TERMS = [
  'creampie', 'gangbang', 'gang-bang', 'faciali',
  'cumshot', 'handjob', 'blowjob', 'deepthroat',
  'bdsm', 'bondage', 'dominatrix', 'hentai', 'lolicon',
]

// Soft signals: weighted; sum ≥ 0.6 → isNsfw = 1
const NSFW_SOFT: Array<[string, number, 'word' | 'substr']> = [
  ['hardcore', 0.5, 'word'],
  ['fetish',   0.5, 'word'],
  ['bukk',     0.3, 'word'],
  ['xxx',      0.5, 'substr'],
  ['porn',     0.5, 'word'],
  ['milf',     0.4, 'word'],
  ['threesome',0.3, 'word'],
  ['foursome', 0.3, 'word'],
  ['erotic',   0.3, 'word'],
  ['sensual',  0.2, 'word'],
  ['nude',     0.2, 'word'],
  ['naked',    0.2, 'word'],
  ['sexuelle', 0.2, 'word'],
  ['sexual',   0.2, 'word'],
  ['sex',      0.2, 'word'],
  ['lesbian',  0.2, 'word'],
  ['dick',     0.2, 'word'],
  ['pussy',    0.2, 'word'],
  ['adult',    0.15, 'word'],
]

function scoreNsfw(title: string): 0 | 1 {
  const lower = title.toLowerCase()

  // Hard prefix check
  if (NSFW_HARD_PREFIXES.some((p) => lower.startsWith(p))) return 1

  // Hard studio / term check
  for (const term of [...NSFW_HARD_STUDIOS, ...NSFW_HARD_TERMS]) {
    if (lower.includes(term)) return 1
  }

  // Soft weighted scoring
  let score = 0
  for (const [term, weight, mode] of NSFW_SOFT) {
    if (mode === 'substr') {
      if (lower.includes(term)) score += weight
    } else {
      // word boundary: check for term surrounded by non-alpha chars
      const re = new RegExp(`(?<![a-z])${term}(?![a-z])`, 'i')
      if (re.test(lower)) score += weight
    }
    if (score >= 0.6) return 1
  }

  return 0
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a raw IPTV stream title into structured metadata fields.
 * Single pass — no network calls, purely deterministic.
 *
 * Called at sync INSERT time (replaces inline anyAscii call) and
 * at backfill time for existing rows.
 */
export function parseTitle(raw: string): ParsedTitle {
  let s = raw.trim()
  let mdPrefix: string | null = null

  // 1. Extract prefix — everything before ' - ' if within 14 chars
  const dashIdx = s.indexOf(' - ')
  if (dashIdx > 0 && dashIdx <= 14) {
    mdPrefix = s.slice(0, dashIdx).trim()
    s = s.slice(dashIdx + 3).trim()
  } else {
    // Also handle 'XX: ' colon variant (e.g. "DE: The Last Movie Star")
    const colonMatch = s.match(/^([A-Z]{2,6}):\s+/)
    if (colonMatch) {
      mdPrefix = colonMatch[1]
      s = s.slice(colonMatch[0].length).trim()
    }
  }

  // 2. Extract year — last (YYYY) match validated 1888–2026
  let mdYear: number | null = null
  const yearMatches = [...s.matchAll(/\(([12][0-9]{3})\)/g)]
  for (let i = yearMatches.length - 1; i >= 0; i--) {
    const y = Number(yearMatches[i][1])
    if (y >= 1888 && y <= 2026) {
      mdYear = y
      s = s.slice(0, yearMatches[i].index!).trim() + s.slice(yearMatches[i].index! + yearMatches[i][0].length).trim()
      s = s.trim()
      break
    }
  }

  // 3. Extract quality — keyword scan on original raw title
  let mdQuality: string | null = null
  const rawUpper = raw.toUpperCase()
  const prefixUpper = (mdPrefix ?? '').toUpperCase()
  if (rawUpper.includes('4K') || rawUpper.includes('2160P') || prefixUpper.includes('4K')) {
    mdQuality = '4K'
  } else if (rawUpper.includes('1080P')) {
    mdQuality = '1080p'
  } else if (rawUpper.includes('720P')) {
    mdQuality = '720p'
  } else if (/ HD[^R]/.test(raw.toUpperCase()) || rawUpper.includes('(HD)')) {
    mdQuality = 'HD'
  } else if (rawUpper.includes('BLURAY') || rawUpper.includes('BLU-RAY')) {
    mdQuality = 'BluRay'
  } else if (rawUpper.includes('WEB-DL') || rawUpper.includes('WEBDL')) {
    mdQuality = 'WEB-DL'
  } else if (rawUpper.includes('(LQ)')) {
    mdQuality = 'LQ'
  }

  // 4. Strip trailing bracket noise from clean title (codec tags, country codes, etc.)
  s = s.replace(/\s*\[.*?\]/g, '').trim()  // [UHD], [TR], [MULTI] etc.
  s = s.replace(/\*$/, '').trim()           // trailing asterisk

  // 5. searchTitle = anyAscii + lowercase of clean title
  const searchTitle = normalizeForSearch(s)

  // 6. Map prefix → ISO language
  const mdLanguage = mdPrefix != null
    ? (PREFIX_TO_LANGUAGE[mdPrefix] ?? null)
    : null

  // 7. NSFW score on original raw title
  const isNsfw = scoreNsfw(raw)

  return { searchTitle, mdPrefix, mdLanguage, mdYear, mdQuality, isNsfw }
}
