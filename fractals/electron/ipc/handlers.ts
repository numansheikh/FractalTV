import { ipcMain, BrowserWindow, app, dialog } from 'electron'
import { spawn } from 'child_process'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { getDb, getSqlite, getSetting, setSetting } from '../database/connection'
import { sources } from '../database/schema'
import { eq } from 'drizzle-orm'
import { xtreamService } from '../services/xtream.service'
import { m3uService } from '../services/m3u.service'
import { syncEpg, getNowNext } from '../services/epg.service'
import { normalizeForSearch } from '../lib/normalize'
import { pullAll as iptvOrgPullAll, getStatus as iptvOrgGetStatus, matchChannelsForSource as iptvOrgMatchSource } from '../services/iptv-org'

// ─── Minimal row interfaces ─────────────────────────────────────────────────

interface CountRow { n: number }

interface SourceRow {
  id: string; type: string; name: string
  server_url: string; username: string; password: string
  m3u_url?: string; status?: string; disabled?: number
  color_index?: number; last_epg_sync?: number
  ingest_state?: 'added' | 'tested' | 'synced' | 'epg_fetched'
}

// g1c content rows. Channels, movies, and series each live in their own table.
interface ChannelRow {
  id: string; source_id: string; external_id: string; title: string
  category_id?: string; thumbnail_url?: string; stream_url?: string
  tvg_id?: string; epg_channel_id?: string
  catchup_supported?: number; catchup_days?: number
  provider_metadata?: string
}

interface MovieRow {
  id: string; source_id: string; external_id: string; title: string
  category_id?: string; thumbnail_url?: string; stream_url?: string
  container_extension?: string; provider_metadata?: string
  md_year?: number
}

interface SeriesRow {
  id: string; source_id: string; external_id: string; title: string
  category_id?: string; thumbnail_url?: string; provider_metadata?: string
  md_year?: number
}

interface EpisodeRow {
  id: string; series_id: string; external_id: string; title: string
  thumbnail_url?: string; stream_url?: string; container_extension?: string
  season?: number; episode_num?: number
}

interface DisabledRow { disabled: number }

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

// ─── Content type detection ───────────────────────────────────────────────
// Content IDs follow the format `{sourceId}:{kind}:{external_id}` where kind
// is one of 'live' | 'movie' | 'series' | 'episode'.
type ContentKind = 'channel' | 'movie' | 'series' | 'episode'

function idKind(contentId: string): ContentKind | null {
  const parts = contentId.split(':')
  if (parts.length < 3) return null
  const k = parts[1]
  if (k === 'live') return 'channel'
  if (k === 'movie') return 'movie'
  if (k === 'series') return 'series'
  if (k === 'episode') return 'episode'
  return null
}

// ─── g1c SELECT fragments ────────────────────────────────────────────────
// The renderer expects a consistent bag of fields across types. NULL fields
// are placeholders for metadata we don't have yet in g1c.

const CHANNEL_SELECT = `
  c.id,
  c.source_id                AS primary_source_id,
  c.source_id                AS source_ids,
  c.external_id              AS external_id,
  'live'                     AS type,
  c.title                    AS title,
  c.category_id,
  c.thumbnail_url            AS poster_url,
  NULL                       AS container_extension,
  c.catchup_supported,
  c.catchup_days,
  c.epg_channel_id,
  c.tvg_id,
  NULL                       AS canonical_id,
  NULL                       AS original_title,
  c.md_year                  AS year,
  NULL                       AS plot,
  NULL                       AS poster_path,
  NULL                       AS backdrop_url,
  NULL                       AS rating_tmdb,
  NULL                       AS rating_imdb,
  NULL                       AS genres,
  NULL                       AS director,
  NULL                       AS cast,
  NULL                       AS keywords,
  NULL                       AS runtime,
  NULL                       AS tmdb_id,
  0                          AS enriched,
  NULL                       AS enriched_at,
  EXISTS(SELECT 1 FROM epg WHERE epg.channel_external_id = c.epg_channel_id AND epg.source_id = c.source_id LIMIT 1) AS has_epg_data
`

const MOVIE_SELECT = `
  m.id,
  m.source_id                AS primary_source_id,
  m.source_id                AS source_ids,
  m.external_id              AS external_id,
  'movie'                    AS type,
  m.title                    AS title,
  m.category_id,
  m.thumbnail_url            AS poster_url,
  m.container_extension,
  0                          AS catchup_supported,
  0                          AS catchup_days,
  NULL                       AS epg_channel_id,
  NULL                       AS tvg_id,
  NULL                       AS canonical_id,
  NULL                       AS original_title,
  m.md_year                  AS year,
  NULL                       AS plot,
  NULL                       AS poster_path,
  NULL                       AS backdrop_url,
  NULL                       AS rating_tmdb,
  NULL                       AS rating_imdb,
  NULL                       AS genres,
  NULL                       AS director,
  NULL                       AS cast,
  NULL                       AS keywords,
  NULL                       AS runtime,
  NULL                       AS tmdb_id,
  0                          AS enriched,
  NULL                       AS enriched_at,
  0                          AS has_epg_data
`

const SERIES_SELECT = `
  sr.id,
  sr.source_id               AS primary_source_id,
  sr.source_id               AS source_ids,
  sr.external_id             AS external_id,
  'series'                   AS type,
  sr.title                   AS title,
  sr.category_id,
  sr.thumbnail_url           AS poster_url,
  NULL                       AS container_extension,
  0                          AS catchup_supported,
  0                          AS catchup_days,
  NULL                       AS epg_channel_id,
  NULL                       AS tvg_id,
  NULL                       AS canonical_id,
  NULL                       AS original_title,
  sr.md_year                 AS year,
  NULL                       AS plot,
  NULL                       AS poster_path,
  NULL                       AS backdrop_url,
  NULL                       AS rating_tmdb,
  NULL                       AS rating_imdb,
  NULL                       AS genres,
  NULL                       AS director,
  NULL                       AS cast,
  NULL                       AS keywords,
  NULL                       AS runtime,
  NULL                       AS tmdb_id,
  0                          AS enriched,
  NULL                       AS enriched_at,
  0                          AS has_epg_data
`

// ─── Handler registration ─────────────────────────────────────────────────

export function registerHandlers() {
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

  // ── Export — g1c snapshot format (version 4) ─────────────────────────
  // Dumps the 15 content/category tables plus optional user_data. Old
  // version-3 exports (from g1) are rejected on import — schema diverged
  // beyond clean mapping.
  ipcMain.handle('sources:export', async (event, opts: { includeUserData?: boolean } = {}) => {
    const sqlite = getSqlite()

    const srcs = sqlite.prepare(`
      SELECT id, type, name, server_url, username, password, m3u_url, status, disabled, color_index
      FROM sources ORDER BY created_at ASC
    `).all()

    const payload: any = {
      version: 4, // bumped from 3 (g1) — schema changed beyond clean mapping
      exported_at: new Date().toISOString(),
      sources: srcs,
      settings: {},
      content: {
        channel_categories: sqlite.prepare(`SELECT * FROM channel_categories`).all(),
        movie_categories:   sqlite.prepare(`SELECT * FROM movie_categories`).all(),
        series_categories:  sqlite.prepare(`SELECT * FROM series_categories`).all(),
        channels:           sqlite.prepare(`SELECT * FROM channels`).all(),
        movies:             sqlite.prepare(`SELECT * FROM movies`).all(),
        series:             sqlite.prepare(`SELECT * FROM series`).all(),
        episodes:           sqlite.prepare(`SELECT * FROM episodes`).all(),
      },
    }

    if (opts.includeUserData) {
      payload.user_data = {
        channel: sqlite.prepare(`SELECT * FROM channel_user_data`).all(),
        movie:   sqlite.prepare(`SELECT * FROM movie_user_data`).all(),
        series:  sqlite.prepare(`SELECT * FROM series_user_data`).all(),
        episode: sqlite.prepare(`SELECT * FROM episode_user_data`).all(),
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
    if (parsed.version && parsed.version < 4) {
      return { error: 'Old export format (g1) — incompatible with g1c schema. Re-add sources and re-sync.' }
    }

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

    // Per-type user-data inserts are best-effort: only rows whose content
    // row still exists are restored.
    const insertChannelUd = sqlite.prepare(`
      INSERT OR REPLACE INTO channel_user_data (profile_id, channel_id, is_favorite, fav_sort_order)
      SELECT @profile_id, @channel_id, COALESCE(@is_favorite, 0), @fav_sort_order
      WHERE EXISTS (SELECT 1 FROM channels WHERE id = @channel_id)
    `)
    const insertMovieUd = sqlite.prepare(`
      INSERT OR REPLACE INTO movie_user_data (profile_id, movie_id, is_favorite, is_watchlisted, rating, fav_sort_order, watch_position, watch_duration, last_watched_at, completed)
      SELECT @profile_id, @movie_id, COALESCE(@is_favorite, 0), COALESCE(@is_watchlisted, 0), @rating, @fav_sort_order, COALESCE(@watch_position, 0), @watch_duration, @last_watched_at, COALESCE(@completed, 0)
      WHERE EXISTS (SELECT 1 FROM movies WHERE id = @movie_id)
    `)
    const insertSeriesUd = sqlite.prepare(`
      INSERT OR REPLACE INTO series_user_data (profile_id, series_id, is_favorite, is_watchlisted, rating, fav_sort_order)
      SELECT @profile_id, @series_id, COALESCE(@is_favorite, 0), COALESCE(@is_watchlisted, 0), @rating, @fav_sort_order
      WHERE EXISTS (SELECT 1 FROM series WHERE id = @series_id)
    `)
    const insertEpisodeUd = sqlite.prepare(`
      INSERT OR REPLACE INTO episode_user_data (profile_id, episode_id, watch_position, watch_duration, last_watched_at, completed)
      SELECT @profile_id, @episode_id, COALESCE(@watch_position, 0), @watch_duration, @last_watched_at, COALESCE(@completed, 0)
      WHERE EXISTS (SELECT 1 FROM episodes WHERE id = @episode_id)
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
          if (Array.isArray(ud.channel)) for (const r of ud.channel) insertChannelUd.run({ profile_id: DEFAULT_PROFILE, ...r })
          if (Array.isArray(ud.movie))   for (const r of ud.movie)   insertMovieUd.run({ profile_id: DEFAULT_PROFILE, ...r })
          if (Array.isArray(ud.series))  for (const r of ud.series)  insertSeriesUd.run({ profile_id: DEFAULT_PROFILE, ...r })
          if (Array.isArray(ud.episode)) for (const r of ud.episode) insertEpisodeUd.run({ profile_id: DEFAULT_PROFILE, ...r })
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
        sqlite.prepare(`DELETE FROM channel_user_data`).run()
        sqlite.prepare(`DELETE FROM movie_user_data`).run()
        sqlite.prepare(`DELETE FROM series_user_data`).run()
        sqlite.prepare(`DELETE FROM episode_user_data`).run()
        // EPG
        sqlite.prepare(`DELETE FROM epg`).run()
        // Content
        sqlite.prepare(`DELETE FROM episodes`).run()
        sqlite.prepare(`DELETE FROM series`).run()
        sqlite.prepare(`DELETE FROM movies`).run()
        sqlite.prepare(`DELETE FROM channels`).run()
        // Categories
        sqlite.prepare(`DELETE FROM series_categories`).run()
        sqlite.prepare(`DELETE FROM movie_categories`).run()
        sqlite.prepare(`DELETE FROM channel_categories`).run()
        // Sources + settings
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
    // Count channels + movies + series across enabled sources.
    const row = sqlite.prepare(`
      SELECT
        (SELECT COUNT(*) FROM channels c JOIN sources src ON src.id = c.source_id AND src.disabled = 0) +
        (SELECT COUNT(*) FROM movies   m JOIN sources src ON src.id = m.source_id AND src.disabled = 0) +
        (SELECT COUNT(*) FROM series  sr JOIN sources src ON src.id = sr.source_id AND src.disabled = 0)
      AS n
    `).get() as CountRow | undefined
    return row?.n ?? 0
  })

  ipcMain.handle('sources:add-xtream', async (_event, args: {
    name: string; serverUrl: string; username: string; password: string
  }) => xtreamService.addSource(args.name, args.serverUrl, args.username, args.password))

  ipcMain.handle('sources:test-xtream', async (_event, args: {
    serverUrl: string; username: string; password: string
  }) => xtreamService.testConnection(args.serverUrl, args.username, args.password))

  // Test an already-added source by ID. Advances ingest_state to 'tested' on
  // success. Idempotent: re-testing a 'synced'+ source does NOT regress the
  // state (forward-only unlock).
  ipcMain.handle('sources:test', async (_event, sourceId: string) => {
    const sqlite = getSqlite()
    const src = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
    if (!src) return { success: false, error: 'Source not found' }

    const result = src.type === 'm3u' && src.m3u_url
      ? await m3uService.testConnection(src.m3u_url)
      : await xtreamService.testConnection(src.server_url, src.username, src.password)

    const ok = 'error' in result ? !result.error : (result as any).success
    if (ok && src.ingest_state === 'added') {
      sqlite.prepare(`UPDATE sources SET ingest_state = 'tested' WHERE id = ?`).run(sourceId)
    }
    return result
  })

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

    // Propagate NSFW category flags to content rows (catches any drift from resync)
    applyNsfwFlags(sqlite)

    // Auto-refresh EPG if last sync was >24h ago (or never synced).
    const staleThreshold = Math.floor(Date.now() / 1000) - 24 * 60 * 60
    for (const source of activeSources) {
      if (source.ingest_state !== 'synced' && source.ingest_state !== 'epg_fetched') continue
      if (source.last_epg_sync && source.last_epg_sync > staleThreshold) continue
      try {
        const result = await syncEpg(
          source.id, source.server_url, source.username, source.password,
          () => {} // silent — no progress events, no Sync button interference
        )
        if (!result.error) {
          sqlite.prepare(
            `UPDATE sources SET last_epg_sync = unixepoch(), ingest_state = 'epg_fetched'
             WHERE id = ? AND ingest_state IN ('synced','epg_fetched')`
          ).run(source.id)
        }
      } catch {
        // Silent — auto-refresh failure is non-fatal
      }
    }

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
          sqlite.prepare(`UPDATE sources SET ingest_state = 'synced' WHERE id = ?`).run(sourceId)

          // Chain EPG for Xtream sources (M3U has no EPG endpoint). EPG progress
          // is piped through the same `sync:progress` channel with phase='epg'
          // so the source card's message bar shows it inline.
          const runEpgChain = async () => {
            if (isM3u || !source.server_url) return null
            win?.webContents.send('sync:progress', {
              sourceId, phase: 'epg', current: 0, total: 0, message: 'Fetching EPG…',
            })
            const result = await syncEpg(
              sourceId, source.server_url, source.username, source.password,
              (m) => win?.webContents.send('sync:progress', {
                sourceId, phase: 'epg', current: 0, total: 0, message: m,
              })
            )
            if (!result.error) {
              sqlite.prepare(
                `UPDATE sources SET last_epg_sync = unixepoch(), ingest_state = 'epg_fetched'
                 WHERE id = ? AND ingest_state IN ('synced','epg_fetched')`
              ).run(sourceId)
            }
            return result
          }

          runEpgChain().then((epgResult) => {
            applyNsfwFlags(sqlite)
            const syncMsg = `Synced ${msg.catCount} categories, ${msg.totalItems.toLocaleString()} items`
            const doneMsg = epgResult
              ? (epgResult.error ? `${syncMsg} · EPG failed: ${epgResult.error}` : `${syncMsg} · EPG ${Number(epgResult.inserted ?? 0).toLocaleString()} entries`)
              : syncMsg
            win?.webContents.send('sync:progress', {
              sourceId, phase: 'done', current: msg.totalItems, total: msg.totalItems,
              message: doneMsg,
            })
            resolve({ success: true })
          })
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
      getSqlite().prepare('UPDATE sources SET status = ? WHERE id = ?').run('active', sourceId)
      win?.webContents.send('sync:progress', { sourceId, phase: 'cancelled', current: 0, total: 0, message: '' })
    }
    return { ok: true }
  })

  // ── EPG ─────────────────────────────────────────────────────────────────
  // `sources:sync-epg` — standalone EPG-only sync for Xtream sources.
  // Mirrors the EPG chain inside sources:sync but without re-syncing content.
  ipcMain.handle('sources:sync-epg', async (event, sourceId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sqlite = getSqlite()
    const source = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
    if (!source) return { success: false, error: 'Source not found' }
    if (source.type === 'm3u') return { success: false, error: 'EPG sync is only supported for Xtream sources' }
    if (!source.server_url) return { success: false, error: 'Source missing server URL' }

    win?.webContents.send('sync:progress', {
      sourceId, phase: 'epg', current: 0, total: 0, message: 'Fetching EPG…',
    })
    const result = await syncEpg(
      sourceId, source.server_url, source.username, source.password,
      (m) => win?.webContents.send('sync:progress', {
        sourceId, phase: 'epg', current: 0, total: 0, message: m,
      })
    )
    if (!result.error) {
      sqlite.prepare(
        `UPDATE sources SET last_epg_sync = unixepoch(), ingest_state = 'epg_fetched'
         WHERE id = ? AND ingest_state IN ('synced','epg_fetched')`
      ).run(sourceId)
      win?.webContents.send('sync:progress', {
        sourceId, phase: 'done', current: 0, total: 0,
        message: `EPG ${Number(result.inserted ?? 0).toLocaleString()} entries`,
      })
      return { success: true, inserted: result.inserted }
    } else {
      win?.webContents.send('sync:progress', {
        sourceId, phase: 'error', current: 0, total: 0, message: `EPG failed: ${result.error}`,
      })
      return { success: false, error: result.error }
    }
  })

  // `epg:now-next` and `epg:guide` are read-only lookups.
  ipcMain.handle('epg:now-next', (_event, contentId: string) => getNowNext(contentId))

  ipcMain.handle('epg:guide', (_event, args: { contentIds: string[]; startTime?: number; endTime?: number }) => {
    const sqlite = getSqlite()
    const now = Math.floor(Date.now() / 1000)
    const startTime = args.startTime ?? (now - 4 * 3600)
    const endTime = args.endTime ?? (now + 20 * 3600)

    if (!args.contentIds?.length) return { channels: [], programmes: {}, windowStart: startTime, windowEnd: endTime }

    const placeholders = args.contentIds.map(() => '?').join(',')
    const rows = sqlite.prepare(`
      SELECT c.id,
             c.title AS title,
             c.thumbnail_url AS poster_url,
             c.epg_channel_id,
             c.source_id AS primary_source_id,
             c.catchup_supported, c.catchup_days,
             c.external_id AS external_id
      FROM channels c
      WHERE c.id IN (${placeholders})
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
    const channel = sqlite.prepare('SELECT * FROM channels WHERE id = ?').get(args.contentId) as ChannelRow | undefined
    if (!channel) return { error: 'Channel not found' }

    const db = getDb()
    const [source] = await db.select().from(sources).where(eq(sources.id, channel.source_id))
    if (!source?.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    const url = xtreamService.buildCatchupUrl(
      source.serverUrl, source.username, source.password,
      channel.external_id, new Date(args.startTime * 1000), args.duration
    )
    return { url }
  })

  // ── Search ──────────────────────────────────────────────────────────────
  // LIKE `%query%` on `search_title` per content type. Query is normalized
  // through the same any-ascii+lowercase pass as the stored column.
  ipcMain.handle('search:query', async (_event, args: {
    query: string
    type?: 'live' | 'movie' | 'series'
    categoryName?: string
    sourceIds?: string[]
    limit?: number
    offset?: number
    skipCount?: boolean
  }) => {
    const sqlite = getSqlite()
    const { categoryName, sourceIds, limit = 50, offset = 0, skipCount = false } = args
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

    // Typed search: single table — one COUNT + one SELECT LIMIT/OFFSET.
    // skipCount short-circuits the COUNT for callers that only need items
    // (e.g. Home, which displays a fixed cap and never shows a total).
    if (effectiveType === 'movie') {
      return g1cSearchMovies(rawQuery, categoryName, filterIds, limit, offset, skipCount)
    }
    if (effectiveType === 'live') {
      return g1cSearchChannels(rawQuery, categoryName, filterIds, limit, offset, skipCount)
    }
    if (effectiveType === 'series') {
      return g1cSearchSeries(rawQuery, categoryName, filterIds, limit, offset, skipCount)
    }

    // All-types fan-out: concatenate live+movie+series, paginate across
    // the merged sequence. We over-fetch (limit+offset) per type so we can
    // pick a consistent slice; each type's total is summed for the grand total.
    const cap = limit + offset
    const live   = g1cSearchChannels(rawQuery, categoryName, filterIds, cap, 0, skipCount)
    const movies = g1cSearchMovies  (rawQuery, categoryName, filterIds, cap, 0, skipCount)
    const series = g1cSearchSeries  (rawQuery, categoryName, filterIds, cap, 0, skipCount)
    const merged = [...live.items, ...movies.items, ...series.items]
    return {
      items: merged.slice(offset, offset + limit),
      total: live.total + movies.total + series.total,
    }
  })

  // ── Content ─────────────────────────────────────────────────────────────
  ipcMain.handle('content:get', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const kind = idKind(contentId)

    if (kind === 'channel') {
      return sqlite.prepare(`
        SELECT ${CHANNEL_SELECT}, cat.name AS category_name,
          ic.name            AS io_name,
          ic.alt_names       AS io_alt_names,
          ic.network         AS io_network,
          ic.owners          AS io_owners,
          ic.country         AS io_country,
          ic.country_name    AS io_country_name,
          ic.country_flag    AS io_country_flag,
          ic.category_labels AS io_category_labels,
          ic.is_nsfw         AS io_is_nsfw,
          ic.is_blocked      AS io_is_blocked,
          ic.launched        AS io_launched,
          ic.closed          AS io_closed,
          ic.replaced_by     AS io_replaced_by,
          ic.website         AS io_website,
          ic.logo_url        AS io_logo_url
        FROM channels c
        LEFT JOIN channel_categories cat ON cat.id = c.category_id
        LEFT JOIN iptv_channels ic ON ic.id = c.iptv_org_id
        WHERE c.id = ?
      `).get(contentId) ?? null
    }
    if (kind === 'movie') {
      return sqlite.prepare(`
        SELECT ${MOVIE_SELECT}, cat.name AS category_name
        FROM movies m
        LEFT JOIN movie_categories cat ON cat.id = m.category_id
        WHERE m.id = ?
      `).get(contentId) ?? null
    }
    if (kind === 'series') {
      return sqlite.prepare(`
        SELECT ${SERIES_SELECT}, cat.name AS category_name
        FROM series sr
        LEFT JOIN series_categories cat ON cat.id = sr.category_id
        WHERE sr.id = ?
      `).get(contentId) ?? null
    }
    if (kind === 'episode') {
      // Return a minimal episode record. Callers typically want series info.
      return sqlite.prepare(`SELECT * FROM episodes WHERE id = ?`).get(contentId) ?? null
    }
    return null
  })

  ipcMain.handle('content:get-stream-url', async (_event, args: { contentId: string; sourceId?: string }) => {
    const db = getDb()
    const sqlite = getSqlite()
    const kind = idKind(args.contentId)
    if (!kind) return { error: 'Invalid content ID' }

    let sourceIdFromRow: string | null = null
    let externalId: string | null = null
    let containerExtension: string | null = null
    let directStreamUrl: string | null = null
    let xtreamType: 'live' | 'movie' | 'series' = 'movie'

    if (kind === 'channel') {
      const ch = sqlite.prepare('SELECT * FROM channels WHERE id = ?').get(args.contentId) as ChannelRow | undefined
      if (!ch) return { error: 'Content not found' }
      sourceIdFromRow = ch.source_id
      externalId = ch.external_id
      directStreamUrl = ch.stream_url ?? null
      xtreamType = 'live'
    } else if (kind === 'movie') {
      const m = sqlite.prepare('SELECT * FROM movies WHERE id = ?').get(args.contentId) as MovieRow | undefined
      if (!m) return { error: 'Content not found' }
      sourceIdFromRow = m.source_id
      externalId = m.external_id
      containerExtension = m.container_extension ?? null
      directStreamUrl = m.stream_url ?? null
      xtreamType = 'movie'
    } else if (kind === 'episode') {
      const ep = sqlite.prepare('SELECT * FROM episodes WHERE id = ?').get(args.contentId) as EpisodeRow | undefined
      if (!ep) return { error: 'Content not found' }
      // Episodes link to series, which owns source_id.
      const ser = sqlite.prepare('SELECT source_id FROM series WHERE id = ?').get(ep.series_id) as { source_id: string } | undefined
      if (!ser) return { error: 'Parent series not found' }
      sourceIdFromRow = ser.source_id
      externalId = ep.external_id
      containerExtension = ep.container_extension ?? null
      directStreamUrl = ep.stream_url ?? null
      xtreamType = 'series'
    } else {
      return { error: 'Series parents are not playable' }
    }

    const sourceId = args.sourceId ?? sourceIdFromRow!
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId))
    if (!source) return { error: 'No stream source found' }

    // M3U sources: stream_url is stored directly on the content row.
    if (source.type === 'm3u') {
      if (!directStreamUrl) return { error: 'Stream URL missing for M3U content' }
      return { url: directStreamUrl, sourceId: source.id }
    }

    if (!source.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    const url = xtreamService.buildStreamUrl(
      source.serverUrl, source.username, source.password,
      xtreamType, externalId!, containerExtension ?? undefined
    )
    return { url, sourceId: source.id }
  })

  // series:get-info — lazy-fetches season/episode list from Xtream and
  // persists episodes into the episodes table with FK series_id.
  ipcMain.handle('series:get-info', async (_event, args: { contentId: string }) => {
    const db = getDb()
    const sqlite = getSqlite()

    const seriesRow = sqlite.prepare('SELECT * FROM series WHERE id = ?').get(args.contentId) as SeriesRow | undefined
    if (!seriesRow) return { error: 'Content not found' }

    const [source] = await db.select().from(sources).where(eq(sources.id, seriesRow.source_id))
    if (!source?.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    try {
      const info = await xtreamService.getSeriesInfo(source.serverUrl, source.username, source.password, seriesRow.external_id)

      const upsertEpisode = sqlite.prepare(`
        INSERT INTO episodes (
          id, series_id, external_id, title,
          container_extension, season, episode_num
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          container_extension = excluded.container_extension,
          season = excluded.season,
          episode_num = excluded.episode_num
      `)

      const tx = sqlite.transaction((seasons: Record<string, any[]>) => {
        for (const [, eps] of Object.entries(seasons)) {
          for (const ep of eps) {
            const season  = Number(ep.season ?? ep.season_number ?? 0)
            const epNum   = Number(ep.episode_num ?? ep.episode ?? 0)
            const epTitle = ep.title ?? `S${season}E${epNum}`
            const epId = `${source.id}:episode:${ep.id}`

            upsertEpisode.run(
              epId, seriesRow.id, String(ep.id), epTitle,
              ep.container_extension ?? 'mkv', season, epNum
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
  //   channel → channel_user_data  (favorite only — live channels don't track position)
  //   movie   → movie_user_data    (favorite/watchlist/rating/position)
  //   series  → series_user_data   (favorite/watchlist/rating — episode positions are per-episode)
  //   episode → episode_user_data  (position/completed) + parent series_user_data for fav/wl

  ipcMain.handle('user:get-data', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    return readUserData(sqlite, contentId)
  })

  ipcMain.handle('user:set-position', async (_event, args: { contentId: string; position: number }) => {
    const sqlite = getSqlite()
    const kind = idKind(args.contentId)
    if (kind === 'movie') {
      sqlite.prepare(`
        INSERT INTO movie_user_data (profile_id, movie_id, watch_position, last_watched_at)
        VALUES (?, ?, ?, unixepoch())
        ON CONFLICT(profile_id, movie_id) DO UPDATE SET
          watch_position  = excluded.watch_position,
          last_watched_at = excluded.last_watched_at
      `).run(DEFAULT_PROFILE, args.contentId, args.position)
      return { success: true }
    }
    if (kind === 'episode') {
      sqlite.prepare(`
        INSERT INTO episode_user_data (profile_id, episode_id, watch_position, last_watched_at)
        VALUES (?, ?, ?, unixepoch())
        ON CONFLICT(profile_id, episode_id) DO UPDATE SET
          watch_position  = excluded.watch_position,
          last_watched_at = excluded.last_watched_at
      `).run(DEFAULT_PROFILE, args.contentId, args.position)
      return { success: true }
    }
    // channel/series: no meaningful position state (channels are live, series
    // is a parent not itself playable).
    return { success: false }
  })

  ipcMain.handle('user:toggle-favorite', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    return { favorite: toggleFavorite(sqlite, contentId) }
  })

  ipcMain.handle('user:toggle-watchlist', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    return { watchlist: toggleWatchlist(sqlite, contentId) }
  })

  ipcMain.handle('user:favorites', async (_event, args?: { type?: 'live' | 'movie' | 'series' }) => {
    const sqlite = getSqlite()
    return listFavorites(sqlite, args?.type)
  })

  ipcMain.handle('user:reorder-favorites', async (_event, order: { contentId: string; sortOrder: number }[]) => {
    const sqlite = getSqlite()
    const updCh = sqlite.prepare(`UPDATE channel_user_data SET fav_sort_order = ? WHERE profile_id = ? AND channel_id = ?`)
    const updMv = sqlite.prepare(`UPDATE movie_user_data   SET fav_sort_order = ? WHERE profile_id = ? AND movie_id = ?`)
    const updSr = sqlite.prepare(`UPDATE series_user_data  SET fav_sort_order = ? WHERE profile_id = ? AND series_id = ?`)
    const runAll = sqlite.transaction((items: typeof order) => {
      for (const { contentId, sortOrder } of items) {
        const kind = idKind(contentId)
        if (kind === 'channel') updCh.run(sortOrder, DEFAULT_PROFILE, contentId)
        else if (kind === 'movie')  updMv.run(sortOrder, DEFAULT_PROFILE, contentId)
        else if (kind === 'series') updSr.run(sortOrder, DEFAULT_PROFILE, contentId)
      }
    })
    runAll(order)
    return { ok: true }
  })

  // ── Channels (live-specific user data) ──────────────────────────────
  ipcMain.handle('channels:favorites', async (_event, args?: { profileId?: string }) => {
    const sqlite = getSqlite()
    const profileId = args?.profileId ?? DEFAULT_PROFILE
    return sqlite.prepare(`
      SELECT ${CHANNEL_SELECT},
        cud.fav_sort_order                    AS fav_sort_order,
        NULL                                  AS last_watched_at,
        1                                      AS favorite
      FROM channel_user_data cud
      JOIN channels c ON c.id = cud.channel_id
      JOIN sources src ON src.id = c.source_id AND src.disabled = 0
      WHERE cud.is_favorite = 1 AND cud.profile_id = ?
      ORDER BY COALESCE(cud.fav_sort_order, 999999) ASC
    `).all(profileId)
  })

  ipcMain.handle('channels:toggle-favorite', async (_event, channelId: string) => {
    const sqlite = getSqlite()
    const row = sqlite.prepare('SELECT id FROM channels WHERE id = ?').get(channelId) as { id?: string } | undefined
    if (!row?.id) return { favorite: false }
    sqlite.prepare(`
      INSERT INTO channel_user_data (profile_id, channel_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, channel_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, row.id)
    const r = sqlite.prepare(`SELECT is_favorite FROM channel_user_data WHERE profile_id = ? AND channel_id = ?`).get(DEFAULT_PROFILE, row.id) as { is_favorite?: number } | undefined
    return { favorite: !!r?.is_favorite }
  })

  ipcMain.handle('channels:reorder-favorites', async (_event, order: { canonicalId: string; sortOrder: number }[]) => {
    const sqlite = getSqlite()
    const update = sqlite.prepare(`UPDATE channel_user_data SET fav_sort_order = ? WHERE profile_id = ? AND channel_id = ?`)
    const runAll = sqlite.transaction((items: typeof order) => {
      for (const { canonicalId, sortOrder } of items) update.run(sortOrder, DEFAULT_PROFILE, canonicalId)
    })
    runAll(order)
    return { ok: true }
  })

  ipcMain.handle('channels:get-data', async (_event, channelId: string) => {
    const sqlite = getSqlite()
    const fav = sqlite.prepare(`SELECT is_favorite FROM channel_user_data WHERE profile_id = ? AND channel_id = ?`).get(DEFAULT_PROFILE, channelId) as { is_favorite?: number } | undefined
    return {
      favorite:    !!fav?.is_favorite,
      watchlisted: false,
      rating:      null,
      position:    0,
      completed:   false,
    }
  })

  ipcMain.handle('channels:siblings', async (_event, channelId: string) => {
    const sqlite = getSqlite()
    const ch = sqlite.prepare('SELECT iptv_org_id FROM channels WHERE id = ?').get(channelId) as { iptv_org_id?: string | null } | undefined
    if (!ch?.iptv_org_id) return []
    return sqlite.prepare(`
      SELECT c.id, c.title, c.source_id
      FROM channels c
      WHERE c.iptv_org_id = ? AND c.id != ?
      LIMIT 10
    `).all(ch.iptv_org_id, channelId)
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
      const data = readUserData(sqlite, id)
      if (data) result[id] = data
    }
    return result
  })

  ipcMain.handle('user:set-completed', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const kind = idKind(contentId)
    if (kind === 'movie') {
      sqlite.prepare(`
        INSERT INTO movie_user_data (profile_id, movie_id, completed, watch_position, last_watched_at)
        VALUES (?, ?, 1, 0, unixepoch())
        ON CONFLICT(profile_id, movie_id) DO UPDATE SET
          completed = 1, watch_position = 0, last_watched_at = unixepoch()
      `).run(DEFAULT_PROFILE, contentId)
      return { success: true }
    }
    if (kind === 'episode') {
      sqlite.prepare(`
        INSERT INTO episode_user_data (profile_id, episode_id, completed, watch_position, last_watched_at)
        VALUES (?, ?, 1, 0, unixepoch())
        ON CONFLICT(profile_id, episode_id) DO UPDATE SET
          completed = 1, watch_position = 0, last_watched_at = unixepoch()
      `).run(DEFAULT_PROFILE, contentId)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle('user:set-rating', async (_event, args: { contentId: string; rating: number | null }) => {
    const sqlite = getSqlite()
    const kind = idKind(args.contentId)
    if (kind === 'movie') {
      sqlite.prepare(`
        INSERT INTO movie_user_data (profile_id, movie_id, rating)
        VALUES (?, ?, ?)
        ON CONFLICT(profile_id, movie_id) DO UPDATE SET rating = excluded.rating
      `).run(DEFAULT_PROFILE, args.contentId, args.rating)
      return { success: true }
    }
    if (kind === 'series') {
      sqlite.prepare(`
        INSERT INTO series_user_data (profile_id, series_id, rating)
        VALUES (?, ?, ?)
        ON CONFLICT(profile_id, series_id) DO UPDATE SET rating = excluded.rating
      `).run(DEFAULT_PROFILE, args.contentId, args.rating)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle('user:clear-continue', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const kind = idKind(contentId)
    if (kind === 'movie') {
      sqlite.prepare(`
        UPDATE movie_user_data SET watch_position = 0, completed = 1
        WHERE profile_id = ? AND movie_id = ?
      `).run(DEFAULT_PROFILE, contentId)
      return { success: true }
    }
    if (kind === 'episode') {
      sqlite.prepare(`
        UPDATE episode_user_data SET watch_position = 0, completed = 1
        WHERE profile_id = ? AND episode_id = ?
      `).run(DEFAULT_PROFILE, contentId)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle('user:clear-item-history', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const kind = idKind(contentId)
    if (kind === 'movie') {
      sqlite.prepare(`
        UPDATE movie_user_data SET watch_position = 0, last_watched_at = NULL, completed = 0
        WHERE profile_id = ? AND movie_id = ?
      `).run(DEFAULT_PROFILE, contentId)
      return { success: true }
    }
    if (kind === 'episode') {
      sqlite.prepare(`
        UPDATE episode_user_data SET watch_position = 0, last_watched_at = NULL, completed = 0
        WHERE profile_id = ? AND episode_id = ?
      `).run(DEFAULT_PROFILE, contentId)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle('user:clear-history', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE movie_user_data   SET watch_position = 0, last_watched_at = NULL, completed = 0`).run()
    sqlite.prepare(`UPDATE episode_user_data SET watch_position = 0, last_watched_at = NULL, completed = 0`).run()
    return { success: true }
  })

  ipcMain.handle('user:clear-favorites', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE channel_user_data SET is_favorite = 0`).run()
    sqlite.prepare(`UPDATE movie_user_data   SET is_favorite = 0, is_watchlisted = 0`).run()
    sqlite.prepare(`UPDATE series_user_data  SET is_favorite = 0, is_watchlisted = 0`).run()
    return { success: true }
  })

  ipcMain.handle('user:clear-all-data', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`DELETE FROM channel_user_data`).run()
    sqlite.prepare(`DELETE FROM movie_user_data`).run()
    sqlite.prepare(`DELETE FROM series_user_data`).run()
    sqlite.prepare(`DELETE FROM episode_user_data`).run()
    return { success: true }
  })

  // ── Diagnostic ────────────────────────────────────────────────────────
  ipcMain.handle('debug:category-items', async (_event, categoryNameSearch: string) => {
    const sqlite = getSqlite()
    const results: any[] = []

    const categoryTables = [
      { table: 'channel_categories', contentTable: 'channels', type: 'live' },
      { table: 'movie_categories',   contentTable: 'movies',   type: 'movie' },
      { table: 'series_categories',  contentTable: 'series',   type: 'series' },
    ]

    for (const { table, contentTable, type } of categoryTables) {
      const cats = sqlite.prepare(`
        SELECT cat.*, s.name as source_name
        FROM ${table} cat
        JOIN sources s ON s.id = cat.source_id
        WHERE cat.name LIKE ?
        ORDER BY cat.name
      `).all(`%${categoryNameSearch}%`) as any[]

      for (const cat of cats) {
        const items = sqlite.prepare(`
          SELECT x.id, x.title, x.external_id AS external_id, '${type}' AS type, x.source_id AS primary_source_id
          FROM ${contentTable} x
          WHERE x.category_id = ?
        `).all(cat.id) as any[]
        results.push({
          categoryName: cat.name,
          categoryExternalId: cat.external_id,
          sourceId: cat.source_id,
          sourceName: cat.source_name,
          type,
          actualItems: items.length,
          items: items.map((i: any) => ({ id: i.id, title: i.title, externalId: i.external_id })),
        })
      }
    }

    return results
  })

  // ── Settings (key-value) ─────────────────────────────────────────────
  ipcMain.handle('settings:get', (_event, key: string) => getSetting(key))
  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    setSetting(key, value)
    return { ok: true }
  })

  // ── iptv-org channel database (g2 — independent module) ─────────────
  ipcMain.handle('iptvOrg:status', () => iptvOrgGetStatus())

  ipcMain.handle('iptvOrg:matchSource', (_event, sourceId: string) => {
    try {
      const result = iptvOrgMatchSource(sourceId)
      return { ok: true as const, ...result }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { ok: false as const, error: message }
    }
  })

  ipcMain.handle('iptvOrg:pull', async (event) => {
    const send = (phase: 'fetching' | 'validating' | 'writing' | 'done', extra?: { count?: number }) => {
      event.sender.send('iptvOrg:progress', { phase, ...(extra ?? {}) })
    }
    try {
      const result = await iptvOrgPullAll(send)
      return { ok: true, count: result.count }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      event.sender.send('iptvOrg:progress', { phase: 'error', error: message })
      return { ok: false, error: message }
    }
  })

  // ── Enrichment — deprecated stubs (no canonical layer in g1c) ─────────
  const deprecatedEnrichment = (opName: string) => () => ({
    success: false,
    error: `${opName} is deprecated in g1c — no enrichment tier yet.`,
  })

  ipcMain.handle('enrichment:set-api-key',  () => ({ success: true })) // no-op
  ipcMain.handle('enrichment:status', () => {
    return { total: 0, enriched: 0, pending: 0 }
  })
  ipcMain.handle('enrichment:enrich-single', deprecatedEnrichment('enrich-single'))
  ipcMain.handle('enrichment:enrich-manual', deprecatedEnrichment('enrich-manual'))
  ipcMain.handle('enrichment:search-tmdb',   deprecatedEnrichment('search-tmdb'))
  ipcMain.handle('enrichment:enrich-by-id',  deprecatedEnrichment('enrich-by-id'))
  ipcMain.handle('enrichment:start', async () => {
    return { success: true, message: 'No enrichment in g1c tier' }
  })

  // ── Categories ────────────────────────────────────────────────────────
  ipcMain.handle('categories:set-nsfw', (_event, id: string, value: 0 | 1) => {
    const sqlite = getSqlite()
    const table = id.includes(':chancat:')   ? 'channel_categories'
                : id.includes(':moviecat:')  ? 'movie_categories'
                : id.includes(':seriescat:') ? 'series_categories'
                : (() => { throw new Error(`Unknown category ID format: ${id}`) })()
    // Mark ALL categories with the same name (covers multiple sources)
    const row = sqlite.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as { name: string } | undefined
    if (!row) return { ok: false }
    sqlite.prepare(`UPDATE ${table} SET is_nsfw = ? WHERE name = ?`).run(value, row.name)
    applyNsfwFlags(sqlite)
    return { ok: true }
  })

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

    // Query each per-type table, count via the content-table category_id FK,
    // and merge in JS so the shape matches the old `categories` join.
    const queries = [
      { table: 'channel_categories', content: 'channels', type: 'live' as const },
      { table: 'movie_categories',   content: 'movies',   type: 'movie' as const },
      { table: 'series_categories',  content: 'series',   type: 'series' as const },
    ]

    const allowAdult = getSetting('allow_adult') !== '0'

    const rows: any[] = []
    for (const q of queries) {
      if (args.type && args.type !== q.type) continue
      const nsfwFilter = allowAdult ? '' : 'AND cat.is_nsfw = 0'
      const partial = sqlite.prepare(`
        SELECT
          cat.id                                      AS id,
          cat.name                                    AS name,
          '${q.type}'                                 AS type,
          MAX(cat.is_nsfw)                            AS is_nsfw,
          GROUP_CONCAT(DISTINCT cat.source_id)        AS source_ids,
          COUNT(DISTINCT x.id)                        AS item_count,
          0                                           AS needs_sync,
          MIN(cat.position)                           AS position
        FROM ${q.table} cat
        LEFT JOIN ${q.content} x ON x.category_id = cat.id
        WHERE cat.source_id IN (${inList}) ${nsfwFilter}
        GROUP BY cat.name
        HAVING item_count > 0
        ORDER BY item_count DESC
      `).all(...filterIds) as any[]
      rows.push(...partial)
    }
    // Stable sort so larger buckets float up across types.
    rows.sort((a, b) => (b.item_count ?? 0) - (a.item_count ?? 0))
    return rows
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

// ─── NSFW helpers ────────────────────────────────────────────────────────

/** Propagate is_nsfw from categories to content rows. Each row inherits its
 *  category's flag (or 0 if uncategorised). Called after sync and on mark/unmark. */
function applyNsfwFlags(sqlite: ReturnType<typeof getSqlite>) {
  sqlite.prepare(`UPDATE channels SET is_nsfw = COALESCE((SELECT is_nsfw FROM channel_categories WHERE id = channels.category_id), 0)`).run()
  sqlite.prepare(`UPDATE movies  SET is_nsfw = COALESCE((SELECT is_nsfw FROM movie_categories   WHERE id = movies.category_id),   0)`).run()
  sqlite.prepare(`UPDATE series  SET is_nsfw = COALESCE((SELECT is_nsfw FROM series_categories  WHERE id = series.category_id),   0)`).run()
}

// ─── Search helpers ──────────────────────────────────────────────────────
// LIKE `%query%` on `search_title`. Sync workers populate `search_title`
// inline via `normalizeForSearch` (any-ascii + lowercase) so ligatures /
// diacritics fold bidirectionally ("ae" ↔ "æ", "e" ↔ "é"). No FTS.

function g1cSearchChannels(
  query: string, categoryName: string | undefined, filterIds: string[],
  limit: number, offset: number, skipCount = false,
): { items: unknown[]; total: number } {
  const sqlite = getSqlite()
  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN channel_categories cat ON cat.id = c.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  const nsfwWhere = getSetting('allow_adult') !== '0' ? '' : 'AND c.is_nsfw = 0'
  const normalized = normalizeForSearch(query)
  if (!normalized) return { items: [], total: 0 }
  const like = `%${normalized}%`

  const items = sqlite.prepare(`
    SELECT ${CHANNEL_SELECT}
    FROM channels c
    ${catJoin}
    WHERE c.search_title LIKE ? AND c.source_id IN (${sourceList}) ${nsfwWhere}
    LIMIT ? OFFSET ?
  `).all(...catParams, like, ...filterIds, limit, offset) as unknown[]

  if (skipCount) return { items, total: items.length }
  if (items.length === 0) return { items, total: 0 }

  const total = (sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM channels c
    ${catJoin}
    WHERE c.search_title LIKE ? AND c.source_id IN (${sourceList}) ${nsfwWhere}
  `).get(...catParams, like, ...filterIds) as { cnt: number }).cnt
  return { items, total }
}

function g1cSearchMovies(
  query: string, categoryName: string | undefined, filterIds: string[],
  limit: number, offset: number, skipCount = false,
): { items: unknown[]; total: number } {
  const sqlite = getSqlite()
  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN movie_categories cat ON cat.id = m.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  const nsfwWhere = getSetting('allow_adult') !== '0' ? '' : 'AND m.is_nsfw = 0'
  const normalized = normalizeForSearch(query)
  if (!normalized) return { items: [], total: 0 }
  const like = `%${normalized}%`

  const items = sqlite.prepare(`
    SELECT ${MOVIE_SELECT}
    FROM movies m
    ${catJoin}
    WHERE m.search_title LIKE ? AND m.source_id IN (${sourceList}) ${nsfwWhere}
    LIMIT ? OFFSET ?
  `).all(...catParams, like, ...filterIds, limit, offset) as unknown[]

  if (skipCount) return { items, total: items.length }
  if (items.length === 0) return { items, total: 0 }

  const total = (sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM movies m
    ${catJoin}
    WHERE m.search_title LIKE ? AND m.source_id IN (${sourceList}) ${nsfwWhere}
  `).get(...catParams, like, ...filterIds) as { cnt: number }).cnt
  return { items, total }
}

function g1cSearchSeries(
  query: string, categoryName: string | undefined, filterIds: string[],
  limit: number, offset: number, skipCount = false,
): { items: unknown[]; total: number } {
  const sqlite = getSqlite()
  const sourceList = filterIds.map(() => '?').join(',')
  const catJoin = categoryName
    ? `JOIN series_categories cat ON cat.id = sr.category_id AND cat.name = ?`
    : ''
  const catParams: unknown[] = categoryName ? [categoryName] : []
  const nsfwWhere = getSetting('allow_adult') !== '0' ? '' : 'AND sr.is_nsfw = 0'
  const normalized = normalizeForSearch(query)
  if (!normalized) return { items: [], total: 0 }
  const like = `%${normalized}%`

  const items = sqlite.prepare(`
    SELECT ${SERIES_SELECT}
    FROM series sr
    ${catJoin}
    WHERE sr.search_title LIKE ? AND sr.source_id IN (${sourceList}) ${nsfwWhere}
    LIMIT ? OFFSET ?
  `).all(...catParams, like, ...filterIds, limit, offset) as unknown[]

  if (skipCount) return { items, total: items.length }
  if (items.length === 0) return { items, total: 0 }

  const total = (sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM series sr
    ${catJoin}
    WHERE sr.search_title LIKE ? AND sr.source_id IN (${sourceList}) ${nsfwWhere}
  `).get(...catParams, like, ...filterIds) as { cnt: number }).cnt
  return { items, total }
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

  const allowAdult = getSetting('allow_adult') !== '0'

  if (type === 'live') {
    const sortCol: Record<string, string> = { title: 'c.title', year: 'c.md_year', rating: 'c.added_at', updated: 'c.added_at' }
    const catJoin = categoryName ? `JOIN channel_categories cat ON cat.id = c.category_id AND cat.name = ?` : ''
    const catParams: unknown[] = categoryName ? [categoryName] : []
    const nsfwWhere = allowAdult ? '' : 'AND c.is_nsfw = 0'
    const total = (sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM channels c ${catJoin} WHERE c.source_id IN (${sourceList}) ${nsfwWhere}
    `).get(...catParams, ...filterIds) as { cnt: number }).cnt
    const items = sqlite.prepare(`
      SELECT ${CHANNEL_SELECT} FROM channels c ${catJoin}
      WHERE c.source_id IN (${sourceList}) ${nsfwWhere}
      ORDER BY ${sortCol[sortBy] ?? 'c.added_at'} ${dir} LIMIT ? OFFSET ?
    `).all(...catParams, ...filterIds, limit, offset) as unknown[]
    return { items, total }
  }

  if (type === 'movie') {
    const sortCol: Record<string, string> = { title: 'm.title', year: 'm.md_year', rating: 'm.added_at', updated: 'm.added_at' }
    const catJoin = categoryName ? `JOIN movie_categories cat ON cat.id = m.category_id AND cat.name = ?` : ''
    const catParams: unknown[] = categoryName ? [categoryName] : []
    const nsfwWhere = allowAdult ? '' : 'AND m.is_nsfw = 0'
    const total = (sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM movies m ${catJoin} WHERE m.source_id IN (${sourceList}) ${nsfwWhere}
    `).get(...catParams, ...filterIds) as { cnt: number }).cnt
    const items = sqlite.prepare(`
      SELECT ${MOVIE_SELECT} FROM movies m ${catJoin}
      WHERE m.source_id IN (${sourceList}) ${nsfwWhere}
      ORDER BY ${sortCol[sortBy] ?? 'm.added_at'} ${dir} LIMIT ? OFFSET ?
    `).all(...catParams, ...filterIds, limit, offset) as unknown[]
    return { items, total }
  }

  if (type === 'series') {
    const sortCol: Record<string, string> = { title: 'sr.title', year: 'sr.md_year', rating: 'sr.added_at', updated: 'sr.added_at' }
    const catJoin = categoryName ? `JOIN series_categories cat ON cat.id = sr.category_id AND cat.name = ?` : ''
    const catParams: unknown[] = categoryName ? [categoryName] : []
    const nsfwWhere = allowAdult ? '' : 'AND sr.is_nsfw = 0'
    const total = (sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM series sr ${catJoin} WHERE sr.source_id IN (${sourceList}) ${nsfwWhere}
    `).get(...catParams, ...filterIds) as { cnt: number }).cnt
    const items = sqlite.prepare(`
      SELECT ${SERIES_SELECT} FROM series sr ${catJoin}
      WHERE sr.source_id IN (${sourceList}) ${nsfwWhere}
      ORDER BY ${sortCol[sortBy] ?? 'sr.added_at'} ${dir} LIMIT ? OFFSET ?
    `).all(...catParams, ...filterIds, limit, offset) as unknown[]
    return { items, total }
  }

  // type undefined (All): concat live + movies + series. Category name filter
  // is ambiguous across types here, so we ignore it when type is undefined.
  // Each subquery is capped at (limit + offset) so we never load the whole DB.
  const cap = limit + offset
  const chans  = sqlite.prepare(`
    SELECT ${CHANNEL_SELECT} FROM channels c
    WHERE c.source_id IN (${sourceList})
    ORDER BY c.added_at DESC LIMIT ?
  `).all(...filterIds, cap) as unknown[]
  const movies = sqlite.prepare(`
    SELECT ${MOVIE_SELECT} FROM movies m
    WHERE m.source_id IN (${sourceList})
    ORDER BY m.added_at DESC LIMIT ?
  `).all(...filterIds, cap) as unknown[]
  const sers   = sqlite.prepare(`
    SELECT ${SERIES_SELECT} FROM series sr
    WHERE sr.source_id IN (${sourceList})
    ORDER BY sr.added_at DESC LIMIT ?
  `).all(...filterIds, cap) as unknown[]
  const totalRow = sqlite.prepare(`
    SELECT
      (SELECT COUNT(*) FROM channels WHERE source_id IN (${sourceList})) +
      (SELECT COUNT(*) FROM movies   WHERE source_id IN (${sourceList})) +
      (SELECT COUNT(*) FROM series   WHERE source_id IN (${sourceList})) AS n
  `).get(...filterIds, ...filterIds, ...filterIds) as { n: number }
  const merged = [...chans, ...movies, ...sers]
  return { items: merged.slice(offset, offset + limit), total: totalRow.n }
}

// ─── Helpers: user-data mutation + read ──────────────────────────────────

function readUserData(sqlite: ReturnType<typeof getSqlite>, contentId: string) {
  const kind = idKind(contentId)
  let fav = 0, wl = 0, rating: number | null = null, favSort: number | null = null
  let position = 0, lastWatched: number | null = null, completed = 0

  if (kind === 'channel') {
    const row = sqlite.prepare(`SELECT * FROM channel_user_data WHERE profile_id = ? AND channel_id = ?`).get(DEFAULT_PROFILE, contentId) as any
    if (row) { fav = row.is_favorite ?? 0; favSort = row.fav_sort_order ?? null }
  } else if (kind === 'movie') {
    const row = sqlite.prepare(`SELECT * FROM movie_user_data WHERE profile_id = ? AND movie_id = ?`).get(DEFAULT_PROFILE, contentId) as any
    if (row) {
      fav = row.is_favorite ?? 0; wl = row.is_watchlisted ?? 0
      rating = row.rating ?? null; favSort = row.fav_sort_order ?? null
      position = row.watch_position ?? 0; lastWatched = row.last_watched_at ?? null; completed = row.completed ?? 0
    }
  } else if (kind === 'series') {
    const row = sqlite.prepare(`SELECT * FROM series_user_data WHERE profile_id = ? AND series_id = ?`).get(DEFAULT_PROFILE, contentId) as any
    if (row) { fav = row.is_favorite ?? 0; wl = row.is_watchlisted ?? 0; rating = row.rating ?? null; favSort = row.fav_sort_order ?? null }
  } else if (kind === 'episode') {
    const ep = sqlite.prepare(`SELECT series_id FROM episodes WHERE id = ?`).get(contentId) as { series_id?: string } | undefined
    const sud = sqlite.prepare(`SELECT * FROM episode_user_data WHERE profile_id = ? AND episode_id = ?`).get(DEFAULT_PROFILE, contentId) as any
    if (sud) { position = sud.watch_position ?? 0; lastWatched = sud.last_watched_at ?? null; completed = sud.completed ?? 0 }
    if (ep?.series_id) {
      const srow = sqlite.prepare(`SELECT * FROM series_user_data WHERE profile_id = ? AND series_id = ?`).get(DEFAULT_PROFILE, ep.series_id) as any
      if (srow) { fav = srow.is_favorite ?? 0; wl = srow.is_watchlisted ?? 0; rating = srow.rating ?? null }
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

function toggleFavorite(sqlite: ReturnType<typeof getSqlite>, contentId: string): boolean {
  const kind = idKind(contentId)
  if (kind === 'channel') {
    sqlite.prepare(`
      INSERT INTO channel_user_data (profile_id, channel_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, channel_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, contentId)
    const row = sqlite.prepare(`SELECT is_favorite FROM channel_user_data WHERE profile_id = ? AND channel_id = ?`).get(DEFAULT_PROFILE, contentId) as any
    return !!row?.is_favorite
  }
  if (kind === 'movie') {
    sqlite.prepare(`
      INSERT INTO movie_user_data (profile_id, movie_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, movie_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, contentId)
    const row = sqlite.prepare(`SELECT is_favorite FROM movie_user_data WHERE profile_id = ? AND movie_id = ?`).get(DEFAULT_PROFILE, contentId) as any
    return !!row?.is_favorite
  }
  if (kind === 'series') {
    sqlite.prepare(`
      INSERT INTO series_user_data (profile_id, series_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, series_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, contentId)
    const row = sqlite.prepare(`SELECT is_favorite FROM series_user_data WHERE profile_id = ? AND series_id = ?`).get(DEFAULT_PROFILE, contentId) as any
    return !!row?.is_favorite
  }
  if (kind === 'episode') {
    const ep = sqlite.prepare(`SELECT series_id FROM episodes WHERE id = ?`).get(contentId) as { series_id?: string } | undefined
    if (!ep?.series_id) return false
    return toggleFavorite(sqlite, ep.series_id)
  }
  return false
}

function toggleWatchlist(sqlite: ReturnType<typeof getSqlite>, contentId: string): boolean {
  const kind = idKind(contentId)
  if (kind === 'movie') {
    sqlite.prepare(`
      INSERT INTO movie_user_data (profile_id, movie_id, is_watchlisted)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, movie_id) DO UPDATE SET is_watchlisted = NOT is_watchlisted
    `).run(DEFAULT_PROFILE, contentId)
    const row = sqlite.prepare(`SELECT is_watchlisted FROM movie_user_data WHERE profile_id = ? AND movie_id = ?`).get(DEFAULT_PROFILE, contentId) as any
    return !!row?.is_watchlisted
  }
  if (kind === 'series') {
    sqlite.prepare(`
      INSERT INTO series_user_data (profile_id, series_id, is_watchlisted)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, series_id) DO UPDATE SET is_watchlisted = NOT is_watchlisted
    `).run(DEFAULT_PROFILE, contentId)
    const row = sqlite.prepare(`SELECT is_watchlisted FROM series_user_data WHERE profile_id = ? AND series_id = ?`).get(DEFAULT_PROFILE, contentId) as any
    return !!row?.is_watchlisted
  }
  if (kind === 'episode') {
    const ep = sqlite.prepare(`SELECT series_id FROM episodes WHERE id = ?`).get(contentId) as { series_id?: string } | undefined
    if (!ep?.series_id) return false
    return toggleWatchlist(sqlite, ep.series_id)
  }
  // Channels do not have a watchlist.
  return false
}

function listFavorites(sqlite: ReturnType<typeof getSqlite>, type?: 'live' | 'movie' | 'series'): unknown[] {
  const results: unknown[] = []

  if (!type || type === 'movie') {
    const rows = sqlite.prepare(`
      SELECT ${MOVIE_SELECT},
             ud.fav_sort_order            AS fav_sort_order,
             ud.last_watched_at           AS last_watched_at,
             1                             AS favorite
      FROM movie_user_data ud
      JOIN movies m ON m.id = ud.movie_id
      JOIN sources src ON src.id = m.source_id AND src.disabled = 0
      WHERE ud.is_favorite = 1 AND ud.profile_id = ?
      ORDER BY COALESCE(ud.fav_sort_order, 999999) ASC, ud.last_watched_at DESC
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  if (!type || type === 'series') {
    const rows = sqlite.prepare(`
      SELECT ${SERIES_SELECT},
             ud.fav_sort_order            AS fav_sort_order,
             NULL                          AS last_watched_at,
             1                             AS favorite
      FROM series_user_data ud
      JOIN series sr ON sr.id = ud.series_id
      JOIN sources src ON src.id = sr.source_id AND src.disabled = 0
      WHERE ud.is_favorite = 1 AND ud.profile_id = ?
      ORDER BY COALESCE(ud.fav_sort_order, 999999) ASC
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  if (!type || type === 'live') {
    const rows = sqlite.prepare(`
      SELECT ${CHANNEL_SELECT},
             cud.fav_sort_order            AS fav_sort_order,
             NULL                           AS last_watched_at,
             1                             AS favorite
      FROM channel_user_data cud
      JOIN channels c ON c.id = cud.channel_id
      JOIN sources src ON src.id = c.source_id AND src.disabled = 0
      WHERE cud.is_favorite = 1 AND cud.profile_id = ?
      ORDER BY COALESCE(cud.fav_sort_order, 999999) ASC
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  return results
}

function listWatchlist(sqlite: ReturnType<typeof getSqlite>, type?: 'live' | 'movie' | 'series'): unknown[] {
  const results: unknown[] = []
  if (!type || type === 'movie') {
    const rows = sqlite.prepare(`
      SELECT ${MOVIE_SELECT},
             ud.last_watched_at           AS last_watched_at
      FROM movie_user_data ud
      JOIN movies m ON m.id = ud.movie_id
      JOIN sources src ON src.id = m.source_id AND src.disabled = 0
      WHERE ud.is_watchlisted = 1 AND ud.profile_id = ?
      ORDER BY ud.last_watched_at DESC
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  if (!type || type === 'series') {
    const rows = sqlite.prepare(`
      SELECT ${SERIES_SELECT}
      FROM series_user_data ud
      JOIN series sr ON sr.id = ud.series_id
      JOIN sources src ON src.id = sr.source_id AND src.disabled = 0
      WHERE ud.is_watchlisted = 1 AND ud.profile_id = ?
    `).all(DEFAULT_PROFILE) as unknown[]
    results.push(...rows)
  }
  return results
}

function listContinueWatching(sqlite: ReturnType<typeof getSqlite>, type?: 'movie' | 'series'): unknown[] {
  const moviesSql = `
    SELECT ${MOVIE_SELECT},
           ud.watch_position AS last_position,
           ud.last_watched_at
    FROM movie_user_data ud
    JOIN movies m ON m.id = ud.movie_id
    JOIN sources src ON src.id = m.source_id AND src.disabled = 0
    WHERE ud.watch_position > 0 AND ud.completed = 0 AND ud.profile_id = ?
    ORDER BY ud.last_watched_at DESC
    LIMIT 20
  `

  // Series: most-recent in-progress episode per parent series.
  // Keyed on episodes.series_id; episode_user_data holds position/last_watched.
  const seriesSql = `
    WITH ranked_episodes AS (
      SELECT
        e.series_id,
        e.id                    AS resume_episode_id,
        e.season                AS resume_season_number,
        e.episode_num           AS resume_episode_number,
        e.title                 AS resume_episode_title,
        ud.watch_position       AS last_position,
        ud.last_watched_at,
        ROW_NUMBER() OVER (PARTITION BY e.series_id ORDER BY ud.last_watched_at DESC) AS rn
      FROM episode_user_data ud
      JOIN episodes e ON e.id = ud.episode_id
      WHERE ud.watch_position > 0 AND ud.completed = 0 AND ud.profile_id = ?
    )
    SELECT ${SERIES_SELECT},
           r.resume_episode_id, r.resume_season_number, r.resume_episode_number,
           r.resume_episode_title, r.last_position, r.last_watched_at
    FROM ranked_episodes r
    JOIN series sr ON sr.id = r.series_id
    JOIN sources src ON src.id = sr.source_id AND src.disabled = 0
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
  // Movie history.
  const movieRows = sqlite.prepare(`
    SELECT ${MOVIE_SELECT},
           ud.watch_position AS last_position,
           ud.last_watched_at
    FROM movie_user_data ud
    JOIN movies m ON m.id = ud.movie_id
    JOIN sources src ON src.id = m.source_id AND src.disabled = 0
    WHERE ud.last_watched_at IS NOT NULL AND ud.profile_id = ?
    ORDER BY ud.last_watched_at DESC
    LIMIT ?
  `).all(DEFAULT_PROFILE, limit) as any[]

  // Series history — collapse per-series to the most recent episode.
  const episodeRows = sqlite.prepare(`
    WITH ranked_episodes AS (
      SELECT
        e.series_id,
        e.id                    AS resume_episode_id,
        e.season                AS resume_season_number,
        e.episode_num           AS resume_episode_number,
        e.title                 AS resume_episode_title,
        ud.watch_position       AS last_position,
        ud.last_watched_at,
        ROW_NUMBER() OVER (PARTITION BY e.series_id ORDER BY ud.last_watched_at DESC) AS rn
      FROM episode_user_data ud
      JOIN episodes e ON e.id = ud.episode_id
      WHERE ud.last_watched_at IS NOT NULL AND ud.profile_id = ?
    )
    SELECT ${SERIES_SELECT},
           r.resume_episode_id, r.resume_season_number, r.resume_episode_number,
           r.resume_episode_title, r.last_position, r.last_watched_at
    FROM ranked_episodes r
    JOIN series sr ON sr.id = r.series_id
    JOIN sources src ON src.id = sr.source_id AND src.disabled = 0
    WHERE r.rn = 1
    ORDER BY r.last_watched_at DESC
    LIMIT ?
  `).all(DEFAULT_PROFILE, limit) as any[]

  const seen = new Set<string>()
  return [...movieRows, ...episodeRows]
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
