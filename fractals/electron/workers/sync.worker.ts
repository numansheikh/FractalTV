/**
 * Sync worker — g1c tier.
 *
 * Fetches Xtream catalog for a single source and writes split content tables:
 *   - Live   → `channel_categories` + `channels`
 *   - Movies → `movie_categories`   + `movies`
 *   - Series → `series_categories`  + `series`   (episodes lazy-fetched on demand)
 *
 * Sync populates `search_title` inline via `normalizeForSearch` (any-ascii +
 * lowercase) so LIKE search matches diacritics / ligatures bidirectionally
 * (æ↔ae, é↔e, ß↔ss) with no separate Index step required.
 *
 * Sync does NOT preserve user data — per the g1c hard cut, resyncs wipe
 * user_data via CASCADE (users re-sync from providers after schema transition).
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { normalizeForSearch } from '../lib/normalize'

interface WorkerData {
  sourceId: string
  dbPath: string
  serverUrl: string
  username: string
  password: string
  sourceName: string
}

const { sourceId, dbPath, serverUrl, username, password } = workerData as WorkerData

function send(phase: string, current: number, total: number, message: string) {
  parentPort?.postMessage({ type: 'progress', phase, current, total, message })
}
function sendError(message: string) {
  parentPort?.postMessage({ type: 'error', message })
}
function sendWarning(message: string) {
  parentPort?.postMessage({ type: 'warning', message })
}
function sendDone(totalItems: number, catCount: number) {
  parentPort?.postMessage({ type: 'done', totalItems, catCount })
}

async function fetchJson<T>(url: string, timeout: number, label: string): Promise<{ data: T; error: boolean }> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    if (!resp.ok) {
      console.error(`[SyncWorker] ${label}: HTTP ${resp.status} ${resp.statusText}`)
      return { data: [] as unknown as T, error: true }
    }
    const data = await resp.json()
    const count = Array.isArray(data) ? data.length : '?'
    console.log(`[SyncWorker] ${label}: fetched ${count} items`)
    return { data: data as T, error: false }
  } catch (err) {
    console.error(`[SyncWorker] ${label}: fetch failed —`, err)
    return { data: [] as unknown as T, error: true }
  }
}

async function run() {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = normal')
  db.pragma('foreign_keys = ON')

  const sourceExistsStmt = db.prepare('SELECT 1 FROM sources WHERE id = ?')
  const sourceExists = (): boolean => !!sourceExistsStmt.get(sourceId)

  try {
    const base = serverUrl.replace(/\/$/, '')
    const apiBase = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
    const FETCH_TIMEOUT = 180_000

    db.prepare('UPDATE sources SET status = ? WHERE id = ?').run('syncing', sourceId)

    // ── Categories ─────────────────────────────────────────────────────────
    if (!sourceExists()) { sendDone(0, 0); db.close(); return }
    send('categories', 0, 3, 'Fetching categories...')

    const [liveCatsResult, vodCatsResult, seriesCatsResult] = await Promise.all([
      fetchJson<any[]>(`${apiBase}&action=get_live_categories`, 15_000, 'live_categories'),
      fetchJson<any[]>(`${apiBase}&action=get_vod_categories`, 15_000, 'vod_categories'),
      fetchJson<any[]>(`${apiBase}&action=get_series_categories`, 15_000, 'series_categories'),
    ])
    const liveCats = liveCatsResult.data || []
    const vodCats = vodCatsResult.data || []
    const seriesCats = seriesCatsResult.data || []

    // Wipe + repopulate per-type category tables for this source.
    // Content tables are wiped below — this happens first so FK SET NULL is
    // a no-op for now-absent rows.
    db.prepare(`DELETE FROM channel_categories WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM movie_categories   WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM series_categories  WHERE source_id = ?`).run(sourceId)

    const insertChanCat   = db.prepare(`INSERT INTO channel_categories (id, source_id, external_id, name, position) VALUES (?, ?, ?, ?, ?)`)
    const insertMovieCat  = db.prepare(`INSERT INTO movie_categories   (id, source_id, external_id, name, position) VALUES (?, ?, ?, ?, ?)`)
    const insertSeriesCat = db.prepare(`INSERT INTO series_categories  (id, source_id, external_id, name, position) VALUES (?, ?, ?, ?, ?)`)

    const insertLiveCats = db.transaction((cats: any[]) => {
      for (let i = 0; i < cats.length; i++) {
        const cat = cats[i]
        insertChanCat.run(`${sourceId}:chancat:${cat.category_id}`, sourceId, String(cat.category_id), cat.category_name, i)
      }
    })
    const insertMovieCats = db.transaction((cats: any[]) => {
      for (let i = 0; i < cats.length; i++) {
        const cat = cats[i]
        insertMovieCat.run(`${sourceId}:moviecat:${cat.category_id}`, sourceId, String(cat.category_id), cat.category_name, i)
      }
    })
    const insertSeriesCats = db.transaction((cats: any[]) => {
      for (let i = 0; i < cats.length; i++) {
        const cat = cats[i]
        insertSeriesCat.run(`${sourceId}:seriescat:${cat.category_id}`, sourceId, String(cat.category_id), cat.category_name, i)
      }
    })
    insertLiveCats(liveCats)
    insertMovieCats(vodCats)
    insertSeriesCats(seriesCats)

    // Providers sometimes return streams referencing category_ids absent from
    // the categories list. Track what we actually inserted so we can null out
    // unknown refs rather than hit a FK violation.
    const liveCatIds   = new Set(liveCats.map(c => `${sourceId}:chancat:${c.category_id}`))
    const movieCatIds  = new Set(vodCats.map(c => `${sourceId}:moviecat:${c.category_id}`))
    const seriesCatIds = new Set(seriesCats.map(c => `${sourceId}:seriescat:${c.category_id}`))

    const catCount = liveCats.length + vodCats.length + seriesCats.length
    send('categories', catCount, catCount, `${catCount} categories`)

    // ── Wipe existing content rows for this source ─────────────────────────
    // CASCADE on content rows wipes user_data — acceptable under the g1c hard cut.
    db.prepare(`DELETE FROM channels WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM movies   WHERE source_id = ?`).run(sourceId)
    // Episodes CASCADE via series.id → series_id
    db.prepare(`DELETE FROM series   WHERE source_id = ?`).run(sourceId)

    // ── Prepared statements ────────────────────────────────────────────────

    const insertChannel = db.prepare(`
      INSERT INTO channels (
        id, source_id, category_id, external_id, title, search_title,
        thumbnail_url, tvg_id, epg_channel_id,
        catchup_supported, catchup_days
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMovie = db.prepare(`
      INSERT INTO movies (
        id, source_id, category_id, external_id, title, search_title,
        thumbnail_url, container_extension
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertSeries = db.prepare(`
      INSERT INTO series (
        id, source_id, category_id, external_id, title, search_title,
        thumbnail_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    // ── Live channels ──────────────────────────────────────────────────────
    send('live', 0, 0, 'Fetching channels…')
    const liveResult = await fetchJson<any[]>(`${apiBase}&action=get_live_streams`, FETCH_TIMEOUT, 'live_streams')
    const liveStreams = liveResult.data || []
    if (liveResult.error) sendWarning('Failed to fetch live channels — timed out or server error')
    send('live', 0, liveStreams.length, `Saving ${liveStreams.length.toLocaleString()} channels…`)

    if (!sourceExists()) { sendDone(0, 0); db.close(); return }

    const BATCH = 500
    const batchLive = db.transaction((items: any[]) => {
      for (const s of items) {
        const cid = `${sourceId}:live:${s.stream_id}`
        const rawTitle: string = s.name || `Channel ${s.stream_id}`
        const tvgId: string | null = s.epg_channel_id || null
        const rawCatId = s.category_id ? `${sourceId}:chancat:${s.category_id}` : null
        const catId = rawCatId && liveCatIds.has(rawCatId) ? rawCatId : null

        insertChannel.run(
          cid, sourceId, catId, String(s.stream_id), rawTitle, normalizeForSearch(rawTitle),
          s.stream_icon || null, tvgId, tvgId,
          s.tv_archive ? 1 : 0, s.tv_archive_duration || 0
        )
      }
    })
    for (let i = 0; i < liveStreams.length; i += BATCH) {
      batchLive(liveStreams.slice(i, i + BATCH))
      send('live', Math.min(i + BATCH, liveStreams.length), liveStreams.length, `Channels: ${Math.min(i + BATCH, liveStreams.length)}/${liveStreams.length}`)
    }

    // ── Movies (VOD) ───────────────────────────────────────────────────────
    send('movies', 0, 0, 'Fetching movies…')
    const vodResult = await fetchJson<any[]>(`${apiBase}&action=get_vod_streams`, FETCH_TIMEOUT, 'vod_streams')
    const vodStreams = vodResult.data || []
    if (vodResult.error) sendWarning('Failed to fetch movies — timed out or server error')
    send('movies', 0, vodStreams.length, `Saving ${vodStreams.length.toLocaleString()} movies…`)

    if (!sourceExists()) { sendDone(0, 0); db.close(); return }

    const batchVod = db.transaction((items: any[]) => {
      for (const s of items) {
        const cid = `${sourceId}:movie:${s.stream_id}`
        const rawTitle: string = s.name || `Movie ${s.stream_id}`
        const rawCatId = s.category_id ? `${sourceId}:moviecat:${s.category_id}` : null
        const catId = rawCatId && movieCatIds.has(rawCatId) ? rawCatId : null

        insertMovie.run(
          cid, sourceId, catId, String(s.stream_id), rawTitle, normalizeForSearch(rawTitle),
          s.stream_icon || null, s.container_extension || null
        )
      }
    })
    for (let i = 0; i < vodStreams.length; i += BATCH) {
      batchVod(vodStreams.slice(i, i + BATCH))
      send('movies', Math.min(i + BATCH, vodStreams.length), vodStreams.length, `Movies: ${Math.min(i + BATCH, vodStreams.length)}/${vodStreams.length}`)
    }

    // ── Series parents ─────────────────────────────────────────────────────
    send('series', 0, 0, 'Fetching series…')
    const seriesResult = await fetchJson<any[]>(`${apiBase}&action=get_series`, FETCH_TIMEOUT, 'series')
    const seriesList = seriesResult.data || []
    if (seriesResult.error) sendWarning('Failed to fetch series — timed out or server error')
    send('series', 0, seriesList.length, `Saving ${seriesList.length.toLocaleString()} series…`)

    if (!sourceExists()) { sendDone(0, 0); db.close(); return }

    const batchSeries = db.transaction((items: any[]) => {
      for (const s of items) {
        const sid = `${sourceId}:series:${s.series_id}`
        const rawTitle: string = s.name || `Series ${s.series_id}`
        const rawCatId = s.category_id ? `${sourceId}:seriescat:${s.category_id}` : null
        const catId = rawCatId && seriesCatIds.has(rawCatId) ? rawCatId : null

        insertSeries.run(
          sid, sourceId, catId, String(s.series_id), rawTitle, normalizeForSearch(rawTitle),
          s.cover || null
        )
      }
    })
    for (let i = 0; i < seriesList.length; i += BATCH) {
      batchSeries(seriesList.slice(i, i + BATCH))
      send('series', Math.min(i + BATCH, seriesList.length), seriesList.length, `Series: ${Math.min(i + BATCH, seriesList.length)}/${seriesList.length}`)
    }

    // ── Finalize ───────────────────────────────────────────────────────────
    if (!sourceExists()) { sendDone(0, 0); db.close(); return }

    const chCount = (db.prepare('SELECT COUNT(*) as n FROM channels WHERE source_id = ?').get(sourceId) as { n: number }).n
    const mvCount = (db.prepare('SELECT COUNT(*) as n FROM movies   WHERE source_id = ?').get(sourceId) as { n: number }).n
    const seCount = (db.prepare('SELECT COUNT(*) as n FROM series   WHERE source_id = ?').get(sourceId) as { n: number }).n
    const totalItems = chCount + mvCount + seCount

    db.prepare(`
      UPDATE sources SET status = 'active', last_sync = unixepoch(), last_error = NULL, item_count = ?
      WHERE id = ?
    `).run(totalItems, sourceId)

    sendDone(totalItems, catCount)
  } catch (err) {
    if (!sourceExists()) {
      console.log('[SyncWorker] Source deleted during sync — suppressing error:', String(err))
      sendDone(0, 0)
    } else {
      db.prepare(`UPDATE sources SET status = 'error', last_error = ? WHERE id = ?`).run(String(err), sourceId)
      sendError(String(err))
    }
  } finally {
    db.close()
  }
}

run()
