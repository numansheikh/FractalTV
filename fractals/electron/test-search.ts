/**
 * Exhaustive search test cases — run with:
 *   cd fractals && npx tsx electron/test-search.ts
 *
 * Tests the space-aware FTS query builder logic (no DB required).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const anyAscii: (s: string) => string = require('any-ascii').default ?? require('any-ascii')

function normalizeForSearch(text: string): string {
  if (!text) return ''
  return anyAscii(text).toLowerCase()
}

function buildFtsQuery(rawQuery: string): string | null {
  const query = rawQuery.trim()
  if (!query) return null

  // Quoted mode
  const quotedMatch = rawQuery.match(/^"(.+)"$/)
  if (quotedMatch) {
    const phrase = normalizeForSearch(quotedMatch[1]).replace(/"/g, '""')
    return `{title original_title}: "${phrase}" OR {cast director genres}: "${phrase}"`
  }

  // Space-aware tokenization
  const tokens: { word: string; exact: boolean }[] = []
  const tokenRegex = /(\S+)(\s|$)/g
  let match
  const normalizedRaw = normalizeForSearch(rawQuery)
  while ((match = tokenRegex.exec(normalizedRaw)) !== null) {
    const word = match[1]
    if (!word) continue
    const hasTrailingSpace = match[2] === ' ' || (match.index + match[0].length < normalizedRaw.length)
    tokens.push({ word, exact: hasTrailingSpace })
  }

  if (tokens.length === 0) return null

  const titleParts = tokens.map(t => t.exact ? t.word.replace(/"/g, '""') : `${t.word}*`)
  const titleQuery = tokens.length > 1
    ? `(${titleParts.join(' AND ')})`
    : titleParts[0]
  const exactPhrase = tokens.map(t => t.word.replace(/"/g, '""')).join(' ')
  return `{title original_title}: ${titleQuery} OR {cast director genres}: "${exactPhrase}"`
}

// ── Test cases ──────────────────────────────────────────────────────────────

interface TestCase {
  input: string
  description: string
  expectedFts: string
}

const tests: TestCase[] = [
  // ── Single word, prefix (no trailing space) ─────────────────────────────
  {
    input: 'der',
    description: 'Prefix: "der" → der* (matches Derailed, Der Untergang)',
    expectedFts: '{title original_title}: der* OR {cast director genres}: "der"',
  },
  {
    input: 'dark',
    description: 'Prefix: "dark" → dark* (matches Dark Knight, Darkest Hour)',
    expectedFts: '{title original_title}: dark* OR {cast director genres}: "dark"',
  },
  {
    input: 'cnn',
    description: 'Prefix: "cnn" → cnn* (matches CNN, CNN International)',
    expectedFts: '{title original_title}: cnn* OR {cast director genres}: "cnn"',
  },
  {
    input: 'a',
    description: 'Single char prefix: very broad but valid',
    expectedFts: '{title original_title}: a* OR {cast director genres}: "a"',
  },

  // ── Single word, exact (trailing space) ─────────────────────────────────
  {
    input: 'der ',
    description: 'Exact: "der " → der (only exact token "der", not "Derailed")',
    expectedFts: '{title original_title}: der OR {cast director genres}: "der"',
  },
  {
    input: 'dark ',
    description: 'Exact: "dark " → dark (matches "The Dark" not "Darkest")',
    expectedFts: '{title original_title}: dark OR {cast director genres}: "dark"',
  },
  {
    input: 'cnn ',
    description: 'Exact: "cnn " → cnn (only exact "cnn" tokens)',
    expectedFts: '{title original_title}: cnn OR {cast director genres}: "cnn"',
  },
  {
    input: 'a ',
    description: 'Single char exact: matches token "a" only',
    expectedFts: '{title original_title}: a OR {cast director genres}: "a"',
  },

  // ── Quoted exact match ──────────────────────────────────────────────────
  {
    input: '"der"',
    description: 'Quoted: same as trailing space, exact "der"',
    expectedFts: '{title original_title}: "der" OR {cast director genres}: "der"',
  },
  {
    input: '"dark knight"',
    description: 'Quoted phrase: "dark knight" as exact adjacent tokens',
    expectedFts: '{title original_title}: "dark knight" OR {cast director genres}: "dark knight"',
  },
  {
    input: '"the dark"',
    description: 'Quoted phrase: "the dark" exact',
    expectedFts: '{title original_title}: "the dark" OR {cast director genres}: "the dark"',
  },

  // ── Multi-word, mixed modes ─────────────────────────────────────────────
  {
    input: 'dark kni',
    description: 'Multi mixed: "dark" exact + "kni" prefix',
    expectedFts: '{title original_title}: (dark AND kni*) OR {cast director genres}: "dark kni"',
  },
  {
    input: 'dark knight ',
    description: 'Multi both exact: both words done (trailing space)',
    expectedFts: '{title original_title}: (dark AND knight) OR {cast director genres}: "dark knight"',
  },
  {
    input: 'dark knight ri',
    description: 'Multi: "dark" exact, "knight" exact, "ri" prefix',
    expectedFts: '{title original_title}: (dark AND knight AND ri*) OR {cast director genres}: "dark knight ri"',
  },
  {
    input: 'brad pitt',
    description: 'Multi actor name: "brad" exact + "pitt" prefix (still typing?)',
    expectedFts: '{title original_title}: (brad AND pitt*) OR {cast director genres}: "brad pitt"',
  },
  {
    input: 'brad pitt ',
    description: 'Multi actor name done: both exact',
    expectedFts: '{title original_title}: (brad AND pitt) OR {cast director genres}: "brad pitt"',
  },

  // ── Leading spaces (should be ignored — they're not word boundaries) ────
  {
    input: '  der',
    description: 'Leading spaces: ignored, same as "der" → prefix',
    expectedFts: '{title original_title}: der* OR {cast director genres}: "der"',
  },
  {
    input: '  der ',
    description: 'Leading spaces + trailing space: "der" exact',
    expectedFts: '{title original_title}: der OR {cast director genres}: "der"',
  },
  {
    input: '   dark knight ',
    description: 'Leading spaces + multi exact',
    expectedFts: '{title original_title}: (dark AND knight) OR {cast director genres}: "dark knight"',
  },

  // ── Unicode / diacritics ────────────────────────────────────────────────
  {
    input: 'börgen',
    description: 'Unicode: "börgen" → "borgen" prefix',
    expectedFts: '{title original_title}: borgen* OR {cast director genres}: "borgen"',
  },
  {
    input: 'börgen ',
    description: 'Unicode exact: "börgen " → "borgen" exact',
    expectedFts: '{title original_title}: borgen OR {cast director genres}: "borgen"',
  },
  {
    input: 'müller',
    description: 'Unicode: "müller" → "muller" prefix',
    expectedFts: '{title original_title}: muller* OR {cast director genres}: "muller"',
  },

  // ── Edge cases ──────────────────────────────────────────────────────────
  {
    input: '   ',
    description: 'Only spaces: should return null (no query)',
    expectedFts: '__NULL__',
  },
  {
    input: '',
    description: 'Empty string: should return null',
    expectedFts: '__NULL__',
  },
  {
    input: 'the ',
    description: 'Common word exact: "the " → exact "the"',
    expectedFts: '{title original_title}: the OR {cast director genres}: "the"',
  },
  {
    input: 'the dark ',
    description: 'Multi with common word: both exact',
    expectedFts: '{title original_title}: (the AND dark) OR {cast director genres}: "the dark"',
  },
  {
    input: 'the dark kn',
    description: 'Multi: "the" exact, "dark" exact, "kn" prefix',
    expectedFts: '{title original_title}: (the AND dark AND kn*) OR {cast director genres}: "the dark kn"',
  },
]

// ── Run tests ───────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

console.log('═══════════════════════════════════════════════════════════════')
console.log('  SEARCH TEST SUITE — Space-aware FTS query builder')
console.log('═══════════════════════════════════════════════════════════════\n')

for (const t of tests) {
  const fts = buildFtsQuery(t.input)
  const actual = fts ?? '__NULL__'
  const ok = actual === t.expectedFts

  if (ok) passed++; else failed++

  const icon = ok ? '✓' : '✗'
  const color = ok ? '\x1b[32m' : '\x1b[31m'
  const reset = '\x1b[0m'

  console.log(`${color}${icon}${reset} ${t.description}`)
  console.log(`  Input:    ${JSON.stringify(t.input)}`)
  if (!ok) {
    console.log(`  Got:      ${actual}`)
    console.log(`  Expected: ${t.expectedFts}`)
  } else {
    console.log(`  FTS:      ${actual}`)
  }
  console.log()
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`  ${passed} passed, ${failed} failed, ${tests.length} total`)
console.log('═══════════════════════════════════════════════════════════════')

process.exit(failed > 0 ? 1 : 0)
