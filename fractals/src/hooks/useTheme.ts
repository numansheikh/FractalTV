import { create } from 'zustand'

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

interface ThemeStore {
  theme: ThemeId
  font: FontId
  setTheme: (t: ThemeId) => void
  setFont: (f: FontId) => void
}

const useThemeStore = create<ThemeStore>((set) => ({
  theme: (() => {
    const stored = localStorage.getItem(THEME_KEY) as ThemeId
    return stored === 'dark' || stored === 'fractals-day' ? stored : 'dark'
  })(),
  font: (localStorage.getItem(FONT_KEY) as FontId) ?? 'DM Sans',
  setTheme: (t) => {
    localStorage.setItem(THEME_KEY, t)
    applyTheme(t)
    set({ theme: t })
  },
  setFont: (f) => {
    localStorage.setItem(FONT_KEY, f)
    applyFont(f)
    set({ font: f })
  },
}))

export function useTheme() {
  const { theme, font, setTheme, setFont } = useThemeStore()
  return { theme, font, setTheme, setFont, isDark: theme === 'dark' }
}
