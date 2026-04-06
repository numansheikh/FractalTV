import { useState } from 'react'

export type ThemeId = 'dark' | 'fractals-day'
export type FontId =
  | 'DM Sans' | 'Inter' | 'Rubik' | 'IBM Plex Sans' | 'Plus Jakarta Sans' | 'Outfit' | 'Nunito'

export const DARK_THEMES: ThemeId[] = ['dark']
export const LIGHT_THEMES: ThemeId[] = ['fractals-day']

export const THEME_LABELS: Record<ThemeId, string> = {
  dark:          'Fractals Dark',
  'fractals-day':'Fractals Day',
}

export const THEME_SWATCHES: Record<ThemeId, [string, string]> = {
  dark:          ['#0c0c18', '#7c4dff'],
  'fractals-day':['#fafaff', '#4f46e5'],
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
  const stack = `"${font}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  document.documentElement.style.setProperty('--font-ui', stack)
  document.documentElement.style.setProperty('--font-sans', stack)
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const stored = localStorage.getItem(THEME_KEY) as ThemeId
    return stored === 'dark' || stored === 'fractals-day' ? stored : 'dark'
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

  const isDark = theme === 'dark'

  return { theme, font, setTheme, setFont, isDark }
}
