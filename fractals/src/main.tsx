import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import { App } from '@/App'
import { applyTheme, applyFont, type ThemeId, type FontId } from '@/hooks/useTheme'

// Apply saved theme + font before first render to avoid flash
const savedTheme = localStorage.getItem('fractals-theme') as ThemeId | null
applyTheme(savedTheme ?? 'dark')

const savedFont = localStorage.getItem('fractals-font') as FontId | null
if (savedFont) applyFont(savedFont)

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
