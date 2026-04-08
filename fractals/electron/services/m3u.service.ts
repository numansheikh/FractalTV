import { getSqlite } from '../database/connection'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'

// ─── M3U Parser Types ─────────────────────────────────────────────────────────

export interface M3uEntry {
  title: string
  groupTitle: string   // category name
  tvgId?: string       // EPG channel ID
  tvgName?: string
  tvgLogo?: string
  duration: number
  url: string
  type: 'live' | 'movie' | 'series'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read M3U content from a URL or local file path */
async function readM3uContent(m3uUrl: string): Promise<string> {
  if (m3uUrl.startsWith('file://') || (!m3uUrl.startsWith('http://') && !m3uUrl.startsWith('https://'))) {
    // Local file — strip file:// prefix if present
    const filePath = m3uUrl.startsWith('file://') ? m3uUrl.slice(7) : m3uUrl
    return readFileSync(filePath, 'utf-8')
  }
  const res = await fetch(m3uUrl, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  return res.text()
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function guessType(url: string): 'live' | 'movie' | 'series' {
  if (url.match(/\/series\//i)) return 'series'
  if (url.match(/\/movie\//i) || url.match(/\.(mp4|mkv|avi|mov)(\?|$)/i)) return 'movie'
  return 'live'
}

export function parseM3u(text: string): M3uEntry[] {
  const lines = text.split(/\r?\n/)
  const entries: M3uEntry[] = []
  let current: Partial<M3uEntry> | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === '#EXTM3U') continue

    if (trimmed.startsWith('#EXTINF:')) {
      // Parse: #EXTINF:duration key="value" ...,Title
      const commaIdx = trimmed.indexOf(',')
      const title = commaIdx >= 0 ? trimmed.slice(commaIdx + 1).trim() : 'Unknown'
      const meta = commaIdx >= 0 ? trimmed.slice(8, commaIdx) : trimmed.slice(8)

      // Extract duration (first token before space)
      const durMatch = meta.match(/^(-?\d+)/)
      const duration = durMatch ? parseInt(durMatch[1], 10) : -1

      // Extract attributes
      const attrs: Record<string, string> = {}
      const attrRegex = /([\w-]+)="([^"]*)"/g
      let m: RegExpExecArray | null
      while ((m = attrRegex.exec(meta)) !== null) {
        attrs[m[1].toLowerCase()] = m[2]
      }

      current = {
        title,
        groupTitle: attrs['group-title'] || 'Uncategorized',
        tvgId: attrs['tvg-id'] || undefined,
        tvgName: attrs['tvg-name'] || undefined,
        tvgLogo: attrs['tvg-logo'] || undefined,
        duration,
      }
    } else if (trimmed.startsWith('#')) {
      // Skip other directives
      continue
    } else if (current) {
      // This is the URL line
      current.url = trimmed
      current.type = guessType(trimmed)
      entries.push(current as M3uEntry)
      current = null
    }
  }

  return entries
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const m3uService = {
  async testConnection(m3uUrl: string): Promise<{ count: number; error?: string }> {
    try {
      const text = await readM3uContent(m3uUrl)
      if (!text.includes('#EXTINF')) return { count: 0, error: 'Not a valid M3U playlist (no #EXTINF entries)' }
      const entries = parseM3u(text)
      return { count: entries.length }
    } catch (err: any) {
      return { count: 0, error: err.message ?? 'Connection failed' }
    }
  },

  async addSource(name: string, m3uUrl: string): Promise<{ id: string; error?: string }> {
    const sqlite = getSqlite()
    const id = randomUUID()
    try {
      sqlite.prepare(`
        INSERT INTO sources (id, type, name, m3u_url, status)
        VALUES (?, 'm3u', ?, ?, 'active')
      `).run(id, name, m3uUrl)
      return { id }
    } catch (err: any) {
      return { id: '', error: err.message }
    }
  },
}
