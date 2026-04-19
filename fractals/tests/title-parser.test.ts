import { describe, it, expect } from 'vitest'
import { parseTitle, parseSeriesTitle } from '../electron/lib/title-parser'

// ─── parseTitle ───────────────────────────────────────────────────────────────

describe('parseTitle — prefix extraction', () => {
  it('extracts two-letter language prefix before " - "', () => {
    const r = parseTitle('EN - The Dark Knight')
    expect(r.mdPrefix).toBe('EN')
    expect(r.mdLanguage).toBe('en')
    expect(r.searchTitle).toBe('the dark knight')
  })

  it('extracts compound prefix (AR-SUBS)', () => {
    const r = parseTitle('AR-SUBS - Interstellar')
    expect(r.mdPrefix).toBe('AR-SUBS')
    expect(r.mdLanguage).toBe('ar')
  })

  it('extracts platform prefix with null language (NF)', () => {
    const r = parseTitle('NF - Stranger Things')
    expect(r.mdPrefix).toBe('NF')
    expect(r.mdLanguage).toBeNull()
  })

  it('extracts colon-variant prefix (DE: )', () => {
    const r = parseTitle('DE: The Last Movie Star')
    expect(r.mdPrefix).toBe('DE')
    expect(r.mdLanguage).toBe('de')
    expect(r.searchTitle).toBe('the last movie star')
  })

  it('ignores prefix when dash is beyond 14 chars', () => {
    const r = parseTitle('VERY LONG PREFIX HERE - Movie Title')
    expect(r.mdPrefix).toBeNull()
  })

  it('returns null prefix for plain title', () => {
    const r = parseTitle('The Matrix')
    expect(r.mdPrefix).toBeNull()
    expect(r.mdLanguage).toBeNull()
  })
})

describe('parseTitle — year extraction', () => {
  it('extracts year from (YYYY)', () => {
    const r = parseTitle('Inception (2010)')
    expect(r.mdYear).toBe(2010)
    expect(r.searchTitle).toBe('inception')
  })

  it('extracts last valid year when multiple present', () => {
    const r = parseTitle('Show (1999) Season (2005)')
    expect(r.mdYear).toBe(2005)
  })

  it('ignores out-of-range year (pre-1888)', () => {
    const r = parseTitle('Old Film (1800)')
    expect(r.mdYear).toBeNull()
  })

  it('ignores out-of-range year (post-2026)', () => {
    const r = parseTitle('Future Film (2099)')
    expect(r.mdYear).toBeNull()
  })

  it('returns null year when none present', () => {
    expect(parseTitle('The Matrix').mdYear).toBeNull()
  })
})

describe('parseTitle — quality extraction', () => {
  it('detects 4K', () => {
    expect(parseTitle('Movie 4K').mdQuality).toBe('4K')
  })

  it('detects 4K from prefix', () => {
    expect(parseTitle('4K-D+ - Movie Title').mdQuality).toBe('4K')
  })

  it('detects 1080p', () => {
    expect(parseTitle('Movie 1080p').mdQuality).toBe('1080p')
  })

  it('detects 720p', () => {
    expect(parseTitle('Movie 720p').mdQuality).toBe('720p')
  })

  it('detects HD (standalone)', () => {
    expect(parseTitle('Movie HD Channel').mdQuality).toBe('HD')
  })

  it('detects BluRay', () => {
    expect(parseTitle('Movie BluRay').mdQuality).toBe('BluRay')
  })

  it('detects WEB-DL', () => {
    expect(parseTitle('Movie WEB-DL').mdQuality).toBe('WEB-DL')
  })

  it('detects LQ', () => {
    expect(parseTitle('Movie (LQ)').mdQuality).toBe('LQ')
  })

  it('returns null for no quality signal', () => {
    expect(parseTitle('The Godfather (1972)').mdQuality).toBeNull()
  })
})

describe('parseTitle — bracket noise stripping', () => {
  it('strips [UHD] bracket tags from clean title', () => {
    const r = parseTitle('Movie Title [UHD]')
    expect(r.searchTitle).toBe('movie title')
  })

  it('strips trailing asterisk', () => {
    const r = parseTitle('Movie Title*')
    expect(r.searchTitle).toBe('movie title')
  })
})

describe('parseTitle — NSFW scoring', () => {
  it('marks [XXX] prefix as NSFW', () => {
    expect(parseTitle('[xxx] Adult Film').isNsfw).toBe(1)
  })

  it('marks hard studio name as NSFW', () => {
    expect(parseTitle('Brazzers Presents Something').isNsfw).toBe(1)
  })

  it('marks hard term (blowjob) as NSFW', () => {
    expect(parseTitle('Blowjob Scene').isNsfw).toBe(1)
  })

  it('marks accumulated soft signals as NSFW (hardcore + xxx)', () => {
    expect(parseTitle('Hardcore xxx video').isNsfw).toBe(1)
  })

  it('does not mark innocent title as NSFW', () => {
    expect(parseTitle('Sex Education (2019)').isNsfw).toBe(0)
  })

  it('does not mark "lesbian" alone (0.2 < 0.6 threshold)', () => {
    expect(parseTitle('Lesbian Vampire Killers').isNsfw).toBe(0)
  })
})

describe('parseTitle — searchTitle', () => {
  it('normalizes title through anyAscii + lowercase', () => {
    const r = parseTitle('FR - Résistance (2020)')
    expect(r.searchTitle).toBe('resistance')
  })

  it('extracts all fields from a combined title', () => {
    const r = parseTitle('EN - Interstellar (2014) 4K [UHD]')
    expect(r.mdPrefix).toBe('EN')
    expect(r.mdYear).toBe(2014)
    expect(r.mdQuality).toBe('4K')
    // Quality tokens are NOT stripped from the search title (captured in mdQuality instead).
    // Year extraction trims adjacent whitespace, so "Interstellar (2014) 4K" → "interstellar4k".
    expect(r.searchTitle).toBe('interstellar4k')
  })
})

// ─── parseSeriesTitle ─────────────────────────────────────────────────────────

describe('parseSeriesTitle — S##E## patterns', () => {
  it('parses S01E08', () => {
    const r = parseSeriesTitle('Breaking Bad S01E08')
    expect(r.season).toBe(1)
    expect(r.episode).toBe(8)
    expect(r.isSeries).toBe(true)
    expect(r.baseTitle).toBe('Breaking Bad')
  })

  it('parses S01 E08 with space', () => {
    const r = parseSeriesTitle('Breaking Bad (2008) S01 E08')
    expect(r.season).toBe(1)
    expect(r.episode).toBe(8)
    expect(r.year).toBe(2008)
    expect(r.isSeries).toBe(true)
  })

  it('parses lowercase s1e8', () => {
    const r = parseSeriesTitle('The Show s1e8')
    expect(r.season).toBe(1)
    expect(r.episode).toBe(8)
    expect(r.isSeries).toBe(true)
  })

  it('parses Season N Episode M verbose form', () => {
    const r = parseSeriesTitle('The Wire Season 2 Episode 5')
    expect(r.season).toBe(2)
    expect(r.episode).toBe(5)
    expect(r.isSeries).toBe(true)
  })

  it('parses 1x08 cross format', () => {
    const r = parseSeriesTitle('Show 1x08')
    expect(r.season).toBe(1)
    expect(r.episode).toBe(8)
    expect(r.isSeries).toBe(true)
  })

  it('parses S01 only (no episode number)', () => {
    const r = parseSeriesTitle('Show S02')
    expect(r.season).toBe(2)
    expect(r.episode).toBeNull()
    expect(r.isSeries).toBe(true)
  })

  it('returns isSeries=false for plain movie title', () => {
    const r = parseSeriesTitle('The Matrix (1999)')
    expect(r.isSeries).toBe(false)
    expect(r.season).toBeNull()
    expect(r.episode).toBeNull()
    expect(r.year).toBe(1999)
    expect(r.baseTitle).toBe('The Matrix')
  })

  it('strips prefix before detecting S/E', () => {
    const r = parseSeriesTitle('EN - Breaking Bad S03E07')
    expect(r.season).toBe(3)
    expect(r.episode).toBe(7)
    expect(r.baseTitle).toBe('Breaking Bad')
  })
})
