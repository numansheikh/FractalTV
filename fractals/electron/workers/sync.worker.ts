/**
 * Sync worker — runs Xtream API fetch + DB inserts off the main thread.
 * Receives source info via workerData, sends progress via parentPort.
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

interface WorkerData {
  sourceId: string
  dbPath: string
  serverUrl: string
  username: string
  password: string
  sourceName: string
}

const { sourceId, dbPath, serverUrl, username, password, sourceName } = workerData as WorkerData

function send(phase: string, current: number, total: number, message: string) {
  parentPort?.postMessage({ type: 'progress', phase, current, total, message })
}

function sendError(message: string) {
  parentPort?.postMessage({ type: 'error', message })
}

function sendDone(totalItems: number, catCount: number) {
  parentPort?.postMessage({ type: 'done', totalItems, catCount })
}

// Simple text normalization (lowercase + trim). The main process will rebuild FTS with proper anyAscii later if needed.
function normalize(text: string | null | undefined): string | null {
  if (!text) return null
  return text.toLowerCase().trim()
}

async function fetchJson<T>(url: string, timeout: number, label: string): Promise<T> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    if (!resp.ok) {
      console.error(`[SyncWorker] ${label}: HTTP ${resp.status} ${resp.statusText}`)
      return [] as unknown as T
    }
    const data = await resp.json()
    const count = Array.isArray(data) ? data.length : '?'
    console.log(`[SyncWorker] ${label}: fetched ${count} items`)
    return data as T
  } catch (err) {
    console.error(`[SyncWorker] ${label}: fetch failed —`, err)
    return [] as unknown as T
  }
}

async function run() {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = normal')
  db.pragma('foreign_keys = ON')

  try {
    const base = serverUrl.replace(/\/$/, '')
    const apiBase = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
    const FETCH_TIMEOUT = 180_000 // 3 minutes for huge lists

    // Mark as syncing
    db.prepare('UPDATE sources SET status = ? WHERE id = ?').run('syncing', sourceId)

    // ── Categories ────────────────────────────────────────────────────────
    send('categories', 0, 3, 'Fetching categories...')

    const [liveCats, vodCats, seriesCats] = await Promise.all([
      fetchJson<any[]>(`${apiBase}&action=get_live_categories`, 15_000, 'live_categories'),
      fetchJson<any[]>(`${apiBase}&action=get_vod_categories`, 15_000, 'vod_categories'),
      fetchJson<any[]>(`${apiBase}&action=get_series_categories`, 15_000, 'series_categories'),
    ])

    const insertCat = db.prepare(`
      INSERT INTO categories (id, source_id, external_id, name, type, position)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, position = excluded.position
    `)
    const insertAllCats = db.transaction((cats: any[], type: string) => {
      for (let i = 0; i < cats.length; i++) {
        const cat = cats[i]
        insertCat.run(`${sourceId}:${type}:${cat.category_id}`, sourceId, cat.category_id, cat.category_name, type, i)
      }
    })
    insertAllCats(liveCats || [], 'live')
    insertAllCats(vodCats || [], 'movie')
    insertAllCats(seriesCats || [], 'series')

    const catCount = (liveCats?.length ?? 0) + (vodCats?.length ?? 0) + (seriesCats?.length ?? 0)

    // ── Live streams ──────────────────────────────────────────────────────
    send('live', 0, 0, 'Fetching live streams…')
    const liveStreams: any[] = await fetchJson(`${apiBase}&action=get_live_streams`, FETCH_TIMEOUT, 'live_streams')

    const insertLive = db.prepare(`
      INSERT OR REPLACE INTO content (id, primary_source_id, external_id, type, title, category_id, poster_url, catchup_supported, catchup_days, updated_at)
      VALUES (?, ?, ?, 'live', ?, ?, ?, ?, ?, unixepoch())
    `)
    const insertSource = db.prepare(`
      INSERT OR REPLACE INTO content_sources (id, content_id, source_id, external_id, quality)
      VALUES (?, ?, ?, ?, 'HD')
    `)
    const insertFts = db.prepare(`INSERT OR REPLACE INTO content_fts (content_id, title) VALUES (?, ?)`)
    const insertCC = db.prepare(`INSERT OR IGNORE INTO content_categories (content_id, category_id) VALUES (?, ?)`)

    const BATCH = 500
    const batchLive = db.transaction((items: any[]) => {
      for (const s of items) {
        const cid = `${sourceId}:live:${s.stream_id}`
        insertLive.run(cid, sourceId, String(s.stream_id), s.name, s.category_id || null, s.stream_icon || null, s.tv_archive ? 1 : 0, s.tv_archive_duration || 0)
        insertSource.run(cid, cid, sourceId, String(s.stream_id))
        insertFts.run(cid, normalize(s.name))
        if (s.category_id) insertCC.run(cid, `${sourceId}:live:${s.category_id}`)
      }
    })
    for (let i = 0; i < (liveStreams?.length ?? 0); i += BATCH) {
      batchLive((liveStreams || []).slice(i, i + BATCH))
      send('live', Math.min(i + BATCH, liveStreams.length), liveStreams.length, `Channels: ${Math.min(i + BATCH, liveStreams.length)}/${liveStreams.length}`)
    }

    // ── VOD streams ───────────────────────────────────────────────────────
    send('movies', 0, 0, 'Fetching movies…')
    const vodStreams: any[] = await fetchJson(`${apiBase}&action=get_vod_streams`, FETCH_TIMEOUT, 'vod_streams')

    const insertVod = db.prepare(`
      INSERT OR REPLACE INTO content (id, primary_source_id, external_id, type, title, category_id, poster_url, rating_tmdb, container_extension, updated_at)
      VALUES (?, ?, ?, 'movie', ?, ?, ?, ?, ?, unixepoch())
    `)
    const insertVodSource = db.prepare(`INSERT OR REPLACE INTO content_sources (id, content_id, source_id, external_id) VALUES (?, ?, ?, ?)`)

    const batchVod = db.transaction((items: any[]) => {
      for (const s of items) {
        const cid = `${sourceId}:movie:${s.stream_id}`
        insertVod.run(cid, sourceId, String(s.stream_id), s.name, s.category_id || null, s.stream_icon || null, s.rating_5based ? s.rating_5based * 2 : null, s.container_extension || null)
        insertVodSource.run(cid, cid, sourceId, String(s.stream_id))
        insertFts.run(cid, normalize(s.name))
        if (s.category_id) insertCC.run(cid, `${sourceId}:movie:${s.category_id}`)
      }
    })
    for (let i = 0; i < (vodStreams?.length ?? 0); i += BATCH) {
      batchVod((vodStreams || []).slice(i, i + BATCH))
      send('movies', Math.min(i + BATCH, vodStreams.length), vodStreams.length, `Movies: ${Math.min(i + BATCH, vodStreams.length)}/${vodStreams.length}`)
    }

    // ── Series ────────────────────────────────────────────────────────────
    send('series', 0, 0, 'Fetching series…')
    const seriesList: any[] = await fetchJson(`${apiBase}&action=get_series`, FETCH_TIMEOUT, 'series')

    const insertSeries = db.prepare(`
      INSERT OR REPLACE INTO content (id, primary_source_id, external_id, type, title, category_id, poster_url, plot, director, cast, rating_tmdb, updated_at)
      VALUES (?, ?, ?, 'series', ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `)
    const insertFtsSeries = db.prepare(`INSERT OR REPLACE INTO content_fts (content_id, title, plot, cast, director) VALUES (?, ?, ?, ?, ?)`)

    const batchSeries = db.transaction((items: any[]) => {
      for (const s of items) {
        const cid = `${sourceId}:series:${s.series_id}`
        insertSeries.run(cid, sourceId, String(s.series_id), s.name, s.category_id || null, s.cover || null, s.plot || null, s.director || null, s.cast || null, s.rating_5based ? s.rating_5based * 2 : null)
        insertVodSource.run(cid, cid, sourceId, String(s.series_id))
        insertFtsSeries.run(cid, normalize(s.name), normalize(s.plot), normalize(s.cast), normalize(s.director))
        if (s.category_id) insertCC.run(cid, `${sourceId}:series:${s.category_id}`)
      }
    })
    for (let i = 0; i < (seriesList?.length ?? 0); i += BATCH) {
      batchSeries((seriesList || []).slice(i, i + BATCH))
      send('series', Math.min(i + BATCH, seriesList.length), seriesList.length, `Series: ${Math.min(i + BATCH, seriesList.length)}/${seriesList.length}`)
    }

    // ── Save dumps (categories only — content too large) ──────────────────
    try {
      const dumpDir = join(homedir(), '.fractals', 'sync-dumps', `${sourceName.replace(/[^a-zA-Z0-9]/g, '_')}_${sourceId.slice(0, 8)}`)
      mkdirSync(dumpDir, { recursive: true })
      writeFileSync(join(dumpDir, 'live_categories.json'), JSON.stringify(liveCats, null, 2))
      writeFileSync(join(dumpDir, 'vod_categories.json'), JSON.stringify(vodCats, null, 2))
      writeFileSync(join(dumpDir, 'series_categories.json'), JSON.stringify(seriesCats, null, 2))
      const writeSample = (name: string, data: any[]) => {
        writeFileSync(join(dumpDir, name), JSON.stringify({ total: data?.length ?? 0, sample: (data || []).slice(0, 5) }, null, 2))
      }
      writeSample('live_streams.json', liveStreams)
      writeSample('vod_streams.json', vodStreams)
      writeSample('series_list.json', seriesList)
    } catch {}

    // ── Finalize ──────────────────────────────────────────────────────────
    db.prepare('UPDATE categories SET content_synced = 1 WHERE source_id = ?').run(sourceId)
    const totalItems = (db.prepare('SELECT COUNT(*) as n FROM content WHERE primary_source_id = ?').get(sourceId) as any).n

    db.prepare(`
      UPDATE sources SET status = 'active', last_sync = unixepoch(), last_error = NULL, item_count = ?
      WHERE id = ?
    `).run(totalItems, sourceId)

    sendDone(totalItems, catCount)
  } catch (err) {
    db.prepare(`UPDATE sources SET status = 'error', last_error = ? WHERE id = ?`).run(String(err), sourceId)
    sendError(String(err))
  } finally {
    db.close()
  }
}

run()
