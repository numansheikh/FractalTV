/**
 * Sync worker — g1 tier.
 *
 * Fetches Xtream catalog for a single source and writes:
 *   - `streams` rows with normalizer outputs (year_hint, language_hint, …)
 *   - `series_sources` rows for series parents
 *   - `categories` rows
 *
 * No canonical tables, no FTS, no enrichment. Pure provider data.
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { normalize as normalizeTitle } from '../services/title-normalizer'

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
    insertAllCats(liveCats, 'live')
    insertAllCats(vodCats, 'movie')
    insertAllCats(seriesCats, 'series')

    const catCount = liveCats.length + vodCats.length + seriesCats.length
    send('categories', catCount, catCount, `${catCount} categories`)

    // ── Backup user data before wipe (survives CASCADE) ─────────────────
    db.prepare(`CREATE TEMP TABLE IF NOT EXISTS _bak_stream_ud AS SELECT * FROM stream_user_data WHERE 0`).run()
    db.prepare(`CREATE TEMP TABLE IF NOT EXISTS _bak_series_ud AS SELECT * FROM series_user_data WHERE 0`).run()
    db.prepare(`CREATE TEMP TABLE IF NOT EXISTS _bak_channel_ud AS SELECT * FROM channel_user_data WHERE 0`).run()
    db.prepare(`DELETE FROM _bak_stream_ud`).run()
    db.prepare(`DELETE FROM _bak_series_ud`).run()
    db.prepare(`DELETE FROM _bak_channel_ud`).run()

    db.prepare(`
      INSERT INTO _bak_stream_ud SELECT sud.* FROM stream_user_data sud
      JOIN streams s ON s.id = sud.stream_id WHERE s.source_id = ?
    `).run(sourceId)
    db.prepare(`
      INSERT INTO _bak_series_ud SELECT sud.* FROM series_user_data sud
      JOIN series_sources ss ON ss.id = sud.series_source_id WHERE ss.source_id = ?
    `).run(sourceId)
    db.prepare(`
      INSERT INTO _bak_channel_ud SELECT cud.* FROM channel_user_data cud
      JOIN streams s ON s.id = cud.stream_id WHERE s.source_id = ?
    `).run(sourceId)

    // ── Wipe this source's streams ─────────────────────────────────────────
    db.prepare(`DELETE FROM stream_categories WHERE stream_id IN (SELECT id FROM streams WHERE source_id = ?)`).run(sourceId)
    db.prepare(`DELETE FROM streams WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM series_source_categories WHERE series_source_id IN (SELECT id FROM series_sources WHERE source_id = ?)`).run(sourceId)
    db.prepare(`DELETE FROM series_sources WHERE source_id = ?`).run(sourceId)

    // ── Prepared statements ────────────────────────────────────────────────

    const insertStreamLive = db.prepare(`
      INSERT INTO streams (
        id, source_id, type, stream_id, title, thumbnail_url, category_id,
        tvg_id, epg_channel_id, catchup_supported, catchup_days,
        language_hint, origin_hint, quality_hint, year_hint
      ) VALUES (?, ?, 'live', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertStreamMovie = db.prepare(`
      INSERT INTO streams (
        id, source_id, type, stream_id, title, thumbnail_url, container_extension, category_id,
        language_hint, origin_hint, quality_hint, year_hint
      ) VALUES (?, ?, 'movie', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertSeriesSource = db.prepare(`
      INSERT INTO series_sources (
        id, source_id, series_external_id, title,
        thumbnail_url, category_id, language_hint, origin_hint, quality_hint, year_hint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        thumbnail_url = excluded.thumbnail_url,
        category_id = excluded.category_id,
        language_hint = excluded.language_hint,
        origin_hint = excluded.origin_hint,
        quality_hint = excluded.quality_hint,
        year_hint = excluded.year_hint
    `)

    const insertSC = db.prepare(`INSERT OR IGNORE INTO stream_categories (stream_id, category_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM categories WHERE id = ?)`)
    const insertSSC = db.prepare(`INSERT OR IGNORE INTO series_source_categories (series_source_id, category_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM categories WHERE id = ?)`)

    // ── Live streams ───────────────────────────────────────────────────────
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
        const normalized = normalizeTitle(rawTitle)
        const tvgId: string | null = s.epg_channel_id || null

        insertStreamLive.run(
          cid, sourceId, String(s.stream_id), rawTitle,
          s.stream_icon || null, s.category_id || null,
          tvgId, tvgId,
          s.tv_archive ? 1 : 0, s.tv_archive_duration || 0,
          normalized.languageHint || null,
          normalized.originHint || null,
          normalized.qualityHint || null,
          normalized.year || null
        )
        if (s.category_id) {
          const catId = `${sourceId}:live:${s.category_id}`
          insertSC.run(cid, catId, catId)
        }
      }
    })
    for (let i = 0; i < liveStreams.length; i += BATCH) {
      batchLive(liveStreams.slice(i, i + BATCH))
      send('live', Math.min(i + BATCH, liveStreams.length), liveStreams.length, `Channels: ${Math.min(i + BATCH, liveStreams.length)}/${liveStreams.length}`)
    }

    // ── VOD streams ────────────────────────────────────────────────────────
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
        const normalized = normalizeTitle(rawTitle)
        const providerYearRaw = s.year ? parseInt(String(s.year), 10) : null
        const providerYear = Number.isFinite(providerYearRaw as number) ? (providerYearRaw as number) : null
        const year = normalized.year ?? providerYear

        insertStreamMovie.run(
          cid, sourceId, String(s.stream_id), rawTitle,
          s.stream_icon || null, s.container_extension || null, s.category_id || null,
          normalized.languageHint || null,
          normalized.originHint || null,
          normalized.qualityHint || null,
          year || null
        )
        if (s.category_id) {
          const catId = `${sourceId}:movie:${s.category_id}`
          insertSC.run(cid, catId, catId)
        }
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
        const normalized = normalizeTitle(rawTitle)
        const providerYearRaw = s.year ? parseInt(String(s.year), 10) : null
        const providerYear = Number.isFinite(providerYearRaw as number) ? (providerYearRaw as number) : null
        const year = normalized.year ?? providerYear

        insertSeriesSource.run(
          sid, sourceId, String(s.series_id), rawTitle,
          s.cover || null, s.category_id || null,
          normalized.languageHint || null,
          normalized.originHint || null,
          normalized.qualityHint || null,
          year || null
        )
        if (s.category_id) {
          const catId = `${sourceId}:series:${s.category_id}`
          insertSSC.run(sid, catId, catId)
        }
      }
    })
    for (let i = 0; i < seriesList.length; i += BATCH) {
      batchSeries(seriesList.slice(i, i + BATCH))
      send('series', Math.min(i + BATCH, seriesList.length), seriesList.length, `Series: ${Math.min(i + BATCH, seriesList.length)}/${seriesList.length}`)
    }

    // ── Finalize ───────────────────────────────────────────────────────────
    if (!sourceExists()) { sendDone(0, 0); db.close(); return }

    // ── Restore user data (only for streams/series that still exist) ────
    db.prepare(`
      INSERT OR IGNORE INTO stream_user_data SELECT b.* FROM _bak_stream_ud b
      WHERE EXISTS (SELECT 1 FROM streams WHERE id = b.stream_id)
    `).run()
    db.prepare(`
      INSERT OR IGNORE INTO series_user_data SELECT b.* FROM _bak_series_ud b
      WHERE EXISTS (SELECT 1 FROM series_sources WHERE id = b.series_source_id)
    `).run()
    db.prepare(`
      INSERT OR IGNORE INTO channel_user_data SELECT b.* FROM _bak_channel_ud b
      WHERE EXISTS (SELECT 1 FROM streams WHERE id = b.stream_id)
    `).run()
    db.prepare(`DROP TABLE IF EXISTS _bak_stream_ud`).run()
    db.prepare(`DROP TABLE IF EXISTS _bak_series_ud`).run()
    db.prepare(`DROP TABLE IF EXISTS _bak_channel_ud`).run()

    db.prepare('UPDATE categories SET content_synced = 1 WHERE source_id = ?').run(sourceId)
    const streamsCount = (db.prepare('SELECT COUNT(*) as n FROM streams WHERE source_id = ?').get(sourceId) as { n: number }).n
    const seriesCount = (db.prepare('SELECT COUNT(*) as n FROM series_sources WHERE source_id = ?').get(sourceId) as { n: number }).n
    const totalItems = streamsCount + seriesCount

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
