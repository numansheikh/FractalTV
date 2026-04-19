import { getSqlite } from '../database/connection'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { parseM3u } from '../lib/m3u-parser'

// Re-export parser types and functions for consumers that import from this file
export { parseM3u, guessType, extractContainerExt } from '../lib/m3u-parser'
export type { M3uEntry, M3uParseResult } from '../lib/m3u-parser'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read M3U content from a URL or local file path */
export async function readM3uContent(m3uUrl: string): Promise<string> {
  if (m3uUrl.startsWith('file://') || (!m3uUrl.startsWith('http://') && !m3uUrl.startsWith('https://'))) {
    const filePath = m3uUrl.startsWith('file://') ? m3uUrl.slice(7) : m3uUrl
    return readFileSync(filePath, 'utf-8')
  }
  const res = await fetch(m3uUrl, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  return res.text()
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const m3uService = {
  async testConnection(m3uUrl: string): Promise<{ count: number; error?: string }> {
    try {
      const text = await readM3uContent(m3uUrl)
      if (!text.includes('#EXTINF')) return { count: 0, error: 'Not a valid M3U playlist (no #EXTINF entries)' }
      const { entries } = parseM3u(text)
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
