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
  parent_series_id?: string
  language_hint?: string; origin_hint?: string
  quality_hint?: string; year_hint?: number
}

interface SeriesSourceRow {
  id: string; source_id: string
  series_external_id: string; title: string
  thumbnail_url?: string; category_id?: string
  language_hint?: string; origin_hint?: string
  quality_hint?: string; year_hint?: number
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

// `activeSyncWorkers` allows cancel mid-flight.
const activeSyncWorkers = new Map<string, Worker>()

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
  /** For episodes — the parent series_sources.id (via parent_series_id). */
  parentSeriesId?: string
}

function resolveContent(sqlite: ReturnType<typeof getSqlite>, contentId: string): ResolvedContent | null {
  const stream = sqlite.prepare('SELECT * FROM streams WHERE id = ?').get(contentId) as StreamRow | undefined
  if (stream) {
    if (stream.type === 'movie') {
      return { kind: 'movie', stream }
    }
    if (stream.type === 'live') {
      return { kind: 'live', stream }
    }
    if (stream.type === 'episode') {
      return { kind: 'episode', stream, parentSeriesId: stream.parent_series_id ?? undefined }
    }
  }
  const seriesRow = sqlite.prepare('SELECT * FROM series_sources WHERE id = ?').get(contentId) as SeriesSourceRow | undefined
  if (seriesRow) {
    return { kind: 'series', seriesSource: seriesRow }
  }
  return null
}

// ─── V3 SELECT fragments ──────────────────────────────────────────────────
// The renderer expects a bag of fields carried over from the V2 TMDB era.
// We return NULL for fields that no longer exist (plot, director, cast, etc.)
// until a rich-enrichment tier is added. Fields sourced from V3 canonical:
//   poster_url, year, multilingual title (future).

// Max rows fetched internally for search to compute accurate totals.
const SEARCH_TOTAL_CAP = 2000

// ─── g1 SELECT fragments — streams-only, no canonical joins ──────────────
const G1_STREAM_SELECT = `
  s.id,
  s.source_id         AS primary_source_id,
  s.source_id         AS source_ids,
  s.stream_id         AS external_id,
  s.type,
  s.title             AS title,
  s.category_id,
  s.thumbnail_url     AS poster_url,
  s.container_extension,
  s.catchup_supported,
  s.catchup_days,
  s.epg_channel_id,
  s.tvg_id,
  NULL                AS canonical_id,
  NULL                AS original_title,
  s.year_hint         AS year,
  NULL                AS plot,
  NULL                AS poster_path,
  NULL                AS backdrop_url,
  NULL                AS rating_tmdb,
  NULL                AS rating_imdb,
  NULL                AS genres,
  NULL                AS director,
  NULL                AS cast,
  NULL                AS keywords,
  NULL                AS runtime,
  NULL                AS tmdb_id,
  0                   AS enriched,
  NULL                AS enriched_at,
  0                   AS has_epg_data
`

const G1_SERIES_SELECT = `
  ss.id,
  ss.source_id                    AS primary_source_id,
  ss.source_id                    AS source_ids,
  ss.series_external_id           AS external_id,
  'series'                        AS type,
  ss.title                        AS title,
  ss.category_id,
  ss.thumbnail_url                AS poster_url,
  NULL                            AS container_extension,
  0                               AS catchup_supported,
  0                               AS catchup_days,
  NULL                            AS epg_channel_id,
  NULL                            AS tvg_id,
  NULL                            AS canonical_id,
  NULL                            AS original_title,
  ss.year_hint                    AS year,
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
  NULL                            AS tmdb_id,
  0                               AS enriched,
  NULL                            AS enriched_at,
  0                               AS has_epg_data
`

// g1: G1_STREAM_SELECT and G1_SERIES_SELECT are now the primary constants.
// Aliases for any remaining references:
const STREAM_SELECT = G1_STREAM_SELECT
const SERIES_SELECT = G1_SERIES_SELECT

// ─── Handler registration ─────────────────────────────────────────────────

export function registerHandlers() {
  // No-op stub — FTS rebuild deferred to g2 tier.
  rebuildFtsIfNeeded().catch(console.error)

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
        stream:           sqlite.prepare(`SELECT * FROM stream_user_data`).all(),
        series:           sqlite.prepare(`SELECT * FROM series_user_data`).all(),
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

    // g1 user-data imports are best-effort: only rows whose stream/series
    // row still exists are restored (post-resync IDs may have shifted).
    const insertStreamUd = sqlite.prepare(`
      INSERT OR REPLACE INTO stream_user_data (profile_id, stream_id, is_favorite, is_watchlisted, rating, fav_sort_order, watch_position, watch_duration, last_watched_at, completed)
      SELECT @profile_id, @stream_id, COALESCE(@is_favorite, 0), COALESCE(@is_watchlisted, 0), @rating, @fav_sort_order, COALESCE(@watch_position, 0), @watch_duration, @last_watched_at, COALESCE(@completed, 0)
      WHERE EXISTS (SELECT 1 FROM streams WHERE id = @stream_id)
    `)
    const insertSeriesUd = sqlite.prepare(`
      INSERT OR REPLACE INTO series_user_data (profile_id, series_source_id, is_favorite, is_watchlisted, rating, fav_sort_order)
      SELECT @profile_id, @series_source_id, COALESCE(@is_favorite, 0), COALESCE(@is_watchlisted, 0), @rating, @fav_sort_order
      WHERE EXISTS (SELECT 1 FROM series_sources WHERE id = @series_source_id)
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
          if (Array.isArray(ud.stream))  for (const r of ud.stream)  insertStreamUd.run({ profile_id: DEFAULT_PROFILE, ...r })
          if (Array.isArray(ud.series))  for (const r of ud.series)  insertSeriesUd.run({ profile_id: DEFAULT_PROFILE, ...r })
          if (Array.isArray(ud.channel)) for (const r of ud.channel) insertChannelUd.run({ profile_id: DEFAULT_PROFILE, ...r })
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
        sqlite.prepare(`DELETE FROM stream_user_data`).run()
        sqlite.prepare(`DELETE FROM series_user_data`).run()
        sqlite.prepare(`DELETE FROM channel_user_data`).run()
        // EPG
        sqlite.prepare(`DELETE FROM epg`).run()
        // Streams + series parents + joins
        sqlite.prepare(`DELETE FROM stream_categories`).run()
        sqlite.prepare(`DELETE FROM series_source_categories`).run()
        sqlite.prepare(`DELETE FROM series_sources`).run()
        sqlite.prepare(`DELETE FROM streams`).run()
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
          // Kick EPG sync in background after successful source sync.
          const src = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
          if (src?.server_url) runEpgSync(sqlite, win, sourceId, src)
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
             s.title AS title,
             s.thumbnail_url AS poster_url,
             s.epg_channel_id,
             s.source_id AS primary_source_id,
             s.catchup_supported, s.catchup_days,
             s.stream_id AS external_id
      FROM streams s
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
  // g1 tier: LIKE search on provider titles (streams.title / series_sources.title).
  // No FTS, no canonical joins. Simple and guaranteed not to freeze.
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
    const rawQuery = (args.query ?? '').trim()

    const enabledSources = (sqlite.prepare(`SELECT id FROM sources WHERE disabled = 0`).all() as { id: string }[]).map(r => r.id)
    const filterIds = sourceIds && sourceIds.length > 0
      ? sourceIds.filter(id => enabledSources.includes(id))
      : enabledSources
    if (!filterIds.length) return { items: [], total: 0 }

    const effectiveType = args.type

    // Empty query → browse path.
    if (!rawQuery) {
      return runBrowseSearch(effectiveType, categoryName, filterIds, limit, offset)
    }

    // ── g1: LIKE search on provider titles ────────────────────────────────
    const all: unknown[] = []

    if (!effectiveType || effectiveType === 'movie') {
      all.push(...g1SearchStreams(rawQuery, 'movie', categoryName, filterIds, SEARCH_TOTAL_CAP))
    }
    if (!effectiveType || effectiveType === 'live') {
      all.push(...g1SearchStreams(rawQuery, 'live', categoryName, filterIds, SEARCH_TOTAL_CAP))
    }
    if (!effectiveType || effectiveType === 'series') {
      all.push(...g1SearchSeries(rawQuery, categoryName, filterIds, SEARCH_TOTAL_CAP))
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
  // persists episodes as streams (type='episode') with parent_series_id link.
  // Season/episode metadata stored in provider_metadata JSON.
  ipcMain.handle('series:get-info', async (_event, args: { contentId: string }) => {
    const db = getDb()
    const sqlite = getSqlite()

    const seriesRow = sqlite.prepare('SELECT * FROM series_sources WHERE id = ?').get(args.contentId) as SeriesSourceRow | undefined
    if (!seriesRow) return { error: 'Content not found' }

    const [source] = await db.select().from(sources).where(eq(sources.id, seriesRow.source_id))
    if (!source?.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    try {
      const info = await xtreamService.getSeriesInfo(source.serverUrl, source.username, source.password, seriesRow.series_external_id)

      const upsertEpisodeStream = sqlite.prepare(`
        INSERT INTO streams (
          id, source_id, type, stream_id, title, container_extension, parent_series_id, provider_metadata
        ) VALUES (?, ?, 'episode', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          container_extension = excluded.container_extension,
          parent_series_id = excluded.parent_series_id,
          provider_metadata = excluded.provider_metadata
      `)

      const tx = sqlite.transaction((seasons: Record<string, any[]>) => {
        for (const [, eps] of Object.entries(seasons)) {
          for (const ep of eps) {
            const season  = Number(ep.season ?? ep.season_number ?? 0)
            const epNum   = Number(ep.episode_num ?? ep.episode ?? 0)
            const epTitle = ep.title ?? `S${season}E${epNum}`
            const streamId = `${source.id}:episode:${ep.id}`
            const metadata = JSON.stringify({ season, episode: epNum, air_date: ep.air_date ?? null })

            upsertEpisodeStream.run(
              streamId, source.id, String(ep.id), epTitle,
              ep.container_extension ?? 'mkv', seriesRow.id, metadata
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
  //   movie  → stream_user_data     (favorite/watchlist/rating/position)
  //   series → series_user_data     (favorite/watchlist/rating)
  //   episode→ stream_user_data     (position/completed) + parent series_user_data (fav/wl)
  //   live   → channel_user_data    (favorite per-stream) + stream_user_data (position)

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
    const updateStream = sqlite.prepare(`UPDATE stream_user_data SET fav_sort_order = ? WHERE profile_id = ? AND stream_id = ?`)
    const updateSeries = sqlite.prepare(`UPDATE series_user_data SET fav_sort_order = ? WHERE profile_id = ? AND series_source_id = ?`)
    const updateChan   = sqlite.prepare(`UPDATE channel_user_data SET fav_sort_order = ? WHERE profile_id = ? AND stream_id = ?`)
    const runAll = sqlite.transaction((items: typeof order) => {
      for (const { contentId, sortOrder } of items) {
        const ref = resolveContent(sqlite, contentId)
        if (!ref) continue
        if (ref.kind === 'movie'  && ref.stream)        updateStream.run(sortOrder, DEFAULT_PROFILE, ref.stream.id)
        else if (ref.kind === 'series' && ref.seriesSource) updateSeries.run(sortOrder, DEFAULT_PROFILE, ref.seriesSource.id)
        else if (ref.kind === 'live'   && ref.stream)       updateChan.run(sortOrder, DEFAULT_PROFILE, ref.stream.id)
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
    if (ref.kind === 'movie' && ref.stream) {
      sqlite.prepare(`
        INSERT INTO stream_user_data (profile_id, stream_id, rating)
        VALUES (?, ?, ?)
        ON CONFLICT(profile_id, stream_id) DO UPDATE SET rating = excluded.rating
      `).run(DEFAULT_PROFILE, ref.stream.id, args.rating)
      return { success: true }
    }
    if (ref.kind === 'series' && ref.seriesSource) {
      sqlite.prepare(`
        INSERT INTO series_user_data (profile_id, series_source_id, rating)
        VALUES (?, ?, ?)
        ON CONFLICT(profile_id, series_source_id) DO UPDATE SET rating = excluded.rating
      `).run(DEFAULT_PROFILE, ref.seriesSource.id, args.rating)
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
    sqlite.prepare(`UPDATE stream_user_data  SET is_favorite = 0, is_watchlisted = 0`).run()
    sqlite.prepare(`UPDATE series_user_data SET is_favorite = 0, is_watchlisted = 0`).run()
    sqlite.prepare(`UPDATE channel_user_data SET is_favorite = 0`).run()
    return { success: true }
  })

  ipcMain.handle('user:clear-all-data', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`DELETE FROM stream_user_data`).run()
    sqlite.prepare(`DELETE FROM series_user_data`).run()
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
    // g1: no canonical tables, no enrichment. Return zeros.
    return { total: 0, enriched: 0, pending: 0 }
  })
  ipcMain.handle('enrichment:enrich-single', deprecatedEnrichment('enrich-single'))
  ipcMain.handle('enrichment:enrich-manual', deprecatedEnrichment('enrich-manual'))
  ipcMain.handle('enrichment:search-tmdb',   deprecatedEnrichment('search-tmdb'))
  ipcMain.handle('enrichment:enrich-by-id',  deprecatedEnrichment('enrich-by-id'))
  ipcMain.handle('enrichment:start', async () => {
    // g1: no enrichment worker. Stub for renderer compat.
    return { success: true, message: 'No enrichment in g1 tier' }
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

// ─── g1 search: LIKE on provider titles, no FTS, no canonical joins ──────
function g1SearchStreams(
  query: string,
  type: 'live' | 'movie' | undefined,
  categoryName: string | undefined,
  filterIds: string[],
  limit: number
): unknown[] {
  const sqlite = getSqlite()
  const sourceList = filterIds.map(() => '?').join(',')
  const words = query.split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const likeParams = words.map(w => `%${w}%`)
  const likeConds = words.map(() => `s.title LIKE ?`).join(' AND ')
  const typeConds = type ? `AND s.type = ?` : `AND s.type IN ('live','movie')`
  const typeParams: unknown[] = type ? [type] : []
  const catJoin = categoryName
    ? `JOIN stream_categories sc ON sc.stream_id = s.id JOIN categories cat ON cat.id = sc.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  return sqlite.prepare(`
    SELECT ${G1_STREAM_SELECT}
    FROM streams s
    ${catJoin}
    WHERE ${likeConds} ${typeConds} AND s.source_id IN (${sourceList})
    ORDER BY s.added_at DESC
    LIMIT ?
  `).all(...catParams, ...likeParams, ...typeParams, ...filterIds, limit) as unknown[]
}

function g1SearchSeries(
  query: string,
  categoryName: string | undefined,
  filterIds: string[],
  limit: number
): unknown[] {
  const sqlite = getSqlite()
  const sourceList = filterIds.map(() => '?').join(',')
  const words = query.split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const likeParams = words.map(w => `%${w}%`)
  const likeConds = words.map(() => `ss.title LIKE ?`).join(' AND ')
  const catJoin = categoryName
    ? `JOIN series_source_categories ssc ON ssc.series_source_id = ss.id JOIN categories cat ON cat.id = ssc.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  return sqlite.prepare(`
    SELECT ${G1_SERIES_SELECT}
    FROM series_sources ss
    ${catJoin}
    WHERE ${likeConds} AND ss.source_id IN (${sourceList})
    ORDER BY ss.added_at DESC
    LIMIT ?
  `).all(...catParams, ...likeParams, ...filterIds, limit) as unknown[]
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
    year:   's.year_hint',
    rating: 's.added_at',
    updated:'s.added_at',
  }
  const seriesSortCol: Record<string, string> = {
    title:  'ss.title',
    year:   'ss.year_hint',
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
      ${catJoin}
      WHERE ss.source_id IN (${sourceList})
    `).get(...catParams, ...filterIds) as { cnt: number }).cnt
    const items = sqlite.prepare(`
      SELECT ${SERIES_SELECT}
      FROM series_sources ss
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
    ${catJoin}
    WHERE s.source_id IN (${sourceList}) ${typeFilter}
    ORDER BY ${streamSortCol[sortBy] ?? 's.added_at'} ${dir}
    LIMIT ? OFFSET ?
  `).all(...catParams, ...filterIds, ...typeParams, limit, offset) as unknown[]
  return { items, total }
}

// ─── Helpers: user-data mutation + read ──────────────────────────────────

function readUserData(sqlite: ReturnType<typeof getSqlite>, ref: ResolvedContent, contentId: string) {
  let fav = 0, wl = 0, rating: number | null = null, favSort: number | null = null
  let position = 0, lastWatched: number | null = null, completed = 0

  if (ref.kind === 'movie' && ref.stream) {
    const row = sqlite.prepare(`SELECT * FROM stream_user_data WHERE profile_id = ? AND stream_id = ?`).get(DEFAULT_PROFILE, ref.stream.id) as any
    if (row) {
      fav = row.is_favorite ?? 0; wl = row.is_watchlisted ?? 0; rating = row.rating ?? null; favSort = row.fav_sort_order ?? null
      position = row.watch_position ?? 0; lastWatched = row.last_watched_at ?? null; completed = row.completed ?? 0
    }
  } else if (ref.kind === 'series' && ref.seriesSource) {
    const row = sqlite.prepare(`SELECT * FROM series_user_data WHERE profile_id = ? AND series_source_id = ?`).get(DEFAULT_PROFILE, ref.seriesSource.id) as any
    if (row) { fav = row.is_favorite ?? 0; wl = row.is_watchlisted ?? 0; rating = row.rating ?? null; favSort = row.fav_sort_order ?? null }
  } else if (ref.kind === 'live' && ref.stream) {
    const row = sqlite.prepare(`SELECT * FROM channel_user_data WHERE profile_id = ? AND stream_id = ?`).get(DEFAULT_PROFILE, ref.stream.id) as any
    if (row) { fav = row.is_favorite ?? 0; favSort = row.fav_sort_order ?? null }
    const sud = sqlite.prepare(`SELECT watch_position, last_watched_at, completed FROM stream_user_data WHERE profile_id = ? AND stream_id = ?`).get(DEFAULT_PROFILE, ref.stream.id) as any
    if (sud) { position = sud.watch_position ?? 0; lastWatched = sud.last_watched_at ?? null; completed = sud.completed ?? 0 }
  } else if (ref.kind === 'episode' && ref.stream) {
    // Episode position from stream_user_data; fav/wl inherited from parent series.
    const sud = sqlite.prepare(`SELECT * FROM stream_user_data WHERE profile_id = ? AND stream_id = ?`).get(DEFAULT_PROFILE, ref.stream.id) as any
    if (sud) { position = sud.watch_position ?? 0; lastWatched = sud.last_watched_at ?? null; completed = sud.completed ?? 0 }
    if (ref.parentSeriesId) {
      const row = sqlite.prepare(`SELECT * FROM series_user_data WHERE profile_id = ? AND series_source_id = ?`).get(DEFAULT_PROFILE, ref.parentSeriesId) as any
      if (row) { fav = row.is_favorite ?? 0; wl = row.is_watchlisted ?? 0; rating = row.rating ?? null }
    }
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
  if (ref.kind === 'movie' && ref.stream) {
    sqlite.prepare(`
      INSERT INTO stream_user_data (profile_id, stream_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, stream_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, ref.stream.id)
    const row = sqlite.prepare(`SELECT is_favorite FROM stream_user_data WHERE profile_id = ? AND stream_id = ?`).get(DEFAULT_PROFILE, ref.stream.id) as any
    return !!row?.is_favorite
  }
  if (ref.kind === 'series' && ref.seriesSource) {
    sqlite.prepare(`
      INSERT INTO series_user_data (profile_id, series_source_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, series_source_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, ref.seriesSource.id)
    const row = sqlite.prepare(`SELECT is_favorite FROM series_user_data WHERE profile_id = ? AND series_source_id = ?`).get(DEFAULT_PROFILE, ref.seriesSource.id) as any
    return !!row?.is_favorite
  }
  if (ref.kind === 'episode' && ref.parentSeriesId) {
    sqlite.prepare(`
      INSERT INTO series_user_data (profile_id, series_source_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, series_source_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, ref.parentSeriesId)
    const row = sqlite.prepare(`SELECT is_favorite FROM series_user_data WHERE profile_id = ? AND series_source_id = ?`).get(DEFAULT_PROFILE, ref.parentSeriesId) as any
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
  if (ref.kind === 'movie' && ref.stream) {
    sqlite.prepare(`
      INSERT INTO stream_user_data (profile_id, stream_id, is_watchlisted)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, stream_id) DO UPDATE SET is_watchlisted = NOT is_watchlisted
    `).run(DEFAULT_PROFILE, ref.stream.id)
    const row = sqlite.prepare(`SELECT is_watchlisted FROM stream_user_data WHERE profile_id = ? AND stream_id = ?`).get(DEFAULT_PROFILE, ref.stream.id) as any
    return !!row?.is_watchlisted
  }
  if (ref.kind === 'series' && ref.seriesSource) {
    sqlite.prepare(`
      INSERT INTO series_user_data (profile_id, series_source_id, is_watchlisted)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, series_source_id) DO UPDATE SET is_watchlisted = NOT is_watchlisted
    `).run(DEFAULT_PROFILE, ref.seriesSource.id)
    const row = sqlite.prepare(`SELECT is_watchlisted FROM series_user_data WHERE profile_id = ? AND series_source_id = ?`).get(DEFAULT_PROFILE, ref.seriesSource.id) as any
    return !!row?.is_watchlisted
  }
  if (ref.kind === 'episode' && ref.parentSeriesId) {
    sqlite.prepare(`
      INSERT INTO series_user_data (profile_id, series_source_id, is_watchlisted)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, series_source_id) DO UPDATE SET is_watchlisted = NOT is_watchlisted
    `).run(DEFAULT_PROFILE, ref.parentSeriesId)
    const row = sqlite.prepare(`SELECT is_watchlisted FROM series_user_data WHERE profile_id = ? AND series_source_id = ?`).get(DEFAULT_PROFILE, ref.parentSeriesId) as any
    return !!row?.is_watchlisted
  }
  return false
}

function listFavorites(sqlite: ReturnType<typeof getSqlite>, type?: 'live' | 'movie' | 'series'): unknown[] {
  const results: unknown[] = []

  if (!type || type === 'movie') {
    const rows = sqlite.prepare(`
      SELECT ${STREAM_SELECT},
             sud.fav_sort_order            AS fav_sort_order,
             sud.last_watched_at           AS last_watched_at,
             1                              AS favorite
      FROM stream_user_data sud
      JOIN streams s ON s.id = sud.stream_id AND s.type = 'movie'
      JOIN sources src ON src.id = s.source_id AND src.disabled = 0
      WHERE sud.is_favorite = 1 AND sud.profile_id = ?
      ORDER BY COALESCE(sud.fav_sort_order, 999999) ASC, sud.last_watched_at DESC
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  if (!type || type === 'series') {
    const rows = sqlite.prepare(`
      SELECT ${SERIES_SELECT},
             sud.fav_sort_order            AS fav_sort_order,
             NULL                           AS last_watched_at,
             1                              AS favorite
      FROM series_user_data sud
      JOIN series_sources ss ON ss.id = sud.series_source_id
      JOIN sources src ON src.id = ss.source_id AND src.disabled = 0
      WHERE sud.is_favorite = 1 AND sud.profile_id = ?
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
      FROM stream_user_data sud
      JOIN streams s ON s.id = sud.stream_id AND s.type = 'movie'
      JOIN sources src ON src.id = s.source_id AND src.disabled = 0
      WHERE sud.is_watchlisted = 1 AND sud.profile_id = ?
      ORDER BY sud.last_watched_at DESC
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  if (!type || type === 'series') {
    const rows = sqlite.prepare(`
      SELECT ${SERIES_SELECT}
      FROM series_user_data sud
      JOIN series_sources ss ON ss.id = sud.series_source_id
      JOIN sources src ON src.id = ss.source_id AND src.disabled = 0
      WHERE sud.is_watchlisted = 1 AND sud.profile_id = ?
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
    WHERE sud.watch_position > 0 AND sud.completed = 0 AND sud.profile_id = ?
    ORDER BY sud.last_watched_at DESC
    LIMIT 20
  `

  // Series: most-recent in-progress episode per parent series.
  // Uses parent_series_id + provider_metadata JSON for season/episode info.
  const seriesSql = `
    WITH ranked_episodes AS (
      SELECT
        s.parent_series_id,
        s.id                    AS resume_episode_id,
        CAST(json_extract(s.provider_metadata, '$.season') AS INTEGER)  AS resume_season_number,
        CAST(json_extract(s.provider_metadata, '$.episode') AS INTEGER) AS resume_episode_number,
        s.title                 AS resume_episode_title,
        sud.watch_position      AS last_position,
        sud.last_watched_at,
        ROW_NUMBER() OVER (PARTITION BY s.parent_series_id ORDER BY sud.last_watched_at DESC) AS rn
      FROM stream_user_data sud
      JOIN streams s ON s.id = sud.stream_id AND s.type = 'episode'
      WHERE sud.watch_position > 0 AND sud.completed = 0 AND sud.profile_id = ?
        AND s.parent_series_id IS NOT NULL
    )
    SELECT ${SERIES_SELECT},
           r.resume_episode_id, r.resume_season_number, r.resume_episode_number,
           r.resume_episode_title, r.last_position, r.last_watched_at
    FROM ranked_episodes r
    JOIN series_sources ss ON ss.id = r.parent_series_id
    JOIN sources src ON src.id = ss.source_id AND src.disabled = 0
    WHERE r.rn = 1
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
    WHERE sud.last_watched_at IS NOT NULL AND sud.profile_id = ?
    ORDER BY sud.last_watched_at DESC
    LIMIT ?
  `).all(DEFAULT_PROFILE, limit) as any[]

  // Series history — collapse per-series to the most recent episode.
  const episodeRows = sqlite.prepare(`
    WITH ranked_episodes AS (
      SELECT
        s.parent_series_id,
        s.id                    AS resume_episode_id,
        CAST(json_extract(s.provider_metadata, '$.season') AS INTEGER)  AS resume_season_number,
        CAST(json_extract(s.provider_metadata, '$.episode') AS INTEGER) AS resume_episode_number,
        s.title                 AS resume_episode_title,
        sud.watch_position      AS last_position,
        sud.last_watched_at,
        ROW_NUMBER() OVER (PARTITION BY s.parent_series_id ORDER BY sud.last_watched_at DESC) AS rn
      FROM stream_user_data sud
      JOIN streams s ON s.id = sud.stream_id AND s.type = 'episode'
      WHERE sud.last_watched_at IS NOT NULL AND sud.profile_id = ?
        AND s.parent_series_id IS NOT NULL
    )
    SELECT ${SERIES_SELECT},
           r.resume_episode_id, r.resume_season_number, r.resume_episode_number,
           r.resume_episode_title, r.last_position, r.last_watched_at
    FROM ranked_episodes r
    JOIN series_sources ss ON ss.id = r.parent_series_id
    JOIN sources src ON src.id = ss.source_id AND src.disabled = 0
    WHERE r.rn = 1
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
