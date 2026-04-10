import { describe, it, expect } from 'vitest'
import { normalize } from './title-normalizer'

describe('title-normalizer (L14)', () => {
  // ─── Required test cases from L14 rules ────────────────────────────────

  it('bare title with parenthesized year', () => {
    expect(normalize('The Matrix (1999)')).toEqual({
      normalizedTitle: 'the matrix',
      year: 1999,
    })
  })

  it('full stack: language prefix + year + quality', () => {
    expect(normalize('EN - The Matrix (1999) [4K]')).toEqual({
      normalizedTitle: 'the matrix',
      year: 1999,
      languageHint: 'en',
      qualityHint: '4k',
    })
  })

  it('language prefix + trailing origin + quality (no year)', () => {
    expect(normalize('FR - Le Matrice (FR) [HEVC]')).toEqual({
      normalizedTitle: 'le matrice',
      languageHint: 'fr',
      originHint: 'fr',
      qualityHint: 'hevc',
    })
  })

  it('scoped language prefix (AR-IN) + year', () => {
    expect(normalize('AR-IN - The Bengal Files (2025)')).toEqual({
      normalizedTitle: 'the bengal files',
      year: 2025,
      languageHint: 'ar-in',
    })
  })

  it('numeric-only title "1984" is preserved, no year extraction', () => {
    expect(normalize('1984')).toEqual({ normalizedTitle: '1984' })
  })

  it('numeric-only title "300" is preserved', () => {
    expect(normalize('300')).toEqual({ normalizedTitle: '300' })
  })

  it('title starts with numeric token "2001: A Space Odyssey"', () => {
    expect(normalize('2001: A Space Odyssey')).toEqual({
      normalizedTitle: '2001: a space odyssey',
    })
  })

  it('Arabic-only passthrough', () => {
    expect(normalize('المصفوفة')).toEqual({ normalizedTitle: 'المصفوفة' })
  })

  it('hybrid Latin + Arabic title', () => {
    expect(normalize('The Matrix المصفوفة')).toEqual({
      normalizedTitle: 'the matrix المصفوفة',
    })
  })

  it('piped leading language + trailing bare quality', () => {
    expect(normalize('|UK| Sky Sports HD')).toEqual({
      normalizedTitle: 'sky sports',
      languageHint: 'uk',
      qualityHint: 'hd',
    })
  })

  it('FR language + DE origin (plan discussion hypothetical)', () => {
    expect(normalize('FR - My man (DE)')).toEqual({
      normalizedTitle: 'my man',
      languageHint: 'fr',
      originHint: 'de',
    })
  })

  // ─── Additional edge cases ─────────────────────────────────────────────

  it('empty string returns empty normalizedTitle', () => {
    expect(normalize('')).toEqual({ normalizedTitle: '' })
  })

  it('whitespace is collapsed', () => {
    expect(normalize('  The    Matrix   ')).toEqual({ normalizedTitle: 'the matrix' })
  })

  it('European diacritics are folded via any-ascii', () => {
    // Café → cafe, Blåbær → blabaer, Straße → strasse
    expect(normalize('Café')).toEqual({ normalizedTitle: 'cafe' })
    expect(normalize('Straße')).toEqual({ normalizedTitle: 'strasse' })
  })

  it('Cyrillic passes through unchanged (non-Latin)', () => {
    expect(normalize('Матрица')).toEqual({ normalizedTitle: 'матрица' })
  })

  it('CJK passes through unchanged', () => {
    expect(normalize('黒い家')).toEqual({ normalizedTitle: '黒い家' })
  })

  it('Hebrew passes through unchanged', () => {
    expect(normalize('המטריקס')).toEqual({ normalizedTitle: 'המטריקס' })
  })

  it('NFKC normalizes full-width digits and Latin letters', () => {
    // Full-width "The Matrix (1999)" → ASCII
    const raw = '\uFF34\uFF48\uFF45 \uFF2D\uFF41\uFF54\uFF52\uFF49\uFF58 (1999)'
    expect(normalize(raw)).toEqual({ normalizedTitle: 'the matrix', year: 1999 })
  })

  it('square-bracket language prefix', () => {
    expect(normalize('[FR] Le Petit Prince')).toEqual({
      normalizedTitle: 'le petit prince',
      languageHint: 'fr',
    })
  })

  it('multiple trailing tags in mixed order', () => {
    expect(normalize('The Matrix [4K] (1999)')).toEqual({
      normalizedTitle: 'the matrix',
      year: 1999,
      qualityHint: '4k',
    })
  })

  it('trailing bare year after a real title', () => {
    expect(normalize('The Matrix 1999')).toEqual({
      normalizedTitle: 'the matrix',
      year: 1999,
    })
  })

  it('trailing bracketed [MULTI] tag captured as quality', () => {
    expect(normalize('Inception [MULTI]')).toEqual({
      normalizedTitle: 'inception',
      qualityHint: 'multi',
    })
  })

  it('trailing (1080p) captured as quality', () => {
    expect(normalize('Inception (1080p)')).toEqual({
      normalizedTitle: 'inception',
      qualityHint: '1080p',
    })
  })

  it('trailing [US] captured as origin', () => {
    expect(normalize('The Office [US]')).toEqual({
      normalizedTitle: 'the office',
      originHint: 'us',
    })
  })

  it('does not strip number from title body when no leading letter context exists', () => {
    // "1984 (1984)" → year captured once, remainder "1984" preserved
    expect(normalize('1984 (1984)')).toEqual({
      normalizedTitle: '1984',
      year: 1984,
    })
  })

  it('unknown trailing tag is left in the title body', () => {
    // "Inception [XYZ]" — XYZ is not a recognized tag, left in
    // (classifyTag returns null, loop breaks)
    const result = normalize('Inception [XYZ]')
    expect(result.qualityHint).toBeUndefined()
    expect(result.originHint).toBeUndefined()
    expect(result.languageHint).toBeUndefined()
    // Brackets survive (no generic bracket strip in L14)
    expect(result.normalizedTitle).toBe('inception [xyz]')
  })

  it('leading language prefix without matching vocab is left intact', () => {
    // "XX - Foo" where XX is not a known code
    expect(normalize('ZZ - Foo')).toEqual({ normalizedTitle: 'zz - foo' })
  })

  it('combines language prefix + CJK title', () => {
    // Language hint captured, CJK body preserved
    expect(normalize('JA - 黒い家 (2024)')).toEqual({
      normalizedTitle: '黒い家',
      year: 2024,
      languageHint: 'ja',
    })
  })
})
