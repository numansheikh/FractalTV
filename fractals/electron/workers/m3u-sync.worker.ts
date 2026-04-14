/**
 * M3U sync worker — g1c tier.
 *
 * Fetches an M3U playlist, parses it, and writes:
 *   - `channels`          — live entries
 *   - `movies`            — VOD entries (M3U has no series hierarchy)
 *   - `channel_categories`/`movie_categories` — per-type category tables
 *
 * Sync populates `search_title` inline via `normalizeForSearch` (any-ascii +
 * lowercase) so LIKE search matches diacritics / ligatures bidirectionally.
 *
 * Sync does NOT preserve user data — per the g1c hard cut, resyncs wipe
 * user_data via CASCADE.
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { normalizeForSearch } from '../lib/normalize'

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
  type: 'live' | 'movie'
}

const { sourceId, dbPath, m3uUrl } = workerData as WorkerData

function send(phase: string, current: number, total: number, message: string) {
  parentPort?.postMessage({ type: 'progress', phase, current, total, message })
}
function sendError(message: string) {
  parentPort?.postMessage({ type: 'error', message })
}
function sendDone(totalItems: number, catCount: number) {
  parentPort?.postMessage({ type: 'done', totalItems, catCount })
}

/** M3U URL guess: /series/ and episode-ish files stay as 'movie' in g1c. */
function guessType(url: string): 'live' | 'movie' {
  if (url.match(/\/series\//i)) return 'movie'
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

/** Stable short hash for M3U URLs. */
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
    // Collect unique groupTitle by type, then write into channel_categories
    // and movie_categories respectively.
    const chanCats = new Map<string, { name: string }>()   // key = groupTitle
    const movieCats = new Map<string, { name: string }>()
    for (const entry of entries) {
      const target = entry.type === 'live' ? chanCats : movieCats
      if (!target.has(entry.groupTitle)) target.set(entry.groupTitle, { name: entry.groupTitle })
    }

    // Wipe existing per-source categories so positions match the new parse.
    db.prepare(`DELETE FROM channel_categories WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM movie_categories   WHERE source_id = ?`).run(sourceId)

    const insertChanCat  = db.prepare(`INSERT INTO channel_categories (id, source_id, external_id, name, position) VALUES (?, ?, ?, ?, ?)`)
    const insertMovieCat = db.prepare(`INSERT INTO movie_categories   (id, source_id, external_id, name, position) VALUES (?, ?, ?, ?, ?)`)

    const writeCats = db.transaction(() => {
      let pos = 0
      for (const [name] of chanCats) {
        const extId = hashUrl(`live:${name}`)
        insertChanCat.run(`${sourceId}:chancat:${extId}`, sourceId, extId, name, pos++)
      }
      pos = 0
      for (const [name] of movieCats) {
        const extId = hashUrl(`movie:${name}`)
        insertMovieCat.run(`${sourceId}:moviecat:${extId}`, sourceId, extId, name, pos++)
      }
    })
    writeCats()

    const catTotal = chanCats.size + movieCats.size
    send('categories', catTotal, catTotal, `${catTotal} categories`)

    // ── Wipe existing content rows for this source ──────────────────────
    db.prepare(`DELETE FROM channels WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM movies   WHERE source_id = ?`).run(sourceId)

    // ── Prepared statements ─────────────────────────────────────────────
    const insertChannel = db.prepare(`
      INSERT INTO channels (
        id, source_id, category_id, external_id, title, search_title,
        thumbnail_url, stream_url, tvg_id, epg_channel_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertMovie = db.prepare(`
      INSERT INTO movies (
        id, source_id, category_id, external_id, title, search_title,
        thumbnail_url, stream_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    // ── Content ──────────────────────────────────────────────────────────
    send('content', 0, entries.length, `Saving ${entries.length.toLocaleString()} items…`)
    const BATCH = 500
    const batchInsert = db.transaction((items: M3uEntry[]) => {
      for (const entry of items) {
        const urlHash = hashUrl(entry.url)
        const cid = `${sourceId}:${entry.type}:${urlHash}`
        const rawTitle = entry.title || 'Unknown'

        if (entry.type === 'live') {
          const catExtId = hashUrl(`live:${entry.groupTitle}`)
          const catId = `${sourceId}:chancat:${catExtId}`
          const tvgId = entry.tvgId || null
          insertChannel.run(
            cid, sourceId, catId, urlHash, rawTitle, normalizeForSearch(rawTitle),
            entry.tvgLogo || null, entry.url, tvgId, tvgId
          )
        } else {
          const catExtId = hashUrl(`movie:${entry.groupTitle}`)
          const catId = `${sourceId}:moviecat:${catExtId}`
          insertMovie.run(
            cid, sourceId, catId, urlHash, rawTitle, normalizeForSearch(rawTitle),
            entry.tvgLogo || null, entry.url
          )
        }
      }
    })

    for (let i = 0; i < entries.length; i += BATCH) {
      batchInsert(entries.slice(i, i + BATCH))
      const done = Math.min(i + BATCH, entries.length)
      send('content', done, entries.length, `Items: ${done.toLocaleString()}/${entries.length.toLocaleString()}`)
    }

    // ── Finalize ─────────────────────────────────────────────────────────
    const chCount = (db.prepare('SELECT COUNT(*) as n FROM channels WHERE source_id = ?').get(sourceId) as { n: number }).n
    const mvCount = (db.prepare('SELECT COUNT(*) as n FROM movies   WHERE source_id = ?').get(sourceId) as { n: number }).n
    const totalItems = chCount + mvCount

    db.prepare(`
      UPDATE sources SET status = 'active', last_sync = unixepoch(), last_error = NULL, item_count = ?
      WHERE id = ?
    `).run(totalItems, sourceId)

    sendDone(totalItems, catTotal)
  } catch (err) {
    db.prepare(`UPDATE sources SET status = 'error', last_error = ? WHERE id = ?`).run(String(err), sourceId)
    sendError(String(err))
  } finally {
    db.close()
  }
}

run()
