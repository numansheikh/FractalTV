import { useState } from 'react'

export type ThemeId =
  | 'dark' | 'vapor' | 'cyborg' | 'superhero' | 'darkly' | 'solar' | 'cerulean-dark'
  | 'fractals-light' | 'light' | 'cerulean' | 'flatly' | 'cosmo' | 'minty' | 'united' | 'lux'

export type FontId =
  | 'DM Sans' | 'Inter' | 'Rubik' | 'IBM Plex Sans' | 'Plus Jakarta Sans' | 'Outfit' | 'Nunito'

export const DARK_THEMES: ThemeId[] = ['dark', 'vapor', 'cyborg', 'superhero', 'darkly', 'solar', 'cerulean-dark']
export const LIGHT_THEMES: ThemeId[] = ['fractals-light', 'light', 'cerulean', 'flatly', 'cosmo', 'minty', 'united', 'lux']

export const THEME_LABELS: Record<ThemeId, string> = {
  dark:           'Fractals Dark',
  vapor:          'Vapor',
  cyborg:         'Cyborg',
  superhero:      'Superhero',
  darkly:         'Darkly',
  solar:          'Solar',
  'cerulean-dark':'Cerulean Dark',
  'fractals-light':'Fractals Light',
  light:          'Light',
  cerulean:       'Cerulean',
  flatly:         'Flatly',
  cosmo:          'Cosmo',
  minty:          'Minty',
  united:         'United',
  lux:            'Lux',
}

// Gradient swatches: [bg-color, accent-color]
export const THEME_SWATCHES: Record<ThemeId, [string, string]> = {
  dark:           ['#0a0a14', '#7c4dff'],
  vapor:          ['#1a0933', '#6f42c1'],
  cyborg:         ['#060606', '#2a9fd6'],
  superhero:      ['#0f2537', '#df6919'],
  darkly:         ['#222222', '#375a7f'],
  solar:          ['#002b36', '#b58900'],
  'cerulean-dark':['#0c1a26', '#2fa4e7'],
  'fractals-light':['#f4f2fa', '#6c3ce0'],
  light:          ['#deeef9', '#2fa4e7'],
  cerulean:       ['#deeef9', '#2fa4e7'],
  flatly:         ['#ecf0f1', '#2c3e50'],
  cosmo:          ['#eaeaea', '#2780e3'],
  minty:          ['#e8f8f4', '#78c2ad'],
  united:         ['#eeeeee', '#e95420'],
  lux:            ['#eeeeee', '#1a1a1a'],
}

export const FONT_LABELS: Record<FontId, string> = {
  'DM Sans':           'DM Sans',
  'Inter':             'Inter',
  'Rubik':             'Rubik',
  'IBM Plex Sans':     'IBM Plex Sans',
  'Plus Jakarta Sans': 'Plus Jakarta Sans',
  'Outfit':            'Outfit',
  'Nunito':            'Nunito',
}

export const FONT_NOTES: Record<FontId, string> = {
  'DM Sans':           'macOS retina · optical sizing',
  'Inter':             'Windows / 1080p · best hinting',
  'Rubik':             'TV / large screen at distance',
  'IBM Plex Sans':     'Technical · sharp on all DPI',
  'Plus Jakarta Sans': 'Strong weights · modern',
  'Outfit':            'Geometric · clean and airy',
  'Nunito':            'Rounded · survives low DPI',
}

const THEME_KEY = 'fractals-theme'
const FONT_KEY  = 'fractals-font'

export function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute('data-theme', theme)
}

export function applyFont(font: FontId) {
  document.documentElement.style.setProperty(
    '--font-sans',
    `"${font}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  )
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    return (localStorage.getItem(THEME_KEY) as ThemeId) ?? 'dark'
  })

  const [font, setFontState] = useState<FontId>(() => {
    return (localStorage.getItem(FONT_KEY) as FontId) ?? 'DM Sans'
  })

  const setTheme = (t: ThemeId) => {
    localStorage.setItem(THEME_KEY, t)
    setThemeState(t)
    applyTheme(t)
  }

  const setFont = (f: FontId) => {
    localStorage.setItem(FONT_KEY, f)
    setFontState(f)
    applyFont(f)
  }

  const isDark = DARK_THEMES.includes(theme)

  return { theme, font, setTheme, setFont, isDark }
}
