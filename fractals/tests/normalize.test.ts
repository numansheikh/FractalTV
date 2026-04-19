import { describe, it, expect } from 'vitest'
import { normalizeForSearch } from '../electron/lib/normalize'

describe('normalizeForSearch', () => {
  it('lowercases plain ASCII', () => {
    expect(normalizeForSearch('Breaking Bad')).toBe('breaking bad')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeForSearch('')).toBe('')
  })

  it('folds diacritics — é → e', () => {
    expect(normalizeForSearch('Résistance')).toBe('resistance')
  })

  it('folds diacritics — ü → u', () => {
    expect(normalizeForSearch('Über')).toBe('uber')
  })

  it('folds diacritics — ñ → n', () => {
    expect(normalizeForSearch('España')).toBe('espana')
  })

  it('folds ligature — æ → ae (bidirectional: query "ae" matches stored "æ")', () => {
    expect(normalizeForSearch('Ærø')).toBe('aero')
  })

  it('folds ligature — ß → ss', () => {
    expect(normalizeForSearch('Straße')).toBe('strasse')
  })

  it('folds ligature — œ → oe', () => {
    expect(normalizeForSearch('Œuvre')).toBe('oeuvre')
  })

  it('handles Arabic passthrough (any-ascii best-effort)', () => {
    const result = normalizeForSearch('مرحبا')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles Cyrillic passthrough', () => {
    const result = normalizeForSearch('Москва')
    expect(typeof result).toBe('string')
  })

  it('preserves spaces and numbers', () => {
    expect(normalizeForSearch('Star Wars: Episode IV (1977)')).toBe('star wars: episode iv (1977)')
  })
})
