/**
 * M3U sync worker — V3 cutover (Phase D1.5).
 *
 * Fetches an M3U playlist, parses it, and writes the V3 shape:
 *   - `streams` rows with L14 normalizer outputs
 *   - `canonical_vod` / `canonical_live` identity rows via content_hash
 *   - Per-type FTS mirrors populated inline
 *   - Series-like URLs are reclassified as 'movie' because M3U gives us
 *     individual episode URLs, not a series shell (streams CHECK constraint
 *     bans type='series' — series parents live in `series_sources`, which
 *     requires a Xtream-style hierarchical catalog the M3U format can't
 *     express). Users can still browse them under Films.
 *
 * Wipe semantics: re-sync deletes all streams for this source first.
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { normalize as normalizeTitle } from '../services/title-normalizer'

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

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex')
}
function vodContentHash(normalizedTitle: string, year: number | null): string {
  return sha1(`movie|${normalizedTitle}|${year ?? ''}`)
}
function liveContentHash(tvgId: string | null, normalizedName: string): string {
  if (tvgId && tvgId.trim()) return sha1(`live|tvg|${tvgId.trim().toLowerCase()}`)
  return sha1(`live|name|${normalizedName}`)
}

/** M3U URL guess: /series/ and episode-ish files stay as 'movie' in V3. */
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

/** Stable short hash for M3U URLs (no numeric stream IDs in M3U format). */
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

    // ── Wipe existing streams for this source ───────────────────────────
    db.prepare(`DELETE FROM stream_categories WHERE stream_id IN (SELECT id FROM streams WHERE source_id = ?)`).run(sourceId)
    db.prepare(`DELETE FROM streams WHERE source_id = ?`).run(sourceId)

    // ── Prepared statements (canonical + streams + FTS) ─────────────────
    const insertVodCanonical = db.prepare(`
      INSERT INTO canonical_vod (normalized_title, year, content_hash)
      VALUES (?, ?, ?)
      ON CONFLICT(content_hash) DO UPDATE SET normalized_title = excluded.normalized_title
      RETURNING id
    `)
    const selectVodByHash = db.prepare(`SELECT id FROM canonical_vod WHERE content_hash = ?`)
    const insertLiveCanonical = db.prepare(`
      INSERT INTO canonical_live (canonical_name, content_hash)
      VALUES (?, ?)
      ON CONFLICT(content_hash) DO UPDATE SET canonical_name = excluded.canonical_name
      RETURNING id
    `)
    const selectLiveByHash = db.prepare(`SELECT id FROM canonical_live WHERE content_hash = ?`)
    const insertVodFts = db.prepare(`
      INSERT INTO canonical_vod_fts (canonical_id, normalized_title, multilingual_labels)
      VALUES (?, ?, '')
    `)
    const selectVodFtsByCanonical = db.prepare(`SELECT 1 FROM canonical_vod_fts WHERE canonical_id = ?`)
    const insertLiveFts = db.prepare(`
      INSERT INTO canonical_live_fts (canonical_id, canonical_name, categories)
      VALUES (?, ?, '')
    `)
    const selectLiveFtsByCanonical = db.prepare(`SELECT 1 FROM canonical_live_fts WHERE canonical_id = ?`)

    const insertStreamLive = db.prepare(`
      INSERT INTO streams (
        id, source_id, type, stream_id, title, thumbnail_url, stream_url, category_id,
        tvg_id, epg_channel_id,
        language_hint, origin_hint, quality_hint, year_hint,
        canonical_live_id
      ) VALUES (?, ?, 'live', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertStreamMovie = db.prepare(`
      INSERT INTO streams (
        id, source_id, type, stream_id, title, thumbnail_url, stream_url, category_id,
        language_hint, origin_hint, quality_hint, year_hint,
        canonical_vod_id
      ) VALUES (?, ?, 'movie', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertSC = db.prepare(`INSERT OR IGNORE INTO stream_categories (stream_id, category_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM categories WHERE id = ?)`)

    function upsertVodCanonical(normalizedTitle: string, year: number | null): number {
      const hash = vodContentHash(normalizedTitle, year)
      try {
        const row = insertVodCanonical.get(normalizedTitle, year, hash) as { id: number } | undefined
        if (row?.id) {
          if (!selectVodFtsByCanonical.get(row.id)) insertVodFts.run(row.id, normalizedTitle)
          return row.id
        }
      } catch {}
      const existing = selectVodByHash.get(hash) as { id: number } | undefined
      if (existing?.id) {
        if (!selectVodFtsByCanonical.get(existing.id)) insertVodFts.run(existing.id, normalizedTitle)
        return existing.id
      }
      throw new Error(`Failed to upsert canonical_vod for hash ${hash}`)
    }
    function upsertLiveCanonical(canonicalName: string, tvgId: string | null): number {
      const hash = liveContentHash(tvgId, canonicalName)
      try {
        const row = insertLiveCanonical.get(canonicalName, hash) as { id: number } | undefined
        if (row?.id) {
          if (!selectLiveFtsByCanonical.get(row.id)) insertLiveFts.run(row.id, canonicalName)
          return row.id
        }
      } catch {}
      const existing = selectLiveByHash.get(hash) as { id: number } | undefined
      if (existing?.id) {
        if (!selectLiveFtsByCanonical.get(existing.id)) insertLiveFts.run(existing.id, canonicalName)
        return existing.id
      }
      throw new Error(`Failed to upsert canonical_live for hash ${hash}`)
    }

    // ── Content ──────────────────────────────────────────────────────────
    send('content', 0, entries.length, `Saving ${entries.length.toLocaleString()} items…`)
    const BATCH = 500
    const batchInsert = db.transaction((items: M3uEntry[]) => {
      for (const entry of items) {
        const urlHash = hashUrl(entry.url)
        const streamId = `${sourceId}:${entry.type}:${urlHash}`
        const catKey = `${entry.type}:${entry.groupTitle}`
        const catId = `${sourceId}:${entry.type}:${hashUrl(catKey)}`

        const rawTitle = entry.title || 'Unknown'
        const normalized = normalizeTitle(rawTitle)
        const cleanTitle = normalized.normalizedTitle || rawTitle.toLowerCase()

        if (entry.type === 'live') {
          const tvgId = entry.tvgId || null
          const canonicalLiveId = upsertLiveCanonical(cleanTitle, tvgId)
          insertStreamLive.run(
            streamId, sourceId, urlHash, rawTitle,
            entry.tvgLogo || null, entry.url, null,
            tvgId, tvgId,
            normalized.languageHint || null,
            normalized.originHint || null,
            normalized.qualityHint || null,
            normalized.year || null,
            canonicalLiveId
          )
        } else {
          const canonicalVodId = upsertVodCanonical(cleanTitle, normalized.year ?? null)
          insertStreamMovie.run(
            streamId, sourceId, urlHash, rawTitle,
            entry.tvgLogo || null, entry.url, null,
            normalized.languageHint || null,
            normalized.originHint || null,
            normalized.qualityHint || null,
            normalized.year || null,
            canonicalVodId
          )
        }
        insertSC.run(streamId, catId, catId)
      }
    })

    for (let i = 0; i < entries.length; i += BATCH) {
      batchInsert(entries.slice(i, i + BATCH))
      const done = Math.min(i + BATCH, entries.length)
      send('content', done, entries.length, `Items: ${done.toLocaleString()}/${entries.length.toLocaleString()}`)
    }

    // ── Sweep orphan canonicals ──────────────────────────────────────────
    db.exec(`
      DELETE FROM canonical_vod WHERE id NOT IN (SELECT canonical_vod_id FROM streams WHERE canonical_vod_id IS NOT NULL);
      DELETE FROM canonical_live WHERE id NOT IN (SELECT canonical_live_id FROM streams WHERE canonical_live_id IS NOT NULL);
    `)

    // ── Finalize ─────────────────────────────────────────────────────────
    db.prepare('UPDATE categories SET content_synced = 1 WHERE source_id = ?').run(sourceId)
    const totalItems = (db.prepare('SELECT COUNT(*) as n FROM streams WHERE source_id = ?').get(sourceId) as { n: number }).n

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
