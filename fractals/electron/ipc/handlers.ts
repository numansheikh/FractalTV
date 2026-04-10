import { ipcMain, BrowserWindow, app, dialog } from 'electron'
import { spawn } from 'child_process'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { getDb, getSqlite, getSetting, rebuildFtsIfNeeded } from '../database/connection'
import { sources } from '../database/schema'
import { eq } from 'drizzle-orm'
import { xtreamService } from '../services/xtream.service'
import { m3uService } from '../services/m3u.service'
import { syncEpg, getNowNext } from '../services/epg.service'
import { normalizeForSearch } from '../lib/normalize'
import { parseQuery } from '../services/search/query-parser'

// ─── Minimal row interfaces ─────────────────────────────────────────────────

interface CountRow { n: number }

interface SourceRow {
  id: string; type: string; name: string
  server_url: string; username: string; password: string
  m3u_url?: string; status?: string; disabled?: number
  color_index?: number; last_epg_sync?: number
}

interface StreamRow {
  id: string; source_id: string; stream_id: string; type: 'live' | 'movie' | 'episode'
  title: string; category_id?: string; thumbnail_url?: string
  container_extension?: string; stream_url?: string
  catchup_supported?: number; catchup_days?: number
  tvg_id?: string; epg_channel_id?: string
  canonical_vod_id?: number
  episode_id?: number
  canonical_live_id?: number
  language_hint?: string; origin_hint?: string
  quality_hint?: string; year_hint?: number
}

interface SeriesSourceRow {
  id: string; source_id: string; canonical_series_id: number
  series_external_id: string; title: string
  thumbnail_url?: string; category_id?: string
  language_hint?: string; origin_hint?: string
  quality_hint?: string; year_hint?: number
}

interface EpisodeRow {
  id: number; canonical_series_id: number
  season: number; episode: number; title?: string
  air_date?: string; imdb_id?: string; plot?: string
}

interface DisabledRow { disabled: number }

const EPG_REFRESH_INTERVAL_HOURS = 24
const DEFAULT_PROFILE = 'default'

function dbPath(): string {
  return join(
    app.getPath('userData'),
    'data',
    process.env.FRACTALS_DB ? `fractals-${process.env.FRACTALS_DB}.db` : 'fractaltv.db'
  )
}

// ─── Enrichment worker kick ────────────────────────────────────────────────
// The enrichment worker is idempotent: it only touches canonicals with
// oracle_status='pending', so calling it repeatedly is cheap. We fire it on
// boot and after every successful sync. A single instance at a time — the
// `enrichmentWorkerActive` flag guards against overlap.
// `activeSyncWorkers` allows cancel mid-flight.

let enrichmentWorkerActive = false
const activeSyncWorkers = new Map<string, Worker>()

export function kickEnrichment(): void {
  if (enrichmentWorkerActive) return
  enrichmentWorkerActive = true
  const workerPath = join(__dirname, 'enrichment.worker.js')
  try {
    const worker = new Worker(workerPath, {
      workerData: { dbPath: dbPath(), userDataPath: app.getPath('userData') },
    })
    worker.on('message', (msg: any) => {
      if (msg?.type === 'done') {
        console.log('[enrichment] done:', msg.stats)
      } else if (msg?.type === 'error') {
        console.warn('[enrichment] error:', msg.message)
      }
    })
    worker.on('error', (err) => { console.warn('[enrichment] worker error:', err) })
    worker.on('exit', () => { enrichmentWorkerActive = false })
  } catch (err) {
    enrichmentWorkerActive = false
    console.warn('[enrichment] failed to spawn worker:', err)
  }
}

function runEpgSync(sqlite: ReturnType<typeof getSqlite>, win: BrowserWindow | null, sourceId: string, src: any) {
  syncEpg(sourceId, src.server_url, src.username, src.password,
    (msg) => win?.webContents.send('epg:progress', { sourceId, message: msg })
  ).then((r) => {
    if (r.inserted > 0) {
      sqlite.prepare(`UPDATE sources SET last_epg_sync = unixepoch() WHERE id = ?`).run(sourceId)
      win?.webContents.send('epg:progress', { sourceId, message: `EPG: ${r.inserted.toLocaleString()} entries loaded` })
    }
  }).catch(() => {}) // EPG failure is non-fatal
}

// ─── Content resolver ─────────────────────────────────────────────────────
// A contentId can point at three different rows in V3:
//   1. `streams`       — playable items (live / movie / episode) keyed by
//                        `{sourceId}:{type}:{stream_id}`
//   2. `series_sources` — series parents, keyed by `{sourceId}:series:{id}`
//   3. (future) manual entries — out of scope
// This helper normalizes that into a single result shape the handlers can
// dispatch on.

type ContentKind = 'movie' | 'episode' | 'live' | 'series'
interface ResolvedContent {
  kind: ContentKind
  /** The stream row for movie/episode/live. Null for series parents. */
  stream?: StreamRow
  /** The series_sources row for 'series' kind. */
  seriesSource?: SeriesSourceRow
  /** For 'episode' kind — the episode row for position/metadata lookups. */
  episode?: EpisodeRow
  /** Integer canonical IDs for user-data table routing. */
  canonicalVodId?: number
  canonicalSeriesId?: number
  canonicalLiveId?: number
  episodeId?: number
}

function resolveContent(sqlite: ReturnType<typeof getSqlite>, contentId: string): ResolvedContent | null {
  const stream = sqlite.prepare('SELECT * FROM streams WHERE id = ?').get(contentId) as StreamRow | undefined
  if (stream) {
    if (stream.type === 'movie') {
      return { kind: 'movie', stream, canonicalVodId: stream.canonical_vod_id ?? undefined }
    }
    if (stream.type === 'live') {
      return { kind: 'live', stream, canonicalLiveId: stream.canonical_live_id ?? undefined }
    }
    if (stream.type === 'episode') {
      const episode = stream.episode_id
        ? (sqlite.prepare('SELECT * FROM episodes WHERE id = ?').get(stream.episode_id) as EpisodeRow | undefined)
        : undefined
      return {
        kind: 'episode',
        stream,
        episode,
        episodeId: stream.episode_id ?? undefined,
        canonicalSeriesId: episode?.canonical_series_id ?? undefined,
      }
    }
  }
  const seriesRow = sqlite.prepare('SELECT * FROM series_sources WHERE id = ?').get(contentId) as SeriesSourceRow | undefined
  if (seriesRow) {
    return { kind: 'series', seriesSource: seriesRow, canonicalSeriesId: seriesRow.canonical_series_id }
  }
  return null
}

// ─── V3 SELECT fragments ──────────────────────────────────────────────────
// The renderer expects a bag of fields carried over from the V2 TMDB era.
// We return NULL for fields that no longer exist (plot, director, cast, etc.)
// until a rich-enrichment tier is added. Fields sourced from V3 canonical:
//   poster_url, year, multilingual title (future).

/** SELECT fragment for streams → canonical_vod/live/episode joins. */
// Max rows fetched internally for search to compute accurate totals.
const SEARCH_TOTAL_CAP = 2000

const STREAM_SELECT = `
  s.id,
  s.source_id         AS primary_source_id,
  s.source_id         AS source_ids,
  s.stream_id         AS external_id,
  s.type,
  s.title             AS title,
  s.category_id,
  COALESCE(cv.poster_url, cs.poster_url, cl.logo_url, s.thumbnail_url) AS poster_url,
  s.container_extension,
  s.catchup_supported,
  s.catchup_days,
  s.epg_channel_id,
  s.tvg_id,
  CASE
    WHEN s.type = 'movie'   THEN CAST(s.canonical_vod_id  AS TEXT)
    WHEN s.type = 'live'    THEN CAST(s.canonical_live_id AS TEXT)
    WHEN s.type = 'episode' THEN CAST(cs.id               AS TEXT)
    ELSE NULL
  END                           AS canonical_id,
  NULL                          AS original_title,
  COALESCE(cv.year, cs.year)    AS year,
  NULL                          AS plot,
  NULL                          AS poster_path,
  NULL                          AS backdrop_url,
  NULL                          AS rating_tmdb,
  NULL                          AS rating_imdb,
  NULL                          AS genres,
  NULL                          AS director,
  NULL                          AS cast,
  NULL                          AS keywords,
  NULL                          AS runtime,
  COALESCE(cv.tmdb_id, cs.tmdb_id) AS tmdb_id,
  CASE
    WHEN cv.oracle_status = 'resolved' OR cs.oracle_status = 'resolved' OR cl.oracle_status = 'resolved'
      THEN 1 ELSE 0
  END                           AS enriched,
  NULL                          AS enriched_at,
  CASE WHEN s.epg_channel_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM epg e WHERE e.channel_external_id = s.epg_channel_id AND e.source_id = s.source_id LIMIT 1
  ) THEN 1 ELSE 0 END            AS has_epg_data
`

const STREAM_JOINS = `
  LEFT JOIN canonical_vod    cv ON cv.id = s.canonical_vod_id
  LEFT JOIN episodes         ep ON ep.id = s.episode_id
  LEFT JOIN canonical_series cs ON cs.id = ep.canonical_series_id
  LEFT JOIN canonical_live   cl ON cl.id = s.canonical_live_id
`

/** SELECT fragment for series_sources → canonical_series. Series parents are
 * not streams — they live in `series_sources` and carry a synthetic 'series'
 * type in the ContentItem shape the renderer expects. */
const SERIES_SELECT = `
  ss.id,
  ss.source_id                    AS primary_source_id,
  ss.source_id                    AS source_ids,
  ss.series_external_id           AS external_id,
  'series'                        AS type,
  ss.title                        AS title,
  ss.category_id,
  COALESCE(cs.poster_url, ss.thumbnail_url) AS poster_url,
  NULL                            AS container_extension,
  0                               AS catchup_supported,
  0                               AS catchup_days,
  NULL                            AS epg_channel_id,
  NULL                            AS tvg_id,
  CAST(cs.id AS TEXT)             AS canonical_id,
  NULL                            AS original_title,
  cs.year                         AS year,
  NULL                            AS plot,
  NULL                            AS poster_path,
  NULL                            AS backdrop_url,
  NULL                            AS rating_tmdb,
  NULL                            AS rating_imdb,
  NULL                            AS genres,
  NULL                            AS director,
  NULL                            AS cast,
  NULL                            AS keywords,
  NULL                            AS runtime,
  cs.tmdb_id                      AS tmdb_id,
  CASE WHEN cs.oracle_status = 'resolved' THEN 1 ELSE 0 END AS enriched,
  NULL                            AS enriched_at,
  0                               AS has_epg_data
`

// ─── Handler registration ─────────────────────────────────────────────────

export function registerHandlers() {
  // No-op in V3 — per-type FTS is populated inline by the sync worker.
  rebuildFtsIfNeeded().catch(console.error)

  // Kick the enrichment worker once on startup so pending canonicals from
  // prior sessions get drained even if no new sync is triggered.
  kickEnrichment()

  // ── Ping ────────────────────────────────────────────────────────────────
  ipcMain.handle('ping', () => 'pong')

  // ── File dialog ────────────────────────────────────────────────────────
  ipcMain.handle('dialog:open-file', async (event, args: { filters?: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: args?.filters ?? [{ name: 'All Files', extensions: ['*'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    return { canceled: false, filePath: result.filePaths[0] }
  })

  ipcMain.handle('dialog:save-file', async (event, args: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: args?.defaultPath,
      filters: args?.filters ?? [{ name: 'All Files', extensions: ['*'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    return { canceled: false, filePath: result.filePath }
  })

  // ── DevTools ───────────────────────────────────────────────────────────
  ipcMain.handle('devtools:toggle', (event) => {
    event.sender.toggleDevTools()
  })

  // ── Sources ────────────────────────────────────────────────────────────
  ipcMain.handle('sources:list', async () => {
    const db = getDb()
    const rows = await db.select().from(sources).all()
    return rows.map((s) => ({ ...s, colorIndex: (s as unknown as { color_index?: number }).color_index ?? undefined }))
  })

  ipcMain.handle('sources:set-color', (_event, sourceId: string, colorIndex: number) => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE sources SET color_index = ? WHERE id = ?`).run(colorIndex, sourceId)
    return { ok: true }
  })

  ipcMain.handle('sources:export', async (event, opts: { includeUserData?: boolean } = {}) => {
    const sqlite = getSqlite()

    const srcs = sqlite.prepare(`
      SELECT id, type, name, server_url, username, password, m3u_url, status, disabled, color_index
      FROM sources ORDER BY created_at ASC
    `).all()

    // V3 user data is split across four tables. Exported as a union so
    // import can restore exactly what it saw.
    const payload: any = {
      version: 3,
      exported_at: new Date().toISOString(),
      sources: srcs,
      settings: {}, // no TMDB key in V3 — oracle is keyless
    }

    if (opts.includeUserData) {
      payload.user_data = {
        canonical_vod:    sqlite.prepare(`SELECT * FROM canonical_vod_user_data`).all(),
        canonical_series: sqlite.prepare(`SELECT * FROM canonical_series_user_data`).all(),
        stream:           sqlite.prepare(`SELECT * FROM stream_user_data`).all(),
        channel:          sqlite.prepare(`SELECT * FROM channel_user_data`).all(),
      }
    }

    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `fractals-backup-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8')
    return { canceled: false, count: (srcs as unknown[]).length }
  })

  ipcMain.handle('sources:import', (_event, filePath: string) => {
    const sqlite = getSqlite()
    let parsed: any
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    } catch {
      return { error: 'Invalid JSON file' }
    }
    if (!Array.isArray(parsed?.sources)) return { error: 'Invalid format — missing sources array' }

    const insertSource = sqlite.prepare(`
      INSERT INTO sources (id, type, name, server_url, username, password, m3u_url, status, disabled, color_index)
      VALUES (@id, @type, @name, @server_url, @username, @password, @m3u_url, @status, @disabled, @color_index)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type, name = excluded.name,
        server_url = excluded.server_url, username = excluded.username,
        password = excluded.password, m3u_url = excluded.m3u_url,
        status = excluded.status, disabled = excluded.disabled,
        color_index = excluded.color_index
    `)

    // V3 user-data imports are best-effort: only rows whose canonical/stream
    // row still exists are restored (post-resync IDs may have shifted).
    const insertVodUd = sqlite.prepare(`
      INSERT OR REPLACE INTO canonical_vod_user_data (profile_id, canonical_vod_id, is_favorite, is_watchlisted, rating, fav_sort_order)
      SELECT @profile_id, @canonical_vod_id, @is_favorite, @is_watchlisted, @rating, @fav_sort_order
      WHERE EXISTS (SELECT 1 FROM canonical_vod WHERE id = @canonical_vod_id)
    `)
    const insertSeriesUd = sqlite.prepare(`
      INSERT OR REPLACE INTO canonical_series_user_data (profile_id, canonical_series_id, is_favorite, is_watchlisted, rating, fav_sort_order)
      SELECT @profile_id, @canonical_series_id, @is_favorite, @is_watchlisted, @rating, @fav_sort_order
      WHERE EXISTS (SELECT 1 FROM canonical_series WHERE id = @canonical_series_id)
    `)
    const insertStreamUd = sqlite.prepare(`
      INSERT OR REPLACE INTO stream_user_data (profile_id, stream_id, watch_position, watch_duration, last_watched_at, completed)
      SELECT @profile_id, @stream_id, @watch_position, @watch_duration, @last_watched_at, @completed
      WHERE EXISTS (SELECT 1 FROM streams WHERE id = @stream_id)
    `)
    const insertChannelUd = sqlite.prepare(`
      INSERT OR REPLACE INTO channel_user_data (profile_id, stream_id, is_favorite, fav_sort_order)
      SELECT @profile_id, @stream_id, @is_favorite, @fav_sort_order
      WHERE EXISTS (SELECT 1 FROM streams WHERE id = @stream_id)
    `)

    try {
      sqlite.transaction(() => {
        for (const s of parsed.sources) {
          insertSource.run({
            id:          s.id,
            type:        s.type,
            name:        s.name ?? 'Imported Source',
            server_url:  s.server_url ?? null,
            username:    s.username ?? null,
            password:    s.password ?? null,
            m3u_url:     s.m3u_url ?? null,
            status:      s.status ?? 'active',
            disabled:    s.disabled ?? 0,
            color_index: s.color_index ?? null,
          })
        }
        const ud = parsed.user_data
        if (ud) {
          // V3 shape: object with typed arrays
          if (Array.isArray(ud.canonical_vod))    for (const r of ud.canonical_vod)    insertVodUd.run({ profile_id: DEFAULT_PROFILE, ...r })
          if (Array.isArray(ud.canonical_series)) for (const r of ud.canonical_series) insertSeriesUd.run({ profile_id: DEFAULT_PROFILE, ...r })
          if (Array.isArray(ud.stream))           for (const r of ud.stream)           insertStreamUd.run({ profile_id: DEFAULT_PROFILE, ...r })
          if (Array.isArray(ud.channel))          for (const r of ud.channel)          insertChannelUd.run({ profile_id: DEFAULT_PROFILE, ...r })
        }
      })()
    } catch (e) {
      return { error: `Import failed: ${e}` }
    }

    return { count: parsed.sources.length }
  })

  ipcMain.handle('sources:factory-reset', () => {
    const sqlite = getSqlite()
    sqlite.pragma('foreign_keys = OFF')
    try {
      sqlite.transaction(() => {
        // User data
        sqlite.prepare(`DELETE FROM canonical_vod_user_data`).run()
        sqlite.prepare(`DELETE FROM canonical_series_user_data`).run()
        sqlite.prepare(`DELETE FROM stream_user_data`).run()
        sqlite.prepare(`DELETE FROM channel_user_data`).run()
        // EPG
        sqlite.prepare(`DELETE FROM epg`).run()
        // Streams + series parents + joins
        sqlite.prepare(`DELETE FROM stream_categories`).run()
        sqlite.prepare(`DELETE FROM series_source_categories`).run()
        sqlite.prepare(`DELETE FROM series_sources`).run()
        sqlite.prepare(`DELETE FROM streams`).run()
        sqlite.prepare(`DELETE FROM episodes`).run()
        // Per-type FTS
        sqlite.prepare(`DELETE FROM canonical_vod_fts`).run()
        sqlite.prepare(`DELETE FROM canonical_series_fts`).run()
        sqlite.prepare(`DELETE FROM canonical_live_fts`).run()
        // Canonical identity
        sqlite.prepare(`DELETE FROM canonical_vod`).run()
        sqlite.prepare(`DELETE FROM canonical_series`).run()
        sqlite.prepare(`DELETE FROM canonical_live`).run()
        // Catalog + sources + settings
        sqlite.prepare(`DELETE FROM categories`).run()
        sqlite.prepare(`DELETE FROM sources`).run()
        sqlite.prepare(`DELETE FROM settings WHERE key NOT LIKE 'migration_%'`).run()
      })()
    } finally {
      sqlite.pragma('foreign_keys = ON')
    }
    return { ok: true }
  })

  ipcMain.handle('sources:total-count', () => {
    const sqlite = getSqlite()
    // Count streams + series parents across enabled sources.
    const streamRow = sqlite.prepare(`
      SELECT COUNT(*) as n FROM streams s
      JOIN sources src ON src.id = s.source_id AND src.disabled = 0
    `).get() as CountRow | undefined
    const seriesRow = sqlite.prepare(`
      SELECT COUNT(*) as n FROM series_sources ss
      JOIN sources src ON src.id = ss.source_id AND src.disabled = 0
    `).get() as CountRow | undefined
    return (streamRow?.n ?? 0) + (seriesRow?.n ?? 0)
  })

  ipcMain.handle('sources:add-xtream', async (_event, args: {
    name: string; serverUrl: string; username: string; password: string
  }) => xtreamService.addSource(args.name, args.serverUrl, args.username, args.password))

  ipcMain.handle('sources:test-xtream', async (_event, args: {
    serverUrl: string; username: string; password: string
  }) => xtreamService.testConnection(args.serverUrl, args.username, args.password))

  ipcMain.handle('sources:test-m3u', async (_event, args: { m3uUrl: string }) => m3uService.testConnection(args.m3uUrl))
  ipcMain.handle('sources:add-m3u',  async (_event, args: { name: string; m3uUrl: string }) => m3uService.addSource(args.name, args.m3uUrl))

  ipcMain.handle('sources:remove', async (_event, sourceId: string) => {
    const workerPath = join(__dirname, 'delete.worker.js')
    return new Promise((resolve) => {
      const worker = new Worker(workerPath, { workerData: { sourceId, dbPath: dbPath() } })
      worker.on('message', (msg: any) => resolve(msg))
      worker.on('error', (err) => resolve({ success: false, error: String(err) }))
      worker.on('exit', (code) => { if (code !== 0) resolve({ success: false, error: `Worker exited with code ${code}` }) })
    })
  })

  ipcMain.handle('sources:account-info', async (_event, sourceId: string) => {
    const sqlite = getSqlite()
    const source = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
    if (!source?.server_url) return { error: 'Source not found' }
    return xtreamService.testConnection(source.server_url, source.username, source.password)
  })

  ipcMain.handle('sources:startup-check', async (event) => {
    const sqlite = getSqlite()
    const db = getDb()
    const activeSources = sqlite.prepare(
      `SELECT * FROM sources WHERE disabled = 0 AND type = 'xtream'`
    ).all() as SourceRow[]

    const win = BrowserWindow.fromWebContents(event.sender)

    for (const source of activeSources) {
      try {
        const result = await xtreamService.testConnection(source.server_url, source.username, source.password)
        if (result.success && result.userInfo) {
          await db.update(sources).set({
            status: 'active',
            expDate: result.userInfo.exp_date ?? null,
            maxConnections: result.userInfo.max_connections ? parseInt(result.userInfo.max_connections) : null,
          } as any).where(eq(sources.id, source.id))
        } else {
          await db.update(sources).set({
            status: 'error',
            lastError: result.error ?? 'Connection failed',
          }).where(eq(sources.id, source.id))
        }
        win?.webContents.send('source:health', { sourceId: source.id, ok: result.success, userInfo: result.userInfo, error: result.error })
      } catch (err) {
        win?.webContents.send('source:health', { sourceId: source.id, ok: false, error: String(err) })
      }
    }

    // Refresh stale EPG in background.
    const staleThreshold = Math.floor(Date.now() / 1000) - EPG_REFRESH_INTERVAL_HOURS * 3600
    const staleSources = sqlite.prepare(`
      SELECT * FROM sources
      WHERE disabled = 0 AND server_url IS NOT NULL
        AND (last_epg_sync IS NULL OR last_epg_sync < ?)
    `).all(staleThreshold) as SourceRow[]

    for (const src of staleSources) runEpgSync(sqlite, win, src.id, src)

    return { done: true }
  })

  ipcMain.handle('sources:update', async (_event, args: {
    sourceId: string; name?: string; serverUrl?: string
    username?: string; password?: string; m3uUrl?: string
  }) => {
    const sqlite = getSqlite()
    const sets: string[] = []
    const params: unknown[] = []
    if (args.name !== undefined)      { sets.push('name = ?');       params.push(args.name) }
    if (args.serverUrl !== undefined) { sets.push('server_url = ?'); params.push(args.serverUrl.replace(/\/$/, '')) }
    if (args.username !== undefined)  { sets.push('username = ?');   params.push(args.username) }
    if (args.password !== undefined)  { sets.push('password = ?');   params.push(args.password) }
    if (args.m3uUrl !== undefined)    { sets.push('m3u_url = ?');    params.push(args.m3uUrl) }
    if (sets.length === 0) return { success: false, error: 'Nothing to update' }
    params.push(args.sourceId)
    sqlite.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return { success: true }
  })

  ipcMain.handle('sources:toggle-disabled', async (_event, sourceId: string) => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE sources SET disabled = NOT disabled WHERE id = ?`).run(sourceId)
    const row = sqlite.prepare(`SELECT disabled FROM sources WHERE id = ?`).get(sourceId) as DisabledRow | undefined
    return { disabled: !!row?.disabled }
  })

  ipcMain.handle('sources:sync', async (event, sourceId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sqlite = getSqlite()

    const source = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
    if (!source) return { success: false, error: 'Source not found' }

    const isM3u = source.type === 'm3u'
    const workerPath = join(__dirname, isM3u ? 'm3u-sync.worker.js' : 'sync.worker.js')
    const wData = isM3u
      ? { sourceId, dbPath: dbPath(), m3uUrl: source.m3u_url, sourceName: source.name }
      : { sourceId, dbPath: dbPath(), serverUrl: source.server_url, username: source.username, password: source.password, sourceName: source.name }

    if (!isM3u && !source.server_url) return { success: false, error: 'Source not found' }
    if (isM3u && !source.m3u_url) return { success: false, error: 'M3U URL not found' }

    return new Promise((resolve) => {
      const worker = new Worker(workerPath, { workerData: wData })
      activeSyncWorkers.set(sourceId, worker)

      worker.on('message', (msg: any) => {
        if (msg.type === 'progress') {
          win?.webContents.send('sync:progress', {
            sourceId, phase: msg.phase, current: msg.current, total: msg.total, message: msg.message,
          })
        } else if (msg.type === 'done') {
          activeSyncWorkers.delete(sourceId)
          win?.webContents.send('sync:progress', {
            sourceId, phase: 'done', current: msg.totalItems, total: msg.totalItems,
            message: `Synced ${msg.catCount} categories, ${msg.totalItems.toLocaleString()} items`,
          })
          resolve({ success: true })
          // Kick EPG + enrichment in background.
          const src = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
          if (src?.server_url) runEpgSync(sqlite, win, sourceId, src)
          kickEnrichment()
        } else if (msg.type === 'warning') {
          win?.webContents.send('sync:progress', {
            sourceId, phase: 'warning', current: 0, total: 0, message: msg.message,
          })
        } else if (msg.type === 'error') {
          win?.webContents.send('sync:progress', {
            sourceId, phase: 'error', current: 0, total: 0, message: msg.message,
          })
          resolve({ success: false, error: msg.message })
        }
      })

      worker.on('error', (err) => {
        activeSyncWorkers.delete(sourceId)
        win?.webContents.send('sync:progress', {
          sourceId, phase: 'error', current: 0, total: 0, message: String(err),
        })
        resolve({ success: false, error: String(err) })
      })

      worker.on('exit', (code) => {
        activeSyncWorkers.delete(sourceId)
        if (code !== 0) resolve({ success: false, error: `Worker exited with code ${code}` })
      })
    })
  })

  // ── Sync cancel ─────────────────────────────────────────────────────────
  ipcMain.handle('sources:sync:cancel', async (event, sourceId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const worker = activeSyncWorkers.get(sourceId)
    if (worker) {
      activeSyncWorkers.delete(sourceId)
      worker.terminate()
      getSqlite().prepare('UPDATE sources SET status = ? WHERE id = ?').run('idle', sourceId)
      win?.webContents.send('sync:progress', { sourceId, phase: 'cancelled', current: 0, total: 0, message: '' })
    }
    return { ok: true }
  })

  // ── EPG ─────────────────────────────────────────────────────────────────
  ipcMain.handle('epg:sync', async (event, sourceId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sqlite = getSqlite()
    const source = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
    if (!source?.server_url) return { success: false, error: 'Source not found' }

    const result = await syncEpg(
      sourceId, source.server_url, source.username, source.password,
      (msg) => win?.webContents.send('epg:progress', { sourceId, message: msg })
    )
    return result.error ? { success: false, ...result } : { success: true, ...result }
  })

  ipcMain.handle('epg:now-next', (_event, contentId: string) => getNowNext(contentId))

  ipcMain.handle('epg:guide', (_event, args: { contentIds: string[]; startTime?: number; endTime?: number }) => {
    const sqlite = getSqlite()
    const now = Math.floor(Date.now() / 1000)
    const startTime = args.startTime ?? (now - 4 * 3600)
    const endTime = args.endTime ?? (now + 20 * 3600)

    if (!args.contentIds?.length) return { channels: [], programmes: {}, windowStart: startTime, windowEnd: endTime }

    const placeholders = args.contentIds.map(() => '?').join(',')
    const rows = sqlite.prepare(`
      SELECT s.id,
             COALESCE(cl.canonical_name, s.title) AS title,
             COALESCE(cl.logo_url, s.thumbnail_url) AS poster_url,
             s.epg_channel_id,
             s.source_id AS primary_source_id,
             s.catchup_supported, s.catchup_days,
             s.stream_id AS external_id
      FROM streams s
      LEFT JOIN canonical_live cl ON cl.id = s.canonical_live_id
      WHERE s.id IN (${placeholders}) AND s.type = 'live'
    `).all(...args.contentIds) as any[]

    const programmes: Record<string, any[]> = {}

    const epgKeyToContentIds: Record<string, string[]> = {}
    const epgChannelIds: string[] = []
    const epgSourceIds: string[] = []
    for (const ch of rows) {
      if (!ch.epg_channel_id) { programmes[ch.id] = []; continue }
      const key = `${ch.epg_channel_id}|${ch.primary_source_id}`
      if (!epgKeyToContentIds[key]) {
        epgKeyToContentIds[key] = []
        epgChannelIds.push(ch.epg_channel_id)
        epgSourceIds.push(ch.primary_source_id)
      }
      epgKeyToContentIds[key].push(ch.id)
    }

    if (epgChannelIds.length > 0) {
      const pairs = epgChannelIds.map(() => `(channel_external_id = ? AND source_id = ?)`).join(' OR ')
      const pairParams: unknown[] = []
      for (let i = 0; i < epgChannelIds.length; i++) pairParams.push(epgChannelIds[i], epgSourceIds[i])
      const epgRows = sqlite.prepare(`
        SELECT channel_external_id, source_id, id, title, description, start_time, end_time, category
        FROM epg
        WHERE (${pairs}) AND end_time > ? AND start_time < ?
        ORDER BY channel_external_id, start_time ASC
      `).all(...pairParams, startTime, endTime) as any[]

      for (const r of epgRows) {
        const key = `${r.channel_external_id}|${r.source_id}`
        const contentIds = epgKeyToContentIds[key]
        if (!contentIds) continue
        const prog = { id: r.id, title: r.title, description: r.description, startTime: r.start_time, endTime: r.end_time, category: r.category }
        for (const cid of contentIds) {
          if (!programmes[cid]) programmes[cid] = []
          programmes[cid].push(prog)
        }
      }
    }

    for (const ch of rows) if (!programmes[ch.id]) programmes[ch.id] = []

    return {
      channels: rows.map((ch) => ({
        contentId: ch.id, title: ch.title, posterUrl: ch.poster_url, sourceId: ch.primary_source_id,
        catchupSupported: !!ch.catchup_supported, catchupDays: ch.catchup_days ?? 0, externalId: ch.external_id,
      })),
      programmes, windowStart: startTime, windowEnd: endTime,
    }
  })

  ipcMain.handle('content:get-catchup-url', async (_event, args: { contentId: string; startTime: number; duration: number }) => {
    const sqlite = getSqlite()
    const stream = sqlite.prepare('SELECT * FROM streams WHERE id = ?').get(args.contentId) as StreamRow | undefined
    if (!stream) return { error: 'Stream not found' }

    const db = getDb()
    const [source] = await db.select().from(sources).where(eq(sources.id, stream.source_id))
    if (!source?.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    const url = xtreamService.buildCatchupUrl(
      source.serverUrl, source.username, source.password,
      stream.stream_id, new Date(args.startTime * 1000), args.duration
    )
    return { url }
  })

  // ── Search ──────────────────────────────────────────────────────────────
  // V3 basic mode: per-type FTS5 lookup against canonical_{vod,series,live}_fts.
  // L4 advanced `@` prefix mode is deferred to Phase F — this handler is the
  // "don't crash, still return decent basic results" stepping stone.
  ipcMain.handle('search:query', async (_event, args: {
    query: string
    type?: 'live' | 'movie' | 'series'
    categoryName?: string
    sourceIds?: string[]
    limit?: number
    offset?: number
  }) => {
    const sqlite = getSqlite()
    const { categoryName, sourceIds, limit = 50, offset = 0 } = args
    const rawQuery = args.query ?? ''

    const enabledSources = (sqlite.prepare(`SELECT id FROM sources WHERE disabled = 0`).all() as { id: string }[]).map(r => r.id)
    const filterIds = sourceIds && sourceIds.length > 0
      ? sourceIds.filter(id => enabledSources.includes(id))
      : enabledSources
    if (!filterIds.length) return { items: [], total: 0 }

    // Parse query — determines basic vs advanced mode (L4).
    const parsed = parseQuery(rawQuery)

    // Effective type: advanced typeFilter overrides the UI type tab if set.
    const effectiveType: 'live' | 'movie' | 'series' | undefined =
      (parsed.isAdvanced && parsed.typeFilter) ? parsed.typeFilter : args.type

    // Empty query (or @ with nothing else) → browse path.
    if (!parsed.titleQuery && !parsed.langFilter && !parsed.yearFilter && !parsed.typeFilter) {
      return runBrowseSearch(effectiveType, categoryName, filterIds, limit, offset)
    }

    if (parsed.isAdvanced) {
      return runAdvancedSearch(
        sqlite, parsed, effectiveType, categoryName, filterIds, limit, offset
      )
    }

    // ── Basic mode (L4): FTS5 on canonical only, hide unmatched ────────────
    const ftsExpr = buildFtsExpression(rawQuery)
    if (!ftsExpr) return runBrowseSearch(effectiveType, categoryName, filterIds, limit, offset)

    // Fetch up to SEARCH_TOTAL_CAP internally to get accurate total, then page-slice.
    const all: unknown[] = []

    if (!effectiveType || effectiveType === 'movie') {
      all.push(...queryStreamsByFts(
        sqlite, 'canonical_vod_fts', 'canonical_vod_id', 'movie',
        ftsExpr, filterIds, categoryName, SEARCH_TOTAL_CAP
      ))
    }
    if (!effectiveType || effectiveType === 'series') {
      all.push(...querySeriesByFts(sqlite, ftsExpr, filterIds, categoryName, SEARCH_TOTAL_CAP))
    }
    if (!effectiveType || effectiveType === 'live') {
      all.push(...queryStreamsByFts(
        sqlite, 'canonical_live_fts', 'canonical_live_id', 'live',
        ftsExpr, filterIds, categoryName, SEARCH_TOTAL_CAP
      ))
    }

    // LIKE fallback only if FTS returned nothing (special chars, unindexed titles).
    if (all.length === 0) {
      const fallback = runLikeFallback(effectiveType, parsed.titleQuery || rawQuery.trim(), categoryName, filterIds, SEARCH_TOTAL_CAP)
      return { items: fallback.slice(offset, offset + limit), total: fallback.length }
    }

    return { items: all.slice(offset, offset + limit), total: all.length }
  })

  // ── Content ─────────────────────────────────────────────────────────────
  ipcMain.handle('content:get', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    // Try streams first (movie/live/episode), then series_sources.
    const streamRow = sqlite.prepare(`
      SELECT ${STREAM_SELECT},
        GROUP_CONCAT(DISTINCT cat.name) AS category_name
      FROM streams s
      ${STREAM_JOINS}
      LEFT JOIN stream_categories sc ON sc.stream_id = s.id
      LEFT JOIN categories cat ON cat.id = sc.category_id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(contentId)
    if (streamRow) return streamRow

    const seriesRow = sqlite.prepare(`
      SELECT ${SERIES_SELECT},
        GROUP_CONCAT(DISTINCT cat.name) AS category_name
      FROM series_sources ss
      LEFT JOIN canonical_series cs ON cs.id = ss.canonical_series_id
      LEFT JOIN series_source_categories ssc ON ssc.series_source_id = ss.id
      LEFT JOIN categories cat ON cat.id = ssc.category_id
      WHERE ss.id = ?
      GROUP BY ss.id
    `).get(contentId)
    return seriesRow ?? null
  })

  ipcMain.handle('content:get-stream-url', async (_event, args: { contentId: string; sourceId?: string }) => {
    const db = getDb()
    const sqlite = getSqlite()

    const stream = sqlite.prepare('SELECT * FROM streams WHERE id = ?').get(args.contentId) as StreamRow | undefined
    if (!stream) return { error: 'Content not found' }

    const sourceId = args.sourceId ?? stream.source_id
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId))
    if (!source) return { error: 'No stream source found' }

    // M3U sources: stream_url is stored directly on the streams row.
    if (source.type === 'm3u') {
      if (!stream.stream_url) return { error: 'Stream URL missing for M3U content' }
      return { url: stream.stream_url, sourceId: source.id }
    }

    if (!source.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    const streamType = stream.type === 'live' ? 'live' : stream.type === 'episode' ? 'series' : 'movie'
    const url = xtreamService.buildStreamUrl(
      source.serverUrl, source.username, source.password,
      streamType, stream.stream_id, stream.container_extension
    )
    return { url, sourceId: source.id }
  })

  // series:get-info — lazy-fetches season/episode list from Xtream and
  // persists episodes into the V3 `episodes` + `streams` (type='episode')
  // tables so playback and position tracking work.
  ipcMain.handle('series:get-info', async (_event, args: { contentId: string }) => {
    const db = getDb()
    const sqlite = getSqlite()

    const seriesRow = sqlite.prepare('SELECT * FROM series_sources WHERE id = ?').get(args.contentId) as SeriesSourceRow | undefined
    if (!seriesRow) return { error: 'Content not found' }

    const [source] = await db.select().from(sources).where(eq(sources.id, seriesRow.source_id))
    if (!source?.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    try {
      const info = await xtreamService.getSeriesInfo(source.serverUrl, source.username, source.password, seriesRow.series_external_id)
      const canonicalSeriesId = seriesRow.canonical_series_id

      // Upsert episodes (unique by canonical_series_id + season + episode).
      const upsertEpisode = sqlite.prepare(`
        INSERT INTO episodes (canonical_series_id, season, episode, title, air_date)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(canonical_series_id, season, episode) DO UPDATE SET
          title    = COALESCE(excluded.title, episodes.title),
          air_date = COALESCE(excluded.air_date, episodes.air_date)
        RETURNING id
      `)
      const selectEpisode = sqlite.prepare(`
        SELECT id FROM episodes WHERE canonical_series_id = ? AND season = ? AND episode = ?
      `)
      const upsertEpisodeStream = sqlite.prepare(`
        INSERT INTO streams (
          id, source_id, type, stream_id, title, container_extension, episode_id
        ) VALUES (?, ?, 'episode', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          container_extension = excluded.container_extension,
          episode_id = excluded.episode_id
      `)

      const tx = sqlite.transaction((seasons: Record<string, any[]>) => {
        for (const [, eps] of Object.entries(seasons)) {
          for (const ep of eps) {
            const season  = Number(ep.season ?? ep.season_number ?? 0)
            const epNum   = Number(ep.episode_num ?? ep.episode ?? 0)
            const epTitle = ep.title ?? `S${season}E${epNum}`

            let episodeId: number | undefined
            try {
              const r = upsertEpisode.get(canonicalSeriesId, season, epNum, epTitle, ep.air_date ?? null) as { id?: number } | undefined
              episodeId = r?.id
            } catch { /* RETURNING may not fire on UPDATE path in older sqlite */ }
            if (!episodeId) {
              const r = selectEpisode.get(canonicalSeriesId, season, epNum) as { id?: number } | undefined
              episodeId = r?.id
            }
            if (!episodeId) continue

            const streamId = `${source.id}:episode:${ep.id}`
            upsertEpisodeStream.run(
              streamId, source.id, String(ep.id), epTitle,
              ep.container_extension ?? 'mkv', episodeId
            )
          }
        }
      })
      tx(info.seasons ?? {})

      return { ...info, sourceId: source.id, serverUrl: source.serverUrl, username: source.username, password: source.password }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── User data ──────────────────────────────────────────────────────────
  // Routing by kind:
  //   movie  → canonical_vod_user_data    (favorite/watchlist/rating)
  //   series → canonical_series_user_data (favorite/watchlist/rating)
  //   episode→ stream_user_data           (position/completed)
  //   live   → channel_user_data          (favorite per-stream)
  // watch_position + last_watched_at always live on stream_user_data
  // (keyed by streams.id), regardless of kind.

  ipcMain.handle('user:get-data', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const ref = resolveContent(sqlite, contentId)
    if (!ref) return null
    return readUserData(sqlite, ref, contentId)
  })

  ipcMain.handle('user:set-position', async (_event, args: { contentId: string; position: number }) => {
    const sqlite = getSqlite()
    const ref = resolveContent(sqlite, args.contentId)
    if (!ref?.stream) return { success: false }
    sqlite.prepare(`
      INSERT INTO stream_user_data (profile_id, stream_id, watch_position, last_watched_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(profile_id, stream_id) DO UPDATE SET
        watch_position  = excluded.watch_position,
        last_watched_at = excluded.last_watched_at
    `).run(DEFAULT_PROFILE, ref.stream.id, args.position)
    return { success: true }
  })

  ipcMain.handle('user:toggle-favorite', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const ref = resolveContent(sqlite, contentId)
    if (!ref) return { favorite: false }
    return { favorite: toggleFavorite(sqlite, ref) }
  })

  ipcMain.handle('user:toggle-watchlist', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const ref = resolveContent(sqlite, contentId)
    if (!ref) return { watchlist: false }
    return { watchlist: toggleWatchlist(sqlite, ref) }
  })

  ipcMain.handle('user:favorites', async (_event, args?: { type?: 'live' | 'movie' | 'series' }) => {
    const sqlite = getSqlite()
    return listFavorites(sqlite, args?.type)
  })

  ipcMain.handle('user:reorder-favorites', async (_event, order: { contentId: string; sortOrder: number }[]) => {
    const sqlite = getSqlite()
    const updateVod    = sqlite.prepare(`UPDATE canonical_vod_user_data    SET fav_sort_order = ? WHERE profile_id = ? AND canonical_vod_id = ?`)
    const updateSeries = sqlite.prepare(`UPDATE canonical_series_user_data SET fav_sort_order = ? WHERE profile_id = ? AND canonical_series_id = ?`)
    const updateChan   = sqlite.prepare(`UPDATE channel_user_data          SET fav_sort_order = ? WHERE profile_id = ? AND stream_id = ?`)
    const runAll = sqlite.transaction((items: typeof order) => {
      for (const { contentId, sortOrder } of items) {
        const ref = resolveContent(sqlite, contentId)
        if (!ref) continue
        if (ref.kind === 'movie'  && ref.canonicalVodId)    updateVod.run(sortOrder, DEFAULT_PROFILE, ref.canonicalVodId)
        else if (ref.kind === 'series' && ref.canonicalSeriesId) updateSeries.run(sortOrder, DEFAULT_PROFILE, ref.canonicalSeriesId)
        else if (ref.kind === 'live'   && ref.stream)           updateChan.run(sortOrder, DEFAULT_PROFILE, ref.stream.id)
      }
    })
    runAll(order)
    return { ok: true }
  })

  // ── Channels (live-specific user data, keyed per stream) ──────────────
  ipcMain.handle('channels:favorites', async (_event, args?: { profileId?: string }) => {
    const sqlite = getSqlite()
    const profileId = args?.profileId ?? DEFAULT_PROFILE
    return sqlite.prepare(`
      SELECT ${STREAM_SELECT},
        cud.fav_sort_order                    AS fav_sort_order,
        sud.last_watched_at                   AS last_watched_at,
        1                                      AS favorite
      FROM channel_user_data cud
      JOIN streams s ON s.id = cud.stream_id
      JOIN sources src ON src.id = s.source_id AND src.disabled = 0
      ${STREAM_JOINS}
      LEFT JOIN stream_user_data sud ON sud.stream_id = s.id AND sud.profile_id = ?
      WHERE cud.is_favorite = 1 AND cud.profile_id = ? AND s.type = 'live'
      ORDER BY COALESCE(cud.fav_sort_order, 999999) ASC, sud.last_watched_at DESC
    `).all(profileId, profileId)
  })

  ipcMain.handle('channels:toggle-favorite', async (_event, streamId: string) => {
    const sqlite = getSqlite()
    // The renderer still calls this with item.id — which in V3 is a stream id
    // for live channels. Keep parameter name as canonicalId in preload for
    // backward compat, but treat it as a stream id here.
    const stream = sqlite.prepare('SELECT id FROM streams WHERE id = ?').get(streamId) as { id?: string } | undefined
    if (!stream?.id) return { favorite: false }
    sqlite.prepare(`
      INSERT INTO channel_user_data (profile_id, stream_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, stream_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, stream.id)
    const row = sqlite.prepare(`SELECT is_favorite FROM channel_user_data WHERE profile_id = ? AND stream_id = ?`).get(DEFAULT_PROFILE, stream.id) as { is_favorite?: number } | undefined
    return { favorite: !!row?.is_favorite }
  })

  ipcMain.handle('channels:reorder-favorites', async (_event, order: { canonicalId: string; sortOrder: number }[]) => {
    const sqlite = getSqlite()
    const update = sqlite.prepare(`UPDATE channel_user_data SET fav_sort_order = ? WHERE profile_id = ? AND stream_id = ?`)
    const runAll = sqlite.transaction((items: typeof order) => {
      for (const { canonicalId, sortOrder } of items) update.run(sortOrder, DEFAULT_PROFILE, canonicalId)
    })
    runAll(order)
    return { ok: true }
  })

  ipcMain.handle('channels:get-data', async (_event, streamId: string) => {
    const sqlite = getSqlite()
    const fav = sqlite.prepare(`SELECT is_favorite FROM channel_user_data WHERE profile_id = ? AND stream_id = ?`).get(DEFAULT_PROFILE, streamId) as { is_favorite?: number } | undefined
    const sud = sqlite.prepare(`SELECT watch_position, completed FROM stream_user_data WHERE profile_id = ? AND stream_id = ?`).get(DEFAULT_PROFILE, streamId) as { watch_position?: number; completed?: number } | undefined
    return {
      favorite:    !!fav?.is_favorite,
      watchlisted: false,
      rating:      null,
      position:    sud?.watch_position ?? 0,
      completed:   !!sud?.completed,
    }
  })

  ipcMain.handle('user:watchlist', async (_event, args?: { type?: 'live' | 'movie' | 'series' }) => {
    const sqlite = getSqlite()
    return listWatchlist(sqlite, args?.type)
  })

  ipcMain.handle('user:continue-watching', async (_event, args?: { type?: 'movie' | 'series' }) => {
    const sqlite = getSqlite()
    return listContinueWatching(sqlite, args?.type)
  })

  ipcMain.handle('user:history', async (_event, args?: { limit?: number }) => {
    const sqlite = getSqlite()
    return listHistory(sqlite, args?.limit ?? 50)
  })

  ipcMain.handle('user:bulk-get-data', async (_event, contentIds: string[]) => {
    const sqlite = getSqlite()
    if (!contentIds.length) return {}
    const result: Record<string, any> = {}
    for (const id of contentIds) {
      const ref = resolveContent(sqlite, id)
      if (!ref) continue
      const data = readUserData(sqlite, ref, id)
      if (data) result[id] = data
    }
    return result
  })

  ipcMain.handle('user:set-completed', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const ref = resolveContent(sqlite, contentId)
    if (!ref?.stream) return { success: false }
    sqlite.prepare(`
      INSERT INTO stream_user_data (profile_id, stream_id, completed, watch_position, last_watched_at)
      VALUES (?, ?, 1, 0, unixepoch())
      ON CONFLICT(profile_id, stream_id) DO UPDATE SET
        completed = 1, watch_position = 0, last_watched_at = unixepoch()
    `).run(DEFAULT_PROFILE, ref.stream.id)
    return { success: true }
  })

  ipcMain.handle('user:set-rating', async (_event, args: { contentId: string; rating: number | null }) => {
    const sqlite = getSqlite()
    const ref = resolveContent(sqlite, args.contentId)
    if (!ref) return { success: false }
    if (ref.kind === 'movie' && ref.canonicalVodId) {
      sqlite.prepare(`
        INSERT INTO canonical_vod_user_data (profile_id, canonical_vod_id, rating)
        VALUES (?, ?, ?)
        ON CONFLICT(profile_id, canonical_vod_id) DO UPDATE SET rating = excluded.rating
      `).run(DEFAULT_PROFILE, ref.canonicalVodId, args.rating)
      return { success: true }
    }
    if (ref.kind === 'series' && ref.canonicalSeriesId) {
      sqlite.prepare(`
        INSERT INTO canonical_series_user_data (profile_id, canonical_series_id, rating)
        VALUES (?, ?, ?)
        ON CONFLICT(profile_id, canonical_series_id) DO UPDATE SET rating = excluded.rating
      `).run(DEFAULT_PROFILE, ref.canonicalSeriesId, args.rating)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle('user:clear-continue', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const ref = resolveContent(sqlite, contentId)
    if (!ref?.stream) return { success: false }
    sqlite.prepare(`
      UPDATE stream_user_data SET watch_position = 0, completed = 1
      WHERE profile_id = ? AND stream_id = ?
    `).run(DEFAULT_PROFILE, ref.stream.id)
    return { success: true }
  })

  ipcMain.handle('user:clear-item-history', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const ref = resolveContent(sqlite, contentId)
    if (!ref?.stream) return { success: false }
    sqlite.prepare(`
      UPDATE stream_user_data SET watch_position = 0, last_watched_at = NULL, completed = 0
      WHERE profile_id = ? AND stream_id = ?
    `).run(DEFAULT_PROFILE, ref.stream.id)
    return { success: true }
  })

  ipcMain.handle('user:clear-history', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE stream_user_data SET watch_position = 0, last_watched_at = NULL, completed = 0`).run()
    return { success: true }
  })

  ipcMain.handle('user:clear-favorites', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE canonical_vod_user_data    SET is_favorite = 0, is_watchlisted = 0`).run()
    sqlite.prepare(`UPDATE canonical_series_user_data SET is_favorite = 0, is_watchlisted = 0`).run()
    sqlite.prepare(`UPDATE channel_user_data          SET is_favorite = 0`).run()
    return { success: true }
  })

  ipcMain.handle('user:clear-all-data', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`DELETE FROM canonical_vod_user_data`).run()
    sqlite.prepare(`DELETE FROM canonical_series_user_data`).run()
    sqlite.prepare(`DELETE FROM stream_user_data`).run()
    sqlite.prepare(`DELETE FROM channel_user_data`).run()
    return { success: true }
  })

  // ── Diagnostic ────────────────────────────────────────────────────────
  ipcMain.handle('debug:category-items', async (_event, categoryNameSearch: string) => {
    const sqlite = getSqlite()
    const cats = sqlite.prepare(`
      SELECT cat.*, s.name as source_name
      FROM categories cat
      JOIN sources s ON s.id = cat.source_id
      WHERE cat.name LIKE ?
      ORDER BY cat.name
    `).all(`%${categoryNameSearch}%`) as any[]

    const results: any[] = []
    for (const cat of cats) {
      const catId = `${cat.source_id}:${cat.type}:${cat.external_id}`
      const streamItems = sqlite.prepare(`
        SELECT s.id, s.title, s.stream_id AS external_id, s.type, s.source_id AS primary_source_id
        FROM stream_categories sc
        JOIN streams s ON s.id = sc.stream_id
        WHERE sc.category_id = ?
      `).all(catId) as any[]
      const seriesItems = sqlite.prepare(`
        SELECT ss.id, ss.title, ss.series_external_id AS external_id, 'series' AS type, ss.source_id AS primary_source_id
        FROM series_source_categories ssc
        JOIN series_sources ss ON ss.id = ssc.series_source_id
        WHERE ssc.category_id = ?
      `).all(catId) as any[]

      const items = [...streamItems, ...seriesItems]
      results.push({
        categoryName: cat.name,
        categoryExternalId: cat.external_id,
        sourceId: cat.source_id,
        sourceName: cat.source_name,
        type: cat.type,
        actualItems: items.length,
        items: items.map((i: any) => ({ id: i.id, title: i.title, externalId: i.external_id })),
      })
    }
    return results
  })

  // ── Settings (key-value) ─────────────────────────────────────────────
  ipcMain.handle('settings:get', (_event, key: string) => getSetting(key))

  // ── Enrichment — V3 keyless pipeline stubs ───────────────────────────
  // The TMDB-powered enrichment UI is deprecated in V3. The keyless
  // enrichment worker runs automatically on boot and after every sync.
  // These stubs keep the renderer's existing calls non-fatal until the
  // Phase G UI rewrite replaces them.
  const deprecatedEnrichment = (opName: string) => () => ({
    success: false,
    error: `${opName} is deprecated in V3 — keyless enrichment runs automatically.`,
  })

  ipcMain.handle('enrichment:set-api-key',  () => ({ success: true })) // no-op
  ipcMain.handle('enrichment:status', () => {
    const sqlite = getSqlite()
    const total    = (sqlite.prepare(`SELECT COUNT(*) as n FROM canonical_vod`).get() as CountRow).n
                   + (sqlite.prepare(`SELECT COUNT(*) as n FROM canonical_series`).get() as CountRow).n
    const resolved = (sqlite.prepare(`SELECT COUNT(*) as n FROM canonical_vod    WHERE oracle_status = 'resolved'`).get() as CountRow).n
                   + (sqlite.prepare(`SELECT COUNT(*) as n FROM canonical_series WHERE oracle_status = 'resolved'`).get() as CountRow).n
    return { total, enriched: resolved, pending: total - resolved }
  })
  ipcMain.handle('enrichment:enrich-single', deprecatedEnrichment('enrich-single'))
  ipcMain.handle('enrichment:enrich-manual', deprecatedEnrichment('enrich-manual'))
  ipcMain.handle('enrichment:search-tmdb',   deprecatedEnrichment('search-tmdb'))
  ipcMain.handle('enrichment:enrich-by-id',  deprecatedEnrichment('enrich-by-id'))
  ipcMain.handle('enrichment:start', async () => {
    kickEnrichment()
    return { success: true, message: 'Keyless enrichment kicked' }
  })

  // ── Categories ────────────────────────────────────────────────────────
  ipcMain.handle('categories:list', (_event, args: {
    type?: 'live' | 'movie' | 'series'
    sourceIds?: string[]
  }) => {
    const sqlite = getSqlite()
    const enabledSources = (sqlite.prepare(`SELECT id FROM sources WHERE disabled = 0`).all() as { id: string }[]).map(r => r.id)
    const filterIds = args.sourceIds?.length
      ? args.sourceIds.filter(id => enabledSources.includes(id))
      : enabledSources
    if (!filterIds.length) return []

    const inList = filterIds.map(() => '?').join(',')
    const typeFilter = args.type ? `AND cat.type = ?` : ''
    const typeParam: unknown[] = args.type ? [args.type] : []

    // Count items across both `stream_categories` and `series_source_categories`
    // so series parents contribute to their categories.
    const sql = `
      SELECT
        cat.name,
        cat.type,
        GROUP_CONCAT(DISTINCT cat.source_id) AS source_ids,
        (
          COALESCE((SELECT COUNT(DISTINCT sc.stream_id)        FROM stream_categories sc        WHERE sc.category_id = cat.id), 0) +
          COALESCE((SELECT COUNT(DISTINCT ssc.series_source_id) FROM series_source_categories ssc WHERE ssc.category_id = cat.id), 0)
        ) AS item_count,
        MIN(cat.content_synced) AS needs_sync,
        MIN(cat.position)       AS position
      FROM categories cat
      WHERE cat.source_id IN (${inList})
      ${typeFilter}
      GROUP BY cat.name, cat.type
      HAVING item_count > 0 OR MIN(cat.content_synced) = 0
      ORDER BY item_count DESC
    `
    return sqlite.prepare(sql).all(...filterIds, ...typeParam)
  })

  // ── Browse ────────────────────────────────────────────────────────────
  ipcMain.handle('content:browse', async (_event, args: {
    type?: 'live' | 'movie' | 'series'
    categoryName?: string
    sourceIds?: string[]
    sortBy?: 'title' | 'year' | 'rating' | 'updated'
    sortDir?: 'asc' | 'desc'
    limit?: number
    offset?: number
  }) => {
    const sqlite = getSqlite()
    const { type, categoryName, sortBy = 'updated', sortDir = 'desc', limit = 60, offset = 0 } = args

    const enabledSources = (sqlite.prepare(`SELECT id FROM sources WHERE disabled = 0`).all() as { id: string }[]).map(r => r.id)
    const filterIds = args.sourceIds?.length
      ? args.sourceIds.filter(id => enabledSources.includes(id))
      : enabledSources
    if (!filterIds.length) return { items: [], total: 0 }

    return runBrowseSearch(type, categoryName, filterIds, limit, offset, sortBy, sortDir)
  })

  // ── External player ───────────────────────────────────────────────────
  ipcMain.handle('player:open-external', async (_event, args: {
    player: 'mpv' | 'vlc'; url: string; title: string; customPath?: string
  }) => {
    const { player, url, title, customPath } = args
    const execPath = customPath || (player === 'mpv' ? findMpv() : findVlc())
    const spawnArgs = player === 'mpv'
      ? [`--force-media-title=${title}`, url]
      : [url, `:meta-title=${title}`]

    try {
      const proc = spawn(execPath, spawnArgs, { detached: true, stdio: 'ignore' })
      proc.unref()
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('player:detect-external', () => ({ mpv: findMpv(), vlc: findVlc() }))

  // ── Window ────────────────────────────────────────────────────────────
  ipcMain.handle('window:toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setFullScreen(!win.isFullScreen())
  })

  ipcMain.handle('window:is-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFullScreen() ?? false
  })
}

// ─── Helpers: browse + search ─────────────────────────────────────────────

function buildFtsExpression(rawQuery: string): string | null {
  const quotedMatch = rawQuery.match(/^"(.+)"$/)
  if (quotedMatch) {
    const phrase = normalizeForSearch(quotedMatch[1]).replace(/"/g, '""')
    return `"${phrase}"`
  }
  const tokens: { word: string; exact: boolean }[] = []
  const tokenRegex = /(\S+)(\s|$)/g
  const normalizedRaw = normalizeForSearch(rawQuery)
  let match: RegExpExecArray | null
  while ((match = tokenRegex.exec(normalizedRaw)) !== null) {
    const word = match[1].replace(/[(){}*"^+\-]/g, '')
    if (!word) continue
    const hasTrailingSpace = match[2] === ' ' || (match.index + match[0].length < normalizedRaw.length)
    tokens.push({ word, exact: hasTrailingSpace })
  }
  if (tokens.length === 0) return null
  return tokens.map(t => t.exact ? t.word.replace(/"/g, '""') : `${t.word}*`).join(' AND ')
}

function queryStreamsByFts(
  sqlite: ReturnType<typeof getSqlite>,
  ftsTable: 'canonical_vod_fts' | 'canonical_live_fts',
  fkColumn: 'canonical_vod_id' | 'canonical_live_id',
  streamType: 'movie' | 'live',
  ftsQuery: string,
  filterIds: string[],
  categoryName: string | undefined,
  limit: number
): unknown[] {
  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN stream_categories sc ON sc.stream_id = s.id JOIN categories cat ON cat.id = sc.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  try {
    return sqlite.prepare(`
      SELECT ${STREAM_SELECT}
      FROM ${ftsTable} fts
      JOIN streams s ON s.${fkColumn} = fts.canonical_id AND s.type = ?
      ${STREAM_JOINS}
      ${catJoin}
      WHERE ${ftsTable} MATCH ?
        AND s.source_id IN (${sourceList})
      ORDER BY fts.rank
      LIMIT ?
    `).all(streamType, ...catParams, ftsQuery, ...filterIds, limit)
  } catch (err) {
    console.warn(`[search] FTS failed on ${ftsTable}:`, (err as Error).message)
    return []
  }
}

function querySeriesByFts(
  sqlite: ReturnType<typeof getSqlite>,
  ftsQuery: string,
  filterIds: string[],
  categoryName: string | undefined,
  limit: number
): unknown[] {
  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN series_source_categories ssc ON ssc.series_source_id = ss.id JOIN categories cat ON cat.id = ssc.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  try {
    return sqlite.prepare(`
      SELECT ${SERIES_SELECT}
      FROM canonical_series_fts fts
      JOIN canonical_series cs ON cs.id = fts.canonical_id
      JOIN series_sources ss ON ss.canonical_series_id = cs.id
      ${catJoin}
      WHERE canonical_series_fts MATCH ?
        AND ss.source_id IN (${sourceList})
      ORDER BY fts.rank
      LIMIT ?
    `).all(...catParams, ftsQuery, ...filterIds, limit)
  } catch (err) {
    console.warn(`[search] FTS failed on canonical_series_fts:`, (err as Error).message)
    return []
  }
}

function runLikeFallback(
  type: 'live' | 'movie' | 'series' | undefined,
  query: string,
  categoryName: string | undefined,
  filterIds: string[],
  limit: number
): unknown[] {
  const sqlite = getSqlite()
  const sourceList = filterIds.map(() => '?').join(',')
  const words = query.split(/\s+/).filter(Boolean)
  const likeParams = words.map(w => `%${w}%`)
  const likeConds = words.map(() => `s.title LIKE ?`).join(' AND ') || `1=1`

  const results: unknown[] = []

  if (!type || type !== 'series') {
    const typeConds = type ? `AND s.type = ?` : `AND s.type IN ('live','movie')`
    const typeParams: unknown[] = type ? [type] : []
    const catJoin = categoryName
      ? `JOIN stream_categories sc ON sc.stream_id = s.id JOIN categories cat ON cat.id = sc.category_id AND cat.name = ?`
      : ''
    const catParams: unknown[] = categoryName ? [categoryName] : []
    const rows = sqlite.prepare(`
      SELECT ${STREAM_SELECT}
      FROM streams s
      ${STREAM_JOINS}
      ${catJoin}
      WHERE ${likeConds} ${typeConds} AND s.source_id IN (${sourceList})
      ORDER BY s.added_at DESC
      LIMIT ?
    `).all(...catParams, ...likeParams, ...typeParams, ...filterIds, limit) as unknown[]
    results.push(...rows)
  }

  if (!type || type === 'series') {
    const likeSeriesConds = words.map(() => `ss.title LIKE ?`).join(' AND ') || `1=1`
    const catJoin = categoryName
      ? `JOIN series_source_categories ssc ON ssc.series_source_id = ss.id JOIN categories cat ON cat.id = ssc.category_id AND cat.name = ?`
      : ''
    const catParams: unknown[] = categoryName ? [categoryName] : []
    const rows = sqlite.prepare(`
      SELECT ${SERIES_SELECT}
      FROM series_sources ss
      LEFT JOIN canonical_series cs ON cs.id = ss.canonical_series_id
      ${catJoin}
      WHERE ${likeSeriesConds} AND ss.source_id IN (${sourceList})
      ORDER BY ss.added_at DESC
      LIMIT ?
    `).all(...catParams, ...likeParams, ...filterIds, limit) as unknown[]
    results.push(...rows)
  }

  return results.slice(0, limit)
}

function runBrowseSearch(
  type: 'live' | 'movie' | 'series' | undefined,
  categoryName: string | undefined,
  filterIds: string[],
  limit: number,
  offset: number,
  sortBy: 'title' | 'year' | 'rating' | 'updated' = 'updated',
  sortDir: 'asc' | 'desc' = 'desc'
): { items: unknown[], total: number } {
  const sqlite = getSqlite()
  const sourceList = filterIds.map(() => '?').join(',')
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC'

  const streamSortCol: Record<string, string> = {
    title:  's.title',
    year:   `COALESCE(cv.year, cs.year)`,
    rating: 's.added_at',
    updated:'s.added_at',
  }
  const seriesSortCol: Record<string, string> = {
    title:  'ss.title',
    year:   'cs.year',
    rating: 'ss.added_at',
    updated:'ss.added_at',
  }

  if (type === 'series') {
    const catJoin = categoryName
      ? `JOIN series_source_categories ssc ON ssc.series_source_id = ss.id JOIN categories cat ON cat.id = ssc.category_id AND cat.name = ?`
      : ''
    const catParams: unknown[] = categoryName ? [categoryName] : []
    const total = (sqlite.prepare(`
      SELECT COUNT(*) as cnt
      FROM series_sources ss
      LEFT JOIN canonical_series cs ON cs.id = ss.canonical_series_id
      ${catJoin}
      WHERE ss.source_id IN (${sourceList})
    `).get(...catParams, ...filterIds) as { cnt: number }).cnt
    const items = sqlite.prepare(`
      SELECT ${SERIES_SELECT}
      FROM series_sources ss
      LEFT JOIN canonical_series cs ON cs.id = ss.canonical_series_id
      ${catJoin}
      WHERE ss.source_id IN (${sourceList})
      ORDER BY ${seriesSortCol[sortBy] ?? 'ss.added_at'} ${dir}
      LIMIT ? OFFSET ?
    `).all(...catParams, ...filterIds, limit, offset) as unknown[]
    return { items, total }
  }

  // Movies / Live / All (streams only).
  const typeFilter = type ? `AND s.type = ?` : `AND s.type IN ('live','movie','episode')`
  const typeParams: unknown[] = type ? [type] : []
  const catJoin = categoryName
    ? `JOIN stream_categories sc ON sc.stream_id = s.id JOIN categories cat ON cat.id = sc.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  const total = (sqlite.prepare(`
    SELECT COUNT(*) as cnt
    FROM streams s
    ${catJoin}
    WHERE s.source_id IN (${sourceList}) ${typeFilter}
  `).get(...catParams, ...filterIds, ...typeParams) as { cnt: number }).cnt
  const items = sqlite.prepare(`
    SELECT ${STREAM_SELECT}
    FROM streams s
    ${STREAM_JOINS}
    ${catJoin}
    WHERE s.source_id IN (${sourceList}) ${typeFilter}
    ORDER BY ${streamSortCol[sortBy] ?? 's.added_at'} ${dir}
    LIMIT ? OFFSET ?
  `).all(...catParams, ...filterIds, ...typeParams, limit, offset) as unknown[]
  return { items, total }
}

/**
 * Advanced search (L4 @ prefix).
 *
 * Differences from basic:
 *   1. Title query comes from parser's `titleTokens`, not the raw string.
 *   2. Language filter applied as WHERE `s.language_hint = ?`.
 *   3. Year filter applied as soft ORDER BY boost (L5) — not a WHERE clause.
 *      Items within ±1 year of yearFilter rank above others.
 *   4. Type filter overrides the UI type tab.
 *   5. L6 dual-interpretation: if yearFilter is set, the title query already
 *      contains the year token (parser kept it). We run one merged query and
 *      deduplicate. The year-as-title path is covered by FTS naturally.
 *   6. LIKE fallback covers unmatched streams (null canonical_*_id) too,
 *      making unmatched content visible in advanced mode per L4.
 */
function runAdvancedSearch(
  sqlite: ReturnType<typeof getSqlite>,
  parsed: ReturnType<typeof parseQuery>,
  effectiveType: 'live' | 'movie' | 'series' | undefined,
  categoryName: string | undefined,
  filterIds: string[],
  limit: number,
  offset: number = 0
): { items: unknown[], total: number } {
  const { langFilter, yearFilter, titleQuery, ambiguousLoneToken } = parsed

  // Build FTS expression from parsed titleTokens.
  // Use the same buildFtsExpression as basic mode — AND semantics, normalized,
  // proven to work. The parser already stripped @, classified filters; titleQuery
  // is just the clean remainder.
  const ftsExpr = titleQuery ? buildFtsExpression(titleQuery) : null

  // L6 ambiguous-collision: when the user typed a lone lang/type token
  // (e.g. `@hu`, `@live`), the FTS query and the lang/type filter come from
  // the SAME token. ANDing them returns near-empty intersections. Instead,
  // run BOTH interpretations independently and merge:
  //   - Title-only: FTS for "hu*" with NO lang filter
  //   - Lang-only:  all rows where language_hint='hu'
  // Caller-side dedup happens via the seen-id set below.
  const ftsLangFilter = ambiguousLoneToken ? null : langFilter

  const results: unknown[] = []
  const seen = new Set<string>()
  const push = (rows: unknown[]) => {
    for (const row of rows) {
      const id = (row as { id?: string }).id
      if (id && !seen.has(id)) {
        seen.add(id)
        results.push(row)
      }
    }
  }

  if (!effectiveType || effectiveType === 'movie') {
    if (ftsExpr) {
      push(queryStreamsByFtsAdvanced(
        sqlite, 'canonical_vod_fts', 'canonical_vod_id', 'movie',
        ftsExpr, ftsLangFilter, yearFilter, filterIds, categoryName, limit
      ))
    }
    if (!ftsExpr || ambiguousLoneToken) {
      push(queryStreamsByLangYear(
        sqlite, 'movie', langFilter, yearFilter, filterIds, categoryName, limit
      ))
    }
  }

  if (!effectiveType || effectiveType === 'series') {
    if (ftsExpr) {
      push(querySeriesByFtsAdvanced(
        sqlite, ftsExpr, ftsLangFilter, yearFilter, filterIds, categoryName, limit
      ))
    }
    if (!ftsExpr || ambiguousLoneToken) {
      push(querySeriesByLangYear(
        sqlite, langFilter, yearFilter, filterIds, categoryName, limit
      ))
    }
  }

  if (!effectiveType || effectiveType === 'live') {
    if (ftsExpr) {
      push(queryStreamsByFtsAdvanced(
        sqlite, 'canonical_live_fts', 'canonical_live_id', 'live',
        ftsExpr, ftsLangFilter, null /* year irrelevant for live */, filterIds, categoryName, limit
      ))
    }
    if (!ftsExpr || ambiguousLoneToken) {
      push(queryStreamsByLangYear(
        sqlite, 'live', langFilter, null, filterIds, categoryName, limit
      ))
    }
  }

  // LIKE fallback — includes unmatched streams (advanced mode shows everything, L4).
  // For ambiguous lone tokens (@hu), always run LIKE regardless of prior results:
  // the union of (lang filter) ∪ (title LIKE) must be ≥ either alone.
  // For normal advanced queries, only run when FTS found nothing.
  if ((ambiguousLoneToken || results.length === 0) && titleQuery) {
    push(runAdvancedLikeFallback(
      sqlite, titleQuery, effectiveType, ambiguousLoneToken ? null : langFilter, filterIds, categoryName, SEARCH_TOTAL_CAP
    ))
  }

  return { items: results.slice(offset, offset + limit), total: results.length }
}

/** FTS + lang/year filters for streams (movies or live). */
function queryStreamsByFtsAdvanced(
  sqlite: ReturnType<typeof getSqlite>,
  ftsTable: 'canonical_vod_fts' | 'canonical_live_fts',
  fkColumn: 'canonical_vod_id' | 'canonical_live_id',
  streamType: 'movie' | 'live',
  ftsQuery: string,
  langFilter: string | null,
  yearFilter: number | null,
  filterIds: string[],
  categoryName: string | undefined,
  limit: number
): unknown[] {
  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN stream_categories sc ON sc.stream_id = s.id JOIN categories cat ON cat.id = sc.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  const langCond  = langFilter  ? `AND s.language_hint = ?`  : ''
  const langParam: unknown[] = langFilter ? [langFilter] : []
  // L5 year soft boost: ±1 year → rank higher, no exclusion.
  const yearBoost = yearFilter != null
    ? `(CASE WHEN ABS(COALESCE(cv.year, cs.year, 0) - ?) <= 1 THEN 1 ELSE 0 END) DESC,`
    : ''
  const yearBoostParam: unknown[] = yearFilter != null ? [yearFilter] : []

  try {
    return sqlite.prepare(`
      SELECT ${STREAM_SELECT}
      FROM ${ftsTable} fts
      JOIN streams s ON s.${fkColumn} = fts.canonical_id AND s.type = ?
      ${STREAM_JOINS}
      ${catJoin}
      WHERE ${ftsTable} MATCH ?
        AND s.source_id IN (${sourceList})
        ${langCond}
      ORDER BY ${yearBoost} fts.rank
      LIMIT ?
    `).all(streamType, ...catParams, ftsQuery, ...filterIds, ...langParam, ...yearBoostParam, limit)
  } catch (err) {
    console.warn(`[search:adv] FTS failed on ${ftsTable}:`, (err as Error).message)
    return []
  }
}

/** FTS + lang/year filters for series. */
function querySeriesByFtsAdvanced(
  sqlite: ReturnType<typeof getSqlite>,
  ftsQuery: string,
  langFilter: string | null,
  yearFilter: number | null,
  filterIds: string[],
  categoryName: string | undefined,
  limit: number
): unknown[] {
  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN series_source_categories ssc ON ssc.series_source_id = ss.id JOIN categories cat ON cat.id = ssc.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  const langCond   = langFilter  ? `AND ss.language_hint = ?` : ''
  const langParam: unknown[] = langFilter ? [langFilter] : []
  const yearBoost  = yearFilter != null
    ? `(CASE WHEN ABS(COALESCE(cs.year, 0) - ?) <= 1 THEN 1 ELSE 0 END) DESC,`
    : ''
  const yearBoostParam: unknown[] = yearFilter != null ? [yearFilter] : []

  try {
    return sqlite.prepare(`
      SELECT ${SERIES_SELECT}
      FROM canonical_series_fts fts
      JOIN canonical_series cs ON cs.id = fts.canonical_id
      JOIN series_sources ss ON ss.canonical_series_id = cs.id
      ${catJoin}
      WHERE canonical_series_fts MATCH ?
        AND ss.source_id IN (${sourceList})
        ${langCond}
      ORDER BY ${yearBoost} fts.rank
      LIMIT ?
    `).all(...catParams, ftsQuery, ...filterIds, ...langParam, ...yearBoostParam, limit)
  } catch (err) {
    console.warn(`[search:adv] FTS failed on canonical_series_fts:`, (err as Error).message)
    return []
  }
}

/** No title query — filter only by lang/year. Used in advanced mode when user
 *  types e.g. `@fr` or `@2001` without a title. */
function queryStreamsByLangYear(
  sqlite: ReturnType<typeof getSqlite>,
  streamType: 'movie' | 'live',
  langFilter: string | null,
  yearFilter: number | null,
  filterIds: string[],
  categoryName: string | undefined,
  limit: number
): unknown[] {
  if (!langFilter && yearFilter == null) return []
  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN stream_categories sc ON sc.stream_id = s.id JOIN categories cat ON cat.id = sc.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  const langCond  = langFilter  ? `AND s.language_hint = ?`  : ''
  const langParam: unknown[] = langFilter ? [langFilter] : []
  const yearCond  = yearFilter != null ? `AND ABS(COALESCE(cv.year, cs.year, 0) - ?) <= 1` : ''
  const yearParam: unknown[] = yearFilter != null ? [yearFilter] : []

  return sqlite.prepare(`
    SELECT ${STREAM_SELECT}
    FROM streams s
    ${STREAM_JOINS}
    ${catJoin}
    WHERE s.type = ? AND s.source_id IN (${sourceList}) ${langCond} ${yearCond}
    ORDER BY s.added_at DESC
    LIMIT ?
  `).all(streamType, ...catParams, ...filterIds, ...langParam, ...yearParam, limit) as unknown[]
}

function querySeriesByLangYear(
  sqlite: ReturnType<typeof getSqlite>,
  langFilter: string | null,
  yearFilter: number | null,
  filterIds: string[],
  categoryName: string | undefined,
  limit: number
): unknown[] {
  if (!langFilter && yearFilter == null) return []
  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN series_source_categories ssc ON ssc.series_source_id = ss.id JOIN categories cat ON cat.id = ssc.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  const langCond  = langFilter  ? `AND ss.language_hint = ?` : ''
  const langParam: unknown[] = langFilter ? [langFilter] : []
  const yearCond  = yearFilter != null ? `AND ABS(COALESCE(cs.year, 0) - ?) <= 1` : ''
  const yearParam: unknown[] = yearFilter != null ? [yearFilter] : []

  return sqlite.prepare(`
    SELECT ${SERIES_SELECT}
    FROM series_sources ss
    LEFT JOIN canonical_series cs ON cs.id = ss.canonical_series_id
    ${catJoin}
    WHERE ss.source_id IN (${sourceList}) ${langCond} ${yearCond}
    ORDER BY ss.added_at DESC
    LIMIT ?
  `).all(...catParams, ...filterIds, ...langParam, ...yearParam, limit) as unknown[]
}

/**
 * Advanced mode LIKE fallback — covers unmatched streams (null canonical_id)
 * which are invisible in basic mode but visible in advanced mode (L4).
 */
function runAdvancedLikeFallback(
  sqlite: ReturnType<typeof getSqlite>,
  titleQuery: string,
  type: 'live' | 'movie' | 'series' | undefined,
  langFilter: string | null,
  filterIds: string[],
  categoryName: string | undefined,
  limit: number
): unknown[] {
  const sourceList = filterIds.map(() => '?').join(',')
  const words = titleQuery.split(/\s+/).filter(Boolean)
  const likeParams = words.map(w => `%${normalizeForSearch(w)}%`)
  const langCond  = langFilter ? `AND s.language_hint = ?` : ''
  const langParam: unknown[] = langFilter ? [langFilter] : []
  const results: unknown[] = []

  if (!type || type !== 'series') {
    const streamTypeCond = type ? `AND s.type = ?` : `AND s.type IN ('live','movie')`
    const typeParams: unknown[] = type ? [type] : []
    const catJoin = categoryName
      ? `JOIN stream_categories sc ON sc.stream_id = s.id JOIN categories cat ON cat.id = sc.category_id AND cat.name = ?`
      : ''
    const catParams: unknown[] = categoryName ? [categoryName] : []
    const likeConds = words.map(() => `s.title LIKE ?`).join(' AND ') || '1=1'
    const rows = sqlite.prepare(`
      SELECT ${STREAM_SELECT}
      FROM streams s
      ${STREAM_JOINS}
      ${catJoin}
      WHERE ${likeConds} ${streamTypeCond} ${langCond} AND s.source_id IN (${sourceList})
      ORDER BY s.added_at DESC
      LIMIT ?
    `).all(...catParams, ...likeParams, ...typeParams, ...langParam, ...filterIds, limit) as unknown[]
    results.push(...rows)
  }

  if (!type || type === 'series') {
    const seriesLikeConds = words.map(() => `ss.title LIKE ?`).join(' AND ') || '1=1'
    const catJoin = categoryName
      ? `JOIN series_source_categories ssc ON ssc.series_source_id = ss.id JOIN categories cat ON cat.id = ssc.category_id AND cat.name = ?`
      : ''
    const catParams: unknown[] = categoryName ? [categoryName] : []
    const seriesLangCond = langFilter ? `AND ss.language_hint = ?` : ''
    const rows = sqlite.prepare(`
      SELECT ${SERIES_SELECT}
      FROM series_sources ss
      LEFT JOIN canonical_series cs ON cs.id = ss.canonical_series_id
      ${catJoin}
      WHERE ${seriesLikeConds} ${seriesLangCond} AND ss.source_id IN (${sourceList})
      ORDER BY ss.added_at DESC
      LIMIT ?
    `).all(...catParams, ...likeParams, ...langParam, ...filterIds, limit) as unknown[]
    results.push(...rows)
  }

  return results.slice(0, limit)
}

// ─── Helpers: user-data mutation + read ──────────────────────────────────

function readUserData(sqlite: ReturnType<typeof getSqlite>, ref: ResolvedContent, contentId: string) {
  // Watch-position data always comes from stream_user_data if we have a stream.
  let fav = 0, wl = 0, rating: number | null = null, favSort: number | null = null
  if (ref.kind === 'movie' && ref.canonicalVodId) {
    const row = sqlite.prepare(`SELECT * FROM canonical_vod_user_data WHERE profile_id = ? AND canonical_vod_id = ?`).get(DEFAULT_PROFILE, ref.canonicalVodId) as any
    if (row) { fav = row.is_favorite ?? 0; wl = row.is_watchlisted ?? 0; rating = row.rating ?? null; favSort = row.fav_sort_order ?? null }
  } else if (ref.kind === 'series' && ref.canonicalSeriesId) {
    const row = sqlite.prepare(`SELECT * FROM canonical_series_user_data WHERE profile_id = ? AND canonical_series_id = ?`).get(DEFAULT_PROFILE, ref.canonicalSeriesId) as any
    if (row) { fav = row.is_favorite ?? 0; wl = row.is_watchlisted ?? 0; rating = row.rating ?? null; favSort = row.fav_sort_order ?? null }
  } else if (ref.kind === 'live' && ref.stream) {
    const row = sqlite.prepare(`SELECT * FROM channel_user_data WHERE profile_id = ? AND stream_id = ?`).get(DEFAULT_PROFILE, ref.stream.id) as any
    if (row) { fav = row.is_favorite ?? 0; favSort = row.fav_sort_order ?? null }
  } else if (ref.kind === 'episode' && ref.canonicalSeriesId) {
    // Episodes inherit favorite/watchlist from the parent series.
    const row = sqlite.prepare(`SELECT * FROM canonical_series_user_data WHERE profile_id = ? AND canonical_series_id = ?`).get(DEFAULT_PROFILE, ref.canonicalSeriesId) as any
    if (row) { fav = row.is_favorite ?? 0; wl = row.is_watchlisted ?? 0; rating = row.rating ?? null }
  }

  let position = 0, lastWatched: number | null = null, completed = 0
  if (ref.stream) {
    const sud = sqlite.prepare(`SELECT watch_position, last_watched_at, completed FROM stream_user_data WHERE profile_id = ? AND stream_id = ?`).get(DEFAULT_PROFILE, ref.stream.id) as any
    if (sud) { position = sud.watch_position ?? 0; lastWatched = sud.last_watched_at ?? null; completed = sud.completed ?? 0 }
  }

  if (!fav && !wl && !rating && !position && !lastWatched && !completed) return null
  return {
    content_id: contentId,
    favorite: fav,
    watchlist: wl,
    rating,
    last_position: position,
    last_watched_at: lastWatched,
    completed,
    fav_sort_order: favSort,
  }
}

function toggleFavorite(sqlite: ReturnType<typeof getSqlite>, ref: ResolvedContent): boolean {
  if (ref.kind === 'movie' && ref.canonicalVodId) {
    sqlite.prepare(`
      INSERT INTO canonical_vod_user_data (profile_id, canonical_vod_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, canonical_vod_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, ref.canonicalVodId)
    const row = sqlite.prepare(`SELECT is_favorite FROM canonical_vod_user_data WHERE profile_id = ? AND canonical_vod_id = ?`).get(DEFAULT_PROFILE, ref.canonicalVodId) as any
    return !!row?.is_favorite
  }
  if ((ref.kind === 'series' || ref.kind === 'episode') && ref.canonicalSeriesId) {
    sqlite.prepare(`
      INSERT INTO canonical_series_user_data (profile_id, canonical_series_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, canonical_series_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, ref.canonicalSeriesId)
    const row = sqlite.prepare(`SELECT is_favorite FROM canonical_series_user_data WHERE profile_id = ? AND canonical_series_id = ?`).get(DEFAULT_PROFILE, ref.canonicalSeriesId) as any
    return !!row?.is_favorite
  }
  if (ref.kind === 'live' && ref.stream) {
    sqlite.prepare(`
      INSERT INTO channel_user_data (profile_id, stream_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, stream_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, ref.stream.id)
    const row = sqlite.prepare(`SELECT is_favorite FROM channel_user_data WHERE profile_id = ? AND stream_id = ?`).get(DEFAULT_PROFILE, ref.stream.id) as any
    return !!row?.is_favorite
  }
  return false
}

function toggleWatchlist(sqlite: ReturnType<typeof getSqlite>, ref: ResolvedContent): boolean {
  if (ref.kind === 'movie' && ref.canonicalVodId) {
    sqlite.prepare(`
      INSERT INTO canonical_vod_user_data (profile_id, canonical_vod_id, is_watchlisted)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, canonical_vod_id) DO UPDATE SET is_watchlisted = NOT is_watchlisted
    `).run(DEFAULT_PROFILE, ref.canonicalVodId)
    const row = sqlite.prepare(`SELECT is_watchlisted FROM canonical_vod_user_data WHERE profile_id = ? AND canonical_vod_id = ?`).get(DEFAULT_PROFILE, ref.canonicalVodId) as any
    return !!row?.is_watchlisted
  }
  if ((ref.kind === 'series' || ref.kind === 'episode') && ref.canonicalSeriesId) {
    sqlite.prepare(`
      INSERT INTO canonical_series_user_data (profile_id, canonical_series_id, is_watchlisted)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, canonical_series_id) DO UPDATE SET is_watchlisted = NOT is_watchlisted
    `).run(DEFAULT_PROFILE, ref.canonicalSeriesId)
    const row = sqlite.prepare(`SELECT is_watchlisted FROM canonical_series_user_data WHERE profile_id = ? AND canonical_series_id = ?`).get(DEFAULT_PROFILE, ref.canonicalSeriesId) as any
    return !!row?.is_watchlisted
  }
  return false
}

function listFavorites(sqlite: ReturnType<typeof getSqlite>, type?: 'live' | 'movie' | 'series'): unknown[] {
  const results: unknown[] = []

  if (!type || type === 'movie') {
    const rows = sqlite.prepare(`
      SELECT ${STREAM_SELECT},
             vud.fav_sort_order            AS fav_sort_order,
             sud.last_watched_at           AS last_watched_at,
             1                              AS favorite
      FROM canonical_vod_user_data vud
      JOIN streams s ON s.canonical_vod_id = vud.canonical_vod_id AND s.type = 'movie'
      JOIN sources src ON src.id = s.source_id AND src.disabled = 0
      ${STREAM_JOINS}
      LEFT JOIN stream_user_data sud ON sud.stream_id = s.id AND sud.profile_id = ?
      WHERE vud.is_favorite = 1 AND vud.profile_id = ?
      GROUP BY vud.canonical_vod_id
      ORDER BY COALESCE(vud.fav_sort_order, 999999) ASC, sud.last_watched_at DESC
    `).all(DEFAULT_PROFILE, DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  if (!type || type === 'series') {
    const rows = sqlite.prepare(`
      SELECT ${SERIES_SELECT},
             sud.fav_sort_order            AS fav_sort_order,
             NULL                           AS last_watched_at,
             1                              AS favorite
      FROM canonical_series_user_data sud
      JOIN canonical_series cs ON cs.id = sud.canonical_series_id
      JOIN series_sources ss ON ss.canonical_series_id = cs.id
      JOIN sources src ON src.id = ss.source_id AND src.disabled = 0
      WHERE sud.is_favorite = 1 AND sud.profile_id = ?
      GROUP BY sud.canonical_series_id
      ORDER BY COALESCE(sud.fav_sort_order, 999999) ASC
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  if (!type || type === 'live') {
    const rows = sqlite.prepare(`
      SELECT ${STREAM_SELECT},
             cud.fav_sort_order            AS fav_sort_order,
             sud.last_watched_at           AS last_watched_at,
             1                              AS favorite
      FROM channel_user_data cud
      JOIN streams s ON s.id = cud.stream_id AND s.type = 'live'
      JOIN sources src ON src.id = s.source_id AND src.disabled = 0
      ${STREAM_JOINS}
      LEFT JOIN stream_user_data sud ON sud.stream_id = s.id AND sud.profile_id = ?
      WHERE cud.is_favorite = 1 AND cud.profile_id = ?
      ORDER BY COALESCE(cud.fav_sort_order, 999999) ASC, sud.last_watched_at DESC
    `).all(DEFAULT_PROFILE, DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  return results
}

function listWatchlist(sqlite: ReturnType<typeof getSqlite>, type?: 'live' | 'movie' | 'series'): unknown[] {
  const results: unknown[] = []
  if (!type || type === 'movie') {
    const rows = sqlite.prepare(`
      SELECT ${STREAM_SELECT},
             sud.last_watched_at           AS last_watched_at
      FROM canonical_vod_user_data vud
      JOIN streams s ON s.canonical_vod_id = vud.canonical_vod_id AND s.type = 'movie'
      JOIN sources src ON src.id = s.source_id AND src.disabled = 0
      ${STREAM_JOINS}
      LEFT JOIN stream_user_data sud ON sud.stream_id = s.id AND sud.profile_id = ?
      WHERE vud.is_watchlisted = 1 AND vud.profile_id = ?
      GROUP BY vud.canonical_vod_id
      ORDER BY sud.last_watched_at DESC
    `).all(DEFAULT_PROFILE, DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  if (!type || type === 'series') {
    const rows = sqlite.prepare(`
      SELECT ${SERIES_SELECT}
      FROM canonical_series_user_data sud
      JOIN canonical_series cs ON cs.id = sud.canonical_series_id
      JOIN series_sources ss ON ss.canonical_series_id = cs.id
      JOIN sources src ON src.id = ss.source_id AND src.disabled = 0
      WHERE sud.is_watchlisted = 1 AND sud.profile_id = ?
      GROUP BY sud.canonical_series_id
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  return results
}

function listContinueWatching(sqlite: ReturnType<typeof getSqlite>, type?: 'movie' | 'series'): unknown[] {
  // Movies: any stream_user_data row with watch_position > 0 and not completed
  // whose stream has type='movie'.
  const moviesSql = `
    SELECT ${STREAM_SELECT},
           sud.watch_position AS last_position,
           sud.last_watched_at
    FROM stream_user_data sud
    JOIN streams s ON s.id = sud.stream_id AND s.type = 'movie'
    JOIN sources src ON src.id = s.source_id AND src.disabled = 0
    ${STREAM_JOINS}
    WHERE sud.watch_position > 0 AND sud.completed = 0 AND sud.profile_id = ?
    ORDER BY sud.last_watched_at DESC
    LIMIT 20
  `

  // Series: most-recent in-progress episode per canonical_series. Map back to
  // the series_sources row (if any) so the result acts as a series ContentItem.
  const seriesSql = `
    WITH ranked_episodes AS (
      SELECT
        e.canonical_series_id,
        s.id                    AS resume_episode_id,
        e.season                AS resume_season_number,
        e.episode               AS resume_episode_number,
        COALESCE(e.title, s.title) AS resume_episode_title,
        sud.watch_position      AS last_position,
        sud.last_watched_at,
        ROW_NUMBER() OVER (PARTITION BY e.canonical_series_id ORDER BY sud.last_watched_at DESC) AS rn
      FROM stream_user_data sud
      JOIN streams s ON s.id = sud.stream_id AND s.type = 'episode'
      JOIN episodes e ON e.id = s.episode_id
      WHERE sud.watch_position > 0 AND sud.completed = 0 AND sud.profile_id = ?
    )
    SELECT ${SERIES_SELECT},
           r.resume_episode_id, r.resume_season_number, r.resume_episode_number,
           r.resume_episode_title, r.last_position, r.last_watched_at
    FROM ranked_episodes r
    JOIN canonical_series cs ON cs.id = r.canonical_series_id
    JOIN series_sources ss ON ss.canonical_series_id = cs.id
    JOIN sources src ON src.id = ss.source_id AND src.disabled = 0
    WHERE r.rn = 1
    GROUP BY cs.id
    ORDER BY r.last_watched_at DESC
    LIMIT 20
  `

  if (type === 'movie')  return sqlite.prepare(moviesSql).all(DEFAULT_PROFILE) as unknown[]
  if (type === 'series') return sqlite.prepare(seriesSql).all(DEFAULT_PROFILE) as unknown[]

  const movies = sqlite.prepare(moviesSql).all(DEFAULT_PROFILE) as any[]
  const series = sqlite.prepare(seriesSql).all(DEFAULT_PROFILE) as any[]
  return [...movies, ...series]
    .sort((a, b) => (b.last_watched_at ?? 0) - (a.last_watched_at ?? 0))
    .slice(0, 20)
}

function listHistory(sqlite: ReturnType<typeof getSqlite>, limit: number): unknown[] {
  // All non-episode stream history.
  const directRows = sqlite.prepare(`
    SELECT ${STREAM_SELECT},
           sud.watch_position AS last_position,
           sud.last_watched_at
    FROM stream_user_data sud
    JOIN streams s ON s.id = sud.stream_id AND s.type IN ('live','movie')
    JOIN sources src ON src.id = s.source_id AND src.disabled = 0
    ${STREAM_JOINS}
    WHERE sud.last_watched_at IS NOT NULL AND sud.profile_id = ?
    ORDER BY sud.last_watched_at DESC
    LIMIT ?
  `).all(DEFAULT_PROFILE, limit) as any[]

  // Series history — collapse per-series to the most recent episode.
  const episodeRows = sqlite.prepare(`
    WITH ranked_episodes AS (
      SELECT
        e.canonical_series_id,
        s.id                    AS resume_episode_id,
        e.season                AS resume_season_number,
        e.episode               AS resume_episode_number,
        COALESCE(e.title, s.title) AS resume_episode_title,
        sud.watch_position      AS last_position,
        sud.last_watched_at,
        ROW_NUMBER() OVER (PARTITION BY e.canonical_series_id ORDER BY sud.last_watched_at DESC) AS rn
      FROM stream_user_data sud
      JOIN streams s ON s.id = sud.stream_id AND s.type = 'episode'
      JOIN episodes e ON e.id = s.episode_id
      WHERE sud.last_watched_at IS NOT NULL AND sud.profile_id = ?
    )
    SELECT ${SERIES_SELECT},
           r.resume_episode_id, r.resume_season_number, r.resume_episode_number,
           r.resume_episode_title, r.last_position, r.last_watched_at
    FROM ranked_episodes r
    JOIN canonical_series cs ON cs.id = r.canonical_series_id
    JOIN series_sources ss ON ss.canonical_series_id = cs.id
    JOIN sources src ON src.id = ss.source_id AND src.disabled = 0
    WHERE r.rn = 1
    GROUP BY cs.id
    ORDER BY r.last_watched_at DESC
    LIMIT ?
  `).all(DEFAULT_PROFILE, limit) as any[]

  const seen = new Set<string>()
  return [...directRows, ...episodeRows]
    .sort((a, b) => (b.last_watched_at ?? 0) - (a.last_watched_at ?? 0))
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true })
    .slice(0, limit)
}

// ─── External player paths ───────────────────────────────────────────────

function findMpv(): string {
  if (process.platform === 'win32') {
    for (const p of [join('C:', 'Program Files', 'mpv', 'mpv.exe'), join('C:', 'Program Files (x86)', 'mpv', 'mpv.exe')]) {
      if (existsSync(p)) return p
    }
  } else if (process.platform === 'darwin') {
    for (const p of ['/Applications/mpv.app/Contents/MacOS/mpv', '/opt/homebrew/bin/mpv', '/usr/local/bin/mpv']) {
      if (existsSync(p)) return p
    }
  } else {
    for (const p of ['/usr/bin/mpv', '/usr/local/bin/mpv', '/snap/bin/mpv']) {
      if (existsSync(p)) return p
    }
  }
  return 'mpv'
}

function findVlc(): string {
  if (process.platform === 'win32') {
    for (const p of [join('C:', 'Program Files', 'VideoLAN', 'VLC', 'vlc.exe'), join('C:', 'Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe')]) {
      if (existsSync(p)) return p
    }
  } else if (process.platform === 'darwin') {
    for (const p of ['/Applications/VLC.app/Contents/MacOS/VLC', '/opt/homebrew/bin/vlc']) {
      if (existsSync(p)) return p
    }
  } else {
    for (const p of ['/usr/bin/vlc', '/usr/local/bin/vlc', '/snap/bin/vlc']) {
      if (existsSync(p)) return p
    }
  }
  return 'vlc'
}
