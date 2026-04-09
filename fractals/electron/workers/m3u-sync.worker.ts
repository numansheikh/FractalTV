/**
 * M3U sync worker — fetches M3U playlist, parses entries, inserts into DB.
 * Writes to v2 schema: canonical + streams + canonical_fts + stream_categories.
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'

interface WorkerData {
  sourceId: string
  dbPath: string
  m3uUrl: string
  sourceName: string
}

interface M3uEntry {
  title: string
  groupTitle: string
  tvgId?: string
  tvgName?: string
  tvgLogo?: string
  duration: number
  url: string
  type: 'live' | 'movie' | 'series'
}

const { sourceId, dbPath, m3uUrl, sourceName } = workerData as WorkerData

function send(phase: string, current: number, total: number, message: string) {
  parentPort?.postMessage({ type: 'progress', phase, current, total, message })
}

function sendError(message: string) {
  parentPort?.postMessage({ type: 'error', message })
}

function sendDone(totalItems: number, catCount: number) {
  parentPort?.postMessage({ type: 'done', totalItems, catCount })
}

function normalize(text: string | null | undefined): string | null {
  if (!text) return null
  return text.toLowerCase().trim()
}

function guessType(url: string): 'live' | 'movie' | 'series' {
  if (url.match(/\/series\//i)) return 'series'
  if (url.match(/\/movie\//i) || url.match(/\.(mp4|mkv|avi|mov)(\?|$)/i)) return 'movie'
  return 'live'
}

function parseM3u(text: string): M3uEntry[] {
  const lines = text.split(/\r?\n/)
  const entries: M3uEntry[] = []
  let current: Partial<M3uEntry> | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === '#EXTM3U') continue

    if (trimmed.startsWith('#EXTINF:')) {
      const commaIdx = trimmed.indexOf(',')
      const title = commaIdx >= 0 ? trimmed.slice(commaIdx + 1).trim() : 'Unknown'
      const meta = commaIdx >= 0 ? trimmed.slice(8, commaIdx) : trimmed.slice(8)

      const durMatch = meta.match(/^(-?\d+)/)
      const duration = durMatch ? parseInt(durMatch[1], 10) : -1

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
      continue
    } else if (current) {
      current.url = trimmed
      current.type = guessType(trimmed)
      entries.push(current as M3uEntry)
      current = null
    }
  }

  return entries
}

/** Generate a stable content ID from URL — M3U entries don't have numeric IDs like Xtream */
function hashUrl(url: string): string {
  return createHash('md5').update(url).digest('hex').slice(0, 12)
}

async function run() {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = normal')
  db.pragma('foreign_keys = ON')

  try {
    db.prepare('UPDATE sources SET status = ? WHERE id = ?').run('syncing', sourceId)

    // ── Fetch M3U ────────────────────────────────────────────────────────
    const isLocal = m3uUrl.startsWith('file://') || (!m3uUrl.startsWith('http://') && !m3uUrl.startsWith('https://'))
    send('fetching', 0, 0, isLocal ? 'Reading file…' : 'Downloading playlist…')

    let text: string
    if (isLocal) {
      const filePath = m3uUrl.startsWith('file://') ? m3uUrl.slice(7) : m3uUrl
      text = readFileSync(filePath, 'utf-8')
    } else {
      const resp = await fetch(m3uUrl, { signal: AbortSignal.timeout(120_000) })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
      text = await resp.text()
    }
    send('fetching', 1, 1, 'Parsing playlist…')

    // ── Parse ────────────────────────────────────────────────────────────
    const entries = parseM3u(text)
    if (entries.length === 0) {
      throw new Error('No valid entries found in M3U playlist')
    }
    send('parsing', entries.length, entries.length, `Found ${entries.length.toLocaleString()} entries`)

    // ── Categories ───────────────────────────────────────────────────────
    const catMap = new Map<string, { name: string; type: string }>()
    for (const entry of entries) {
      const catKey = `${entry.type}:${entry.groupTitle}`
      if (!catMap.has(catKey)) {
        catMap.set(catKey, { name: entry.groupTitle, type: entry.type })
      }
    }

    const insertCat = db.prepare(`
      INSERT INTO categories (id, source_id, external_id, name, type, position)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, position = excluded.position
    `)

    let catPos = 0
    const insertAllCats = db.transaction(() => {
      for (const [catKey, cat] of catMap) {
        const catId = `${sourceId}:${cat.type}:${hashUrl(catKey)}`
        insertCat.run(catId, sourceId, hashUrl(catKey), cat.name, cat.type, catPos++)
      }
    })
    insertAllCats()

    send('categories', catMap.size, catMap.size, `${catMap.size} categories`)

    // ── Content (v2 schema) ─────────────────────────────────────────────
    send('content', 0, entries.length, `Saving ${entries.length.toLocaleString()} items…`)

    const insertCanonical = db.prepare(`
      INSERT INTO canonical (id, type, title, tvg_id, poster_path)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        tvg_id = COALESCE(excluded.tvg_id, canonical.tvg_id),
        poster_path = COALESCE(excluded.poster_path, canonical.poster_path)
    `)
    const insertStream = db.prepare(`
      INSERT INTO streams (id, canonical_id, source_id, type, stream_id, title, category_id, tvg_id, thumbnail_url, stream_url, epg_channel_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_id  = excluded.canonical_id,
        title         = excluded.title,
        category_id   = excluded.category_id,
        tvg_id        = excluded.tvg_id,
        thumbnail_url = excluded.thumbnail_url,
        stream_url    = excluded.stream_url,
        epg_channel_id = excluded.epg_channel_id
    `)
    const insertFts = db.prepare(`INSERT OR REPLACE INTO canonical_fts (canonical_id, title) VALUES (?, ?)`)
    const insertSC = db.prepare(`INSERT OR IGNORE INTO stream_categories (stream_id, category_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM categories WHERE id = ?)`)

    const BATCH = 500
    const batchInsert = db.transaction((items: M3uEntry[]) => {
      for (const entry of items) {
        const urlHash = hashUrl(entry.url)
        const streamId = `${sourceId}:${entry.type}:${urlHash}`
        const catKey = `${entry.type}:${entry.groupTitle}`
        const catId = `${sourceId}:${entry.type}:${hashUrl(catKey)}`

        // Canonical ID: channels use tvg_id for dedup, others use anon prefix
        const canonicalType = entry.type === 'live' ? 'channel' : entry.type
        const canonicalId = entry.type === 'live' && entry.tvgId
          ? `ch:${entry.tvgId}`
          : `anon:${canonicalType}:${sourceId}:${urlHash}`

        insertCanonical.run(canonicalId, canonicalType, entry.title, entry.tvgId || null, entry.tvgLogo || null)
        insertStream.run(
          streamId, canonicalId, sourceId, entry.type, urlHash,
          entry.title, null, entry.tvgId || null,
          entry.tvgLogo || null, entry.url, entry.tvgId || null,
        )
        insertFts.run(canonicalId, normalize(entry.title))
        insertSC.run(streamId, catId, catId)
      }
    })

    for (let i = 0; i < entries.length; i += BATCH) {
      batchInsert(entries.slice(i, i + BATCH))
      const done = Math.min(i + BATCH, entries.length)
      send('content', done, entries.length, `Items: ${done.toLocaleString()}/${entries.length.toLocaleString()}`)
    }

    // ── Finalize ─────────────────────────────────────────────────────────
    db.prepare('UPDATE categories SET content_synced = 1 WHERE source_id = ?').run(sourceId)
    const totalItems = (db.prepare('SELECT COUNT(*) as n FROM streams WHERE source_id = ?').get(sourceId) as any).n

    db.prepare(`
      UPDATE sources SET status = 'active', last_sync = unixepoch(), last_error = NULL, item_count = ?
      WHERE id = ?
    `).run(totalItems, sourceId)

    sendDone(totalItems, catMap.size)
  } catch (err) {
    db.prepare(`UPDATE sources SET status = 'error', last_error = ? WHERE id = ?`).run(String(err), sourceId)
    sendError(String(err))
  } finally {
    db.close()
  }
}

run()
