/**
 * Sync worker — runs Xtream API fetch + DB inserts off the main thread.
 * Receives source info via workerData, sends progress via parentPort.
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'

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

function sendWarning(message: string) {
  parentPort?.postMessage({ type: 'warning', message })
}

function sendDone(totalItems: number, catCount: number) {
  parentPort?.postMessage({ type: 'done', totalItems, catCount })
}

// Simple text normalization (lowercase + trim). The main process will rebuild FTS with proper anyAscii later if needed.
function normalize(text: string | null | undefined): string | null {
  if (!text) return null
  return text.toLowerCase().trim()
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

  // Guard: check if source still exists (may have been deleted mid-sync)
  const sourceExistsStmt = db.prepare('SELECT 1 FROM sources WHERE id = ?')
  function sourceExists(): boolean {
    return !!sourceExistsStmt.get(sourceId)
  }

  try {
    const base = serverUrl.replace(/\/$/, '')
    const apiBase = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
    const FETCH_TIMEOUT = 180_000 // 3 minutes for huge lists

    // Mark as syncing
    db.prepare('UPDATE sources SET status = ? WHERE id = ?').run('syncing', sourceId)

    // ── Categories ────────────────────────────────────────────────────────
    if (!sourceExists()) { console.log('[SyncWorker] Source deleted before category sync — aborting'); sendDone(0, 0); db.close(); return }
    send('categories', 0, 3, 'Fetching categories...')

    const [liveCatsResult, vodCatsResult, seriesCatsResult] = await Promise.all([
      fetchJson<any[]>(`${apiBase}&action=get_live_categories`, 15_000, 'live_categories'),
      fetchJson<any[]>(`${apiBase}&action=get_vod_categories`, 15_000, 'vod_categories'),
      fetchJson<any[]>(`${apiBase}&action=get_series_categories`, 15_000, 'series_categories'),
    ])
    const liveCats = liveCatsResult.data
    const vodCats = vodCatsResult.data
    const seriesCats = seriesCatsResult.data

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
    send('categories', catCount, catCount, `${catCount} categories (${liveCats?.length ?? 0} live, ${vodCats?.length ?? 0} movies, ${seriesCats?.length ?? 0} series)`)

    // ── Live streams ──────────────────────────────────────────────────────
    send('live', 0, 0, 'Fetching channels…')
    const liveResult = await fetchJson<any[]>(`${apiBase}&action=get_live_streams`, FETCH_TIMEOUT, 'live_streams')
    const liveStreams = liveResult.data
    if (liveResult.error) sendWarning('Failed to fetch live channels — timed out or server error')
    send('live', 0, liveStreams?.length ?? 0, `Saving ${(liveStreams?.length ?? 0).toLocaleString()} channels…`)

    const insertCanonical = db.prepare(`
      INSERT INTO canonical (id, type, title, tvg_id, poster_path)
      VALUES (?, 'channel', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        tvg_id = COALESCE(excluded.tvg_id, canonical.tvg_id),
        poster_path = COALESCE(excluded.poster_path, canonical.poster_path)
    `)
    const insertStream = db.prepare(`
      INSERT INTO streams (id, canonical_id, source_id, type, stream_id, title, category_id, tvg_id, thumbnail_url, catchup_supported, catchup_days, epg_channel_id)
      VALUES (?, ?, ?, 'live', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_id      = excluded.canonical_id,
        title             = excluded.title,
        category_id       = excluded.category_id,
        tvg_id            = excluded.tvg_id,
        thumbnail_url     = excluded.thumbnail_url,
        catchup_supported = excluded.catchup_supported,
        catchup_days      = excluded.catchup_days,
        epg_channel_id    = excluded.epg_channel_id
    `)
    const insertFts = db.prepare(`INSERT OR REPLACE INTO canonical_fts (canonical_id, title) VALUES (?, ?)`)
    const insertSC = db.prepare(`INSERT OR IGNORE INTO stream_categories (stream_id, category_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM categories WHERE id = ?)`)

    const insertCanonicalMovie = db.prepare(`
      INSERT INTO canonical (id, type, title, year, poster_path, vote_average)
      VALUES (?, 'movie', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title       = excluded.title,
        year        = COALESCE(excluded.year, canonical.year),
        poster_path = COALESCE(excluded.poster_path, canonical.poster_path),
        vote_average = COALESCE(excluded.vote_average, canonical.vote_average)
    `)
    const insertStreamMovie = db.prepare(`
      INSERT INTO streams (id, canonical_id, source_id, type, stream_id, title, category_id, thumbnail_url, container_extension)
      VALUES (?, ?, ?, 'movie', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_id        = excluded.canonical_id,
        title               = excluded.title,
        category_id         = excluded.category_id,
        thumbnail_url       = excluded.thumbnail_url,
        container_extension = excluded.container_extension
    `)

    const insertCanonicalSeries = db.prepare(`
      INSERT INTO canonical (id, type, title, year, poster_path, overview, director, cast_json, vote_average)
      VALUES (?, 'series', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title       = excluded.title,
        year        = COALESCE(excluded.year, canonical.year),
        poster_path = COALESCE(excluded.poster_path, canonical.poster_path),
        overview    = COALESCE(excluded.overview, canonical.overview),
        director    = COALESCE(excluded.director, canonical.director),
        cast_json   = COALESCE(excluded.cast_json, canonical.cast_json),
        vote_average = COALESCE(excluded.vote_average, canonical.vote_average)
    `)
    const insertStreamSeries = db.prepare(`
      INSERT INTO streams (id, canonical_id, source_id, type, stream_id, title, category_id, thumbnail_url)
      VALUES (?, ?, ?, 'series', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_id  = excluded.canonical_id,
        title         = excluded.title,
        category_id   = excluded.category_id,
        thumbnail_url = excluded.thumbnail_url
    `)

    const insertFtsSeries = db.prepare(`
      INSERT OR REPLACE INTO canonical_fts (canonical_id, title, overview, cast_json, director)
      VALUES (?, ?, ?, ?, ?)
    `)

    const BATCH = 500
    const deleteStaleStreamCategories = db.prepare(`DELETE FROM stream_categories WHERE stream_id IN (SELECT id FROM streams WHERE source_id = ? AND type = ? AND id NOT IN (SELECT value FROM json_each(?)))`)
    const deleteStaleStreams = db.prepare(`DELETE FROM streams WHERE source_id = ? AND type = ? AND id NOT IN (SELECT value FROM json_each(?))`)

    if (!sourceExists()) { console.log('[SyncWorker] Source deleted before live insert — aborting'); sendDone(0, 0); db.close(); return }

    const insertedLiveIds: string[] = []
    const batchLive = db.transaction((items: any[]) => {
      for (const s of items) {
        const cid = `${sourceId}:live:${s.stream_id}`
        const title = s.name || `Channel ${s.stream_id}`
        const tvgId = s.epg_channel_id || null
        const canonicalId = tvgId ? `ch:${tvgId}` : `ch:${sourceId}:${s.stream_id}`

        insertCanonical.run(canonicalId, title, tvgId, s.stream_icon || null)
        insertStream.run(cid, canonicalId, sourceId, String(s.stream_id), title, s.category_id || null, tvgId, s.stream_icon || null, s.tv_archive ? 1 : 0, s.tv_archive_duration || 0, tvgId)
        insertFts.run(canonicalId, normalize(title))
        if (s.category_id) { const catId = `${sourceId}:live:${s.category_id}`; insertSC.run(cid, catId, catId) }
        insertedLiveIds.push(cid)
      }
    })
    for (let i = 0; i < (liveStreams?.length ?? 0); i += BATCH) {
      batchLive((liveStreams || []).slice(i, i + BATCH))
      send('live', Math.min(i + BATCH, liveStreams.length), liveStreams.length, `Channels: ${Math.min(i + BATCH, liveStreams.length)}/${liveStreams.length}`)
    }
    if (!liveResult.error && insertedLiveIds.length > 0) {
      const idsJson = JSON.stringify(insertedLiveIds)
      deleteStaleStreamCategories.run(sourceId, 'live', idsJson)
      deleteStaleStreams.run(sourceId, 'live', idsJson)
    }

    // ── VOD streams ───────────────────────────────────────────────────────
    send('movies', 0, 0, 'Fetching movies…')
    const vodResult = await fetchJson<any[]>(`${apiBase}&action=get_vod_streams`, FETCH_TIMEOUT, 'vod_streams')
    const vodStreams = vodResult.data
    if (vodResult.error) sendWarning('Failed to fetch movies — timed out or server error')
    send('movies', 0, vodStreams?.length ?? 0, `Saving ${(vodStreams?.length ?? 0).toLocaleString()} movies…`)

    if (!sourceExists()) { console.log('[SyncWorker] Source deleted before VOD insert — aborting'); sendDone(0, 0); db.close(); return }

    const insertedVodIds: string[] = []
    const batchVod = db.transaction((items: any[]) => {
      for (const s of items) {
        const cid = `${sourceId}:movie:${s.stream_id}`
        const title = s.name || `Movie ${s.stream_id}`
        const year = s.year ? parseInt(s.year) : null
        const canonicalId = `anon:movie:${sourceId}:${s.stream_id}`

        insertCanonicalMovie.run(canonicalId, title, year, s.stream_icon || null, s.rating_5based ? s.rating_5based * 2 : null)
        insertStreamMovie.run(cid, canonicalId, sourceId, String(s.stream_id), title, s.category_id || null, s.stream_icon || null, s.container_extension || null)
        insertFts.run(canonicalId, normalize(title))
        if (s.category_id) { const catId = `${sourceId}:movie:${s.category_id}`; insertSC.run(cid, catId, catId) }
        insertedVodIds.push(cid)
      }
    })
    for (let i = 0; i < (vodStreams?.length ?? 0); i += BATCH) {
      batchVod((vodStreams || []).slice(i, i + BATCH))
      send('movies', Math.min(i + BATCH, vodStreams.length), vodStreams.length, `Movies: ${Math.min(i + BATCH, vodStreams.length)}/${vodStreams.length}`)
    }
    if (!vodResult.error && insertedVodIds.length > 0) {
      const idsJson = JSON.stringify(insertedVodIds)
      deleteStaleStreamCategories.run(sourceId, 'movie', idsJson)
      deleteStaleStreams.run(sourceId, 'movie', idsJson)
    }

    // ── Series ────────────────────────────────────────────────────────────
    send('series', 0, 0, 'Fetching series…')
    const seriesResult = await fetchJson<any[]>(`${apiBase}&action=get_series`, FETCH_TIMEOUT, 'series')
    const seriesList = seriesResult.data
    if (seriesResult.error) sendWarning('Failed to fetch series — timed out or server error')
    send('series', 0, seriesList?.length ?? 0, `Saving ${(seriesList?.length ?? 0).toLocaleString()} series…`)

    if (!sourceExists()) { console.log('[SyncWorker] Source deleted before series insert — aborting'); sendDone(0, 0); db.close(); return }

    const insertedSeriesIds: string[] = []
    const batchSeries = db.transaction((items: any[]) => {
      for (const s of items) {
        const cid = `${sourceId}:series:${s.series_id}`
        const title = s.name || `Series ${s.series_id}`
        const year = s.year ? parseInt(s.year) : null
        const canonicalId = `anon:series:${sourceId}:${s.series_id}`

        insertCanonicalSeries.run(canonicalId, title, year, s.cover || null, s.plot || null, s.director || null, s.cast || null, s.rating_5based ? s.rating_5based * 2 : null)
        insertStreamSeries.run(cid, canonicalId, sourceId, String(s.series_id), title, s.category_id || null, s.cover || null)
        insertFtsSeries.run(canonicalId, normalize(title), normalize(s.plot), normalize(s.cast), normalize(s.director))
        if (s.category_id) { const catId = `${sourceId}:series:${s.category_id}`; insertSC.run(cid, catId, catId) }
        insertedSeriesIds.push(cid)
      }
    })
    for (let i = 0; i < (seriesList?.length ?? 0); i += BATCH) {
      batchSeries((seriesList || []).slice(i, i + BATCH))
      send('series', Math.min(i + BATCH, seriesList.length), seriesList.length, `Series: ${Math.min(i + BATCH, seriesList.length)}/${seriesList.length}`)
    }
    if (!seriesResult.error && insertedSeriesIds.length > 0) {
      const idsJson = JSON.stringify(insertedSeriesIds)
      deleteStaleStreamCategories.run(sourceId, 'series', idsJson)
      deleteStaleStreams.run(sourceId, 'series', idsJson)
    }

    // ── Finalize ──────────────────────────────────────────────────────────
    if (!sourceExists()) { console.log('[SyncWorker] Source deleted before finalize — aborting'); sendDone(0, 0); db.close(); return }

    db.prepare('UPDATE categories SET content_synced = 1 WHERE source_id = ?').run(sourceId)
    const totalItems = (db.prepare('SELECT COUNT(*) as n FROM streams WHERE source_id = ?').get(sourceId) as any).n

    db.prepare(`
      UPDATE sources SET status = 'active', last_sync = unixepoch(), last_error = NULL, item_count = ?
      WHERE id = ?
    `).run(totalItems, sourceId)

    sendDone(totalItems, catCount)
  } catch (err) {
    // If source was deleted mid-sync, don't try to update its status — just log and exit
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
