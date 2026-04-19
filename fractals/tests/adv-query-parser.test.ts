import { describe, it, expect } from 'vitest'
import { parseAdvQuery, buildAdvWhere } from '../electron/lib/adv-query-parser'

// ─── parseAdvQuery ────────────────────────────────────────────────────────────

describe('parseAdvQuery — year auto-detection', () => {
  it('detects a 4-digit year token', () => {
    const { clauses } = parseAdvQuery('2010')
    expect(clauses).toHaveLength(1)
    expect(clauses[0].column).toBe('md_year')
    expect(clauses[0].value).toBe(2010)
    expect(clauses[0].explicit).toBe(false)
  })

  it('ignores out-of-range year (pre-1888)', () => {
    const { clauses } = parseAdvQuery('1800')
    expect(clauses[0].column).toBeNull()
  })

  it('ignores out-of-range year (post-2030)', () => {
    const { clauses } = parseAdvQuery('2099')
    expect(clauses[0].column).toBeNull()
  })
})

describe('parseAdvQuery — quality auto-detection', () => {
  it('detects 4k', () => {
    const { clauses } = parseAdvQuery('4k')
    expect(clauses[0].column).toBe('md_quality')
    expect(clauses[0].value).toBe('4K')
  })

  it('detects 1080p', () => {
    const { clauses } = parseAdvQuery('1080p')
    expect(clauses[0].column).toBe('md_quality')
    expect(clauses[0].value).toBe('1080p')
  })

  it('detects hd (lowercase)', () => {
    const { clauses } = parseAdvQuery('hd')
    expect(clauses[0].column).toBe('md_quality')
    expect(clauses[0].value).toBe('HD')
  })

  it('detects uhd as 4K alias', () => {
    const { clauses } = parseAdvQuery('uhd')
    expect(clauses[0].column).toBe('md_quality')
    expect(clauses[0].value).toBe('4K')
  })
})

describe('parseAdvQuery — language auto-detection', () => {
  it('detects english (name longer than 2 chars)', () => {
    const { clauses } = parseAdvQuery('english')
    expect(clauses[0].column).toBe('md_language')
    expect(clauses[0].value).toBe('en')
  })

  it('detects arabic (full name)', () => {
    const { clauses } = parseAdvQuery('arabic')
    expect(clauses[0].column).toBe('md_language')
    expect(clauses[0].value).toBe('ar')
  })

  it('does NOT auto-detect 2-letter ISO code to avoid ambiguity (en, no, in)', () => {
    const { clauses } = parseAdvQuery('en')
    // 2-char lower — won't auto-detect as language; may match prefix (EN uppercase)
    expect(clauses[0].column).not.toBe('md_language')
  })
})

describe('parseAdvQuery — prefix auto-detection', () => {
  it('detects uppercase 2-letter prefix (AR)', () => {
    const { clauses } = parseAdvQuery('AR')
    expect(clauses[0].column).toBe('md_prefix')
    expect(clauses[0].value).toBe('AR')
  })

  it('detects NF (platform prefix)', () => {
    const { clauses } = parseAdvQuery('NF')
    expect(clauses[0].column).toBe('md_prefix')
    expect(clauses[0].value).toBe('NF')
  })

  it('does NOT detect lowercase as prefix', () => {
    const { clauses } = parseAdvQuery('ar')
    // lowercase 'ar' — not treated as prefix (prefix requires original uppercase)
    expect(clauses[0].column).not.toBe('md_prefix')
  })
})

describe('parseAdvQuery — explicit field:value syntax', () => {
  it('parses year:2020 as explicit md_year', () => {
    const { clauses } = parseAdvQuery('year:2020')
    expect(clauses[0].column).toBe('md_year')
    expect(clauses[0].value).toBe(2020)
    expect(clauses[0].explicit).toBe(true)
  })

  it('parses lang:ar as explicit md_language', () => {
    const { clauses } = parseAdvQuery('lang:ar')
    expect(clauses[0].column).toBe('md_language')
    expect(clauses[0].value).toBe('ar')
    expect(clauses[0].explicit).toBe(true)
  })

  it('parses quality:4K as explicit md_quality', () => {
    const { clauses } = parseAdvQuery('quality:4K')
    expect(clauses[0].column).toBe('md_quality')
    expect(clauses[0].value).toBe('4K')
    expect(clauses[0].explicit).toBe(true)
  })

  it('parses prefix:EN as explicit md_prefix', () => {
    const { clauses } = parseAdvQuery('prefix:EN')
    expect(clauses[0].column).toBe('md_prefix')
    expect(clauses[0].value).toBe('EN')
    expect(clauses[0].explicit).toBe(true)
  })
})

describe('parseAdvQuery — unrecognized tokens (title fallback)', () => {
  it('falls back unrecognized token to title-only clause', () => {
    const { clauses } = parseAdvQuery('inception')
    expect(clauses[0].column).toBeNull()
    expect(clauses[0].value).toBe('inception')
    expect(clauses[0].explicit).toBe(false)
  })

  it('handles multiple tokens', () => {
    const { clauses } = parseAdvQuery('inception 2010 english')
    expect(clauses).toHaveLength(3)
    expect(clauses.find(c => c.column === 'md_year')?.value).toBe(2010)
    expect(clauses.find(c => c.column === 'md_language')?.value).toBe('en')
    expect(clauses.find(c => c.column === null)?.value).toBe('inception')
  })

  it('handles quoted string as single title token', () => {
    const { clauses } = parseAdvQuery('"breaking bad" 2008')
    expect(clauses).toHaveLength(2)
    expect(clauses[0].column).toBeNull()
    expect(clauses[0].value).toBe('breaking bad')
    expect(clauses[1].column).toBe('md_year')
  })
})

// ─── buildAdvWhere ────────────────────────────────────────────────────────────

describe('buildAdvWhere', () => {
  it('returns null for empty query', () => {
    expect(buildAdvWhere({ clauses: [] }, 'm')).toBeNull()
  })

  it('produces exact match for explicit clause', () => {
    const q = parseAdvQuery('year:2010')
    const result = buildAdvWhere(q, 'm')!
    expect(result.where).toBe('m.md_year = ?')
    expect(result.params).toEqual([2010])
  })

  it('produces OR fallback for auto-detected column', () => {
    const q = parseAdvQuery('english')
    const result = buildAdvWhere(q, 'm')!
    expect(result.where).toContain('m.md_language = ?')
    expect(result.where).toContain('OR')
    expect(result.where).toContain('m.search_title LIKE ?')
    expect(result.params).toContain('en')
    expect(result.params.some(p => typeof p === 'string' && (p as string).includes('%'))).toBe(true)
  })

  it('produces LIKE for title-only clause', () => {
    const q = parseAdvQuery('inception')
    const result = buildAdvWhere(q, 'm')!
    expect(result.where).toBe('m.search_title LIKE ?')
    expect(result.params[0]).toBe('%inception%')
  })

  it('ANDs multiple clauses together', () => {
    const q = parseAdvQuery('inception 2010')
    const result = buildAdvWhere(q, 'm')!
    expect(result.where).toContain(' AND ')
    expect(result.params).toHaveLength(3) // title LIKE + year col + year OR LIKE
  })

  it('uses provided alias in SQL', () => {
    const q = parseAdvQuery('inception')
    const result = buildAdvWhere(q, 'sr')!
    expect(result.where).toContain('sr.search_title')
  })
})
