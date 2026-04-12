/**
 * Sync worker — V3 cutover (Phase D1).
 *
 * Fetches Xtream catalog for a single source and writes the V3 shape:
 *   - `streams` rows with L14 normalizer outputs (year_hint, language_hint, …)
 *     and provider-raw fields; polymorphic FK is left NULL pending oracle.
 *   - `canonical_vod`, `canonical_series`, `canonical_live` identity rows,
 *     deduped via `content_hash` (sha1(normalized_title + year + type)) for
 *     VOD/series, sha1(tvg_id or normalized_name + country) for live.
 *   - Per-type FTS mirrors populated inline (light cols only — normalized_title
 *     / canonical_name).
 *   - New canonicals start `oracle_status='pending'`; the enrichment worker
 *     drains the queue after sync completes.
 *
 * Wipe semantics (user Q6): a re-sync of the same source wipes all streams
 * belonging to it before re-inserting. Categories are upserted (positions
 * matter). Empty canonicals (no streams pointing at them) are swept at the
 * end of the sync.
 *
 * This worker only talks to SQLite and the Xtream HTTP API. It never touches
 * metadata providers, iptv-org, or TMDB — enrichment is a separate worker.
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
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
  if (total > 0) {
    console.log(`[sync] ${phase} ${current}/${total} — ${message}`)
  } else {
    console.log(`[sync] ${phase} — ${message}`)
  }
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

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex')
}

function vodContentHash(normalizedTitle: string, year: number | null, type: 'movie' | 'series'): string {
  return sha1(`${type}|${normalizedTitle}|${year ?? ''}`)
}

function liveContentHash(tvgId: string | null, normalizedName: string): string {
  if (tvgId && tvgId.trim()) return sha1(`live|tvg|${tvgId.trim().toLowerCase()}`)
  return sha1(`live|name|${normalizedName}`)
}

async function run() {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = normal')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 30000')

  const sourceExistsStmt = db.prepare('SELECT 1 FROM sources WHERE id = ?')
  const sourceExists = (): boolean => !!sourceExistsStmt.get(sourceId)

  try {
    const base = serverUrl.replace(/\/$/, '')
    const apiBase = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
    const FETCH_TIMEOUT = 180_000

    db.prepare('UPDATE sources SET status = ? WHERE id = ?').run('syncing', sourceId)

    // ── Categories ─────────────────────────────────────────────────────────
    if (!sourceExists()) { console.log('[SyncWorker] Source deleted before category sync — aborting'); sendDone(0, 0); db.close(); return }
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
    send('categories', catCount, catCount, `${catCount} categories (${liveCats.length} live, ${vodCats.length} movies, ${seriesCats.length} series)`)

    // ── Wipe this source's streams (Q6 wipe semantics) ─────────────────────
    db.prepare(`DELETE FROM stream_categories WHERE stream_id IN (SELECT id FROM streams WHERE source_id = ?)`).run(sourceId)
    db.prepare(`DELETE FROM streams WHERE source_id = ?`).run(sourceId)

    // ── Prepared statements ────────────────────────────────────────────────
    // Phase 1 (sync): raw writes only — no canonical/FTS for live or movies.
    // Series canonical is written here (NOT NULL FK on series_sources requires it),
    // but without FTS. The indexing worker handles canonical+FTS for live+movies
    // and adds FTS for series after sync completes.

    const insertSeriesCanonical = db.prepare(`
      INSERT INTO canonical_series (normalized_title, year, content_hash)
      VALUES (?, ?, ?)
      ON CONFLICT(content_hash) DO UPDATE SET normalized_title = excluded.normalized_title
      RETURNING id
    `)
    const selectSeriesByHash = db.prepare(`SELECT id FROM canonical_series WHERE content_hash = ?`)

    const insertStreamLive = db.prepare(`
      INSERT INTO streams (
        id, source_id, type, stream_id, title, thumbnail_url, category_id,
        tvg_id, epg_channel_id, catchup_supported, catchup_days,
        language_hint, origin_hint, quality_hint, year_hint,
        canonical_live_id
      ) VALUES (?, ?, 'live', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertStreamMovie = db.prepare(`
      INSERT INTO streams (
        id, source_id, type, stream_id, title, thumbnail_url, container_extension, category_id,
        language_hint, origin_hint, quality_hint, year_hint,
        canonical_vod_id
      ) VALUES (?, ?, 'movie', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    /**
     * Series at the Xtream level are the parent shells — individual episodes
     * are lazy-fetched by `series:get-info`. We represent the series entry
     * itself in streams as a `movie`-typed row pointing at a VOD canonical?
     *
     * No — that blurs the discriminator. Instead, we store series parents as
     * streams with type='movie' is incorrect. The schema CHECK only allows
     * live/movie/episode. A series *parent* isn't directly playable, so it
     * doesn't belong in streams at all — only its episodes do.
     *
     * Phase D decision: series parents are represented purely as
     * canonical_series rows, discovered at browse/search time via a join
     * table. We'll store per-source series metadata in a side table so
     * category browsing still works, but won't insert "series" stream rows.
     */
    const insertSeriesSource = db.prepare(`
      INSERT INTO series_sources (
        id, source_id, canonical_series_id, series_external_id, title,
        thumbnail_url, category_id, language_hint, origin_hint, quality_hint, year_hint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_series_id = excluded.canonical_series_id,
        title = excluded.title,
        thumbnail_url = excluded.thumbnail_url,
        category_id = excluded.category_id,
        language_hint = excluded.language_hint,
        origin_hint = excluded.origin_hint,
        quality_hint = excluded.quality_hint,
        year_hint = excluded.year_hint
    `)

    // Wipe series_sources for this source (fresh sync semantics).
    // The table itself is created by `createTables()` in connection.ts.
    db.prepare(`DELETE FROM series_source_categories WHERE series_source_id IN (SELECT id FROM series_sources WHERE source_id = ?)`).run(sourceId)
    db.prepare(`DELETE FROM series_sources WHERE source_id = ?`).run(sourceId)

    const insertSC = db.prepare(`INSERT OR IGNORE INTO stream_categories (stream_id, category_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM categories WHERE id = ?)`)
    const insertSSC = db.prepare(`INSERT OR IGNORE INTO series_source_categories (series_source_id, category_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM categories WHERE id = ?)`)

    // Series canonical only — no FTS (indexing worker adds FTS later).
    function upsertSeriesCanonical(normalizedTitle: string, year: number | null): number {
      const hash = vodContentHash(normalizedTitle, year, 'series')
      try {
        const row = insertSeriesCanonical.get(normalizedTitle, year, hash) as { id: number } | undefined
        if (row?.id) return row.id
      } catch {}
      const existing = selectSeriesByHash.get(hash) as { id: number } | undefined
      if (existing?.id) return existing.id
      throw new Error(`Failed to upsert canonical_series for hash ${hash}`)
    }

    // ── Live streams ───────────────────────────────────────────────────────
    send('live', 0, 0, 'Downloading channel list…')
    const liveResult = await fetchJson<any[]>(`${apiBase}&action=get_live_streams`, FETCH_TIMEOUT, 'live_streams')
    const liveStreams = liveResult.data || []
    if (liveResult.error) sendWarning('Failed to fetch live channels — timed out or server error')
    send('live', 0, liveStreams.length, `Importing ${liveStreams.length.toLocaleString()} channels…`)

    if (!sourceExists()) { console.log('[SyncWorker] Source deleted before live insert — aborting'); sendDone(0, 0); db.close(); return }

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
          normalized.year || null,
          null  // canonical_live_id — set by indexing worker
        )
        if (s.category_id) {
          const catId = `${sourceId}:live:${s.category_id}`
          insertSC.run(cid, catId, catId)
        }
      }
    })
    for (let i = 0; i < liveStreams.length; i += BATCH) {
      batchLive(liveStreams.slice(i, i + BATCH))
      send('live', Math.min(i + BATCH, liveStreams.length), liveStreams.length, `Importing channels: ${Math.min(i + BATCH, liveStreams.length).toLocaleString()} / ${liveStreams.length.toLocaleString()}`)
    }

    // ── VOD streams ────────────────────────────────────────────────────────
    send('movies', 0, 0, 'Downloading movie list…')
    const vodResult = await fetchJson<any[]>(`${apiBase}&action=get_vod_streams`, FETCH_TIMEOUT, 'vod_streams')
    const vodStreams = vodResult.data || []
    if (vodResult.error) sendWarning('Failed to fetch movies — timed out or server error')
    send('movies', 0, vodStreams.length, `Importing ${vodStreams.length.toLocaleString()} movies…`)

    if (!sourceExists()) { console.log('[SyncWorker] Source deleted before VOD insert — aborting'); sendDone(0, 0); db.close(); return }

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
          year || null,
          null  // canonical_vod_id — set by indexing worker
        )
        if (s.category_id) {
          const catId = `${sourceId}:movie:${s.category_id}`
          insertSC.run(cid, catId, catId)
        }
      }
    })
    for (let i = 0; i < vodStreams.length; i += BATCH) {
      batchVod(vodStreams.slice(i, i + BATCH))
      send('movies', Math.min(i + BATCH, vodStreams.length), vodStreams.length, `Importing movies: ${Math.min(i + BATCH, vodStreams.length).toLocaleString()} / ${vodStreams.length.toLocaleString()}`)
    }

    // ── Series parents ─────────────────────────────────────────────────────
    // Episodes are lazy-fetched on series open (Phase D Q5); here we only
    // record the series shell into `series_sources` + canonical_series.
    send('series', 0, 0, 'Downloading series list…')
    const seriesResult = await fetchJson<any[]>(`${apiBase}&action=get_series`, FETCH_TIMEOUT, 'series')
    const seriesList = seriesResult.data || []
    if (seriesResult.error) sendWarning('Failed to fetch series — timed out or server error')
    send('series', 0, seriesList.length, `Importing ${seriesList.length.toLocaleString()} series…`)

    if (!sourceExists()) { console.log('[SyncWorker] Source deleted before series insert — aborting'); sendDone(0, 0); db.close(); return }

    const batchSeries = db.transaction((items: any[]) => {
      for (const s of items) {
        const sid = `${sourceId}:series:${s.series_id}`
        const rawTitle: string = s.name || `Series ${s.series_id}`
        const normalized = normalizeTitle(rawTitle)
        const providerYearRaw = s.year ? parseInt(String(s.year), 10) : null
        const providerYear = Number.isFinite(providerYearRaw as number) ? (providerYearRaw as number) : null
        const year = normalized.year ?? providerYear

        const canonicalSeriesId = upsertSeriesCanonical(
          normalized.normalizedTitle || rawTitle.toLowerCase(),
          year,
        )

        insertSeriesSource.run(
          sid, sourceId, canonicalSeriesId, String(s.series_id), rawTitle,
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
      send('series', Math.min(i + BATCH, seriesList.length), seriesList.length, `Importing series: ${Math.min(i + BATCH, seriesList.length).toLocaleString()} / ${seriesList.length.toLocaleString()}`)
    }

    // ── Sweep orphan series canonicals (vod/live swept by indexing worker) ──
    send('series', seriesList.length, seriesList.length, 'Finalizing…')
    db.prepare(`DELETE FROM canonical_series WHERE id NOT IN (SELECT canonical_series_id FROM series_sources WHERE canonical_series_id IS NOT NULL)`).run()

    // ── Finalize ───────────────────────────────────────────────────────────
    if (!sourceExists()) { console.log('[SyncWorker] Source deleted before finalize — aborting'); sendDone(0, 0); db.close(); return }

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
