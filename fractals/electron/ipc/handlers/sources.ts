// ─── Source handlers ──────────────────────────────────────────────────────────
// Covers: sources:list/add/test/remove/update/toggle + export/import + factory-reset

import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { getDb, getSqlite } from '../../database/connection'
import { sources } from '../../database/schema'
import { eq } from 'drizzle-orm'
import { xtreamService } from '../../services/xtream.service'
import { m3uService } from '../../services/m3u.service'
import { syncEpg } from '../../services/epg.service'
import {
  CountRow, SourceRow, DisabledRow,
  DEFAULT_PROFILE, dbPath,
  invalidateEnabledSources, applyNsfwFlags,
  activeSyncWorkers,
} from './shared'
import { runPostSyncChain, activePostSyncChains } from './sync'

export function registerSourceHandlers(ipcMain_: typeof ipcMain): void {
  // ── Ping ────────────────────────────────────────────────────────────────
  ipcMain_.handle('ping', () => 'pong')

  // ── File dialog ────────────────────────────────────────────────────────
  ipcMain_.handle('dialog:open-file', async (event, args: { filters?: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: args?.filters ?? [{ name: 'All Files', extensions: ['*'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    return { canceled: false, filePath: result.filePaths[0] }
  })

  ipcMain_.handle('dialog:save-file', async (event, args: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: args?.defaultPath,
      filters: args?.filters ?? [{ name: 'All Files', extensions: ['*'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    return { canceled: false, filePath: result.filePath }
  })

  // ── DevTools ───────────────────────────────────────────────────────────
  ipcMain_.handle('devtools:toggle', (event) => {
    event.sender.toggleDevTools()
  })

  // ── Sources ────────────────────────────────────────────────────────────
  ipcMain_.handle('sources:list', async () => {
    const db = getDb()
    const rows = await db.select().from(sources).all()
    return rows.map((s) => ({ ...s, colorIndex: (s as unknown as { color_index?: number }).color_index ?? undefined }))
  })

  ipcMain_.handle('sources:set-color', (_event, sourceId: string, colorIndex: number) => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE sources SET color_index = ? WHERE id = ?`).run(colorIndex, sourceId)
    return { ok: true }
  })

  // ── Export — g1c snapshot format (version 4) ─────────────────────────
  // Dumps the 15 content/category tables plus optional user_data. Old
  // version-3 exports (from g1) are rejected on import — schema diverged
  // beyond clean mapping.
  ipcMain_.handle('sources:export', async (event, opts: { includeUserData?: boolean } = {}) => {
    const sqlite = getSqlite()

    const srcs = sqlite.prepare(`
      SELECT id, type, name, server_url, username, password, m3u_url, epg_url, status, disabled, color_index
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

  ipcMain_.handle('sources:import', (_event, filePath: string) => {
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

    invalidateEnabledSources()
    return { count: parsed.sources.length }
  })

  ipcMain_.handle('sources:factory-reset', () => {
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
    invalidateEnabledSources()
    return { ok: true }
  })

  ipcMain_.handle('sources:total-count', () => {
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

  ipcMain_.handle('sources:add-xtream', async (_event, args: {
    name: string; serverUrl: string; username: string; password: string
  }) => {
    const result = await xtreamService.addSource(args.name, args.serverUrl, args.username, args.password)
    invalidateEnabledSources()
    return result
  })

  ipcMain_.handle('sources:test-xtream', async (_event, args: {
    serverUrl: string; username: string; password: string
  }) => xtreamService.testConnection(args.serverUrl, args.username, args.password))

  // Test an already-added source by ID. Advances ingest_state to 'tested' on
  // success. Idempotent: re-testing a 'synced'+ source does NOT regress the
  // state (forward-only unlock).
  ipcMain_.handle('sources:test', async (_event, sourceId: string) => {
    const sqlite = getSqlite()
    const src = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
    if (!src) return { success: false, error: 'Source not found' }

    const result = src.type === 'm3u' && src.m3u_url
      ? await m3uService.testConnection(src.m3u_url)
      : await xtreamService.testConnection(src.server_url, src.username, src.password)

    const ok = 'success' in result ? result.success : !result.error
    if (ok && src.ingest_state === 'added') {
      sqlite.prepare(`UPDATE sources SET ingest_state = 'tested' WHERE id = ?`).run(sourceId)
    }
    return result
  })

  ipcMain_.handle('sources:test-m3u', async (_event, args: { m3uUrl: string }) => m3uService.testConnection(args.m3uUrl))
  ipcMain_.handle('sources:add-m3u',  async (_event, args: { name: string; m3uUrl: string }) => {
    const result = await m3uService.addSource(args.name, args.m3uUrl)
    invalidateEnabledSources()
    return result
  })

  ipcMain_.handle('sources:remove', async (_event, sourceId: string) => {
    const workerPath = join(__dirname, '..', 'delete.worker.js')
    const result = await new Promise((resolve) => {
      const worker = new Worker(workerPath, { workerData: { sourceId, dbPath: dbPath() } })
      worker.on('message', (msg: any) => resolve(msg))
      worker.on('error', (err) => resolve({ success: false, error: String(err) }))
      worker.on('exit', (code) => { if (code !== 0) resolve({ success: false, error: `Worker exited with code ${code}` }) })
    })
    invalidateEnabledSources()
    return result
  })

  ipcMain_.handle('sources:account-info', async (_event, sourceId: string) => {
    const sqlite = getSqlite()
    const source = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
    if (!source?.server_url) return { error: 'Source not found' }
    return xtreamService.testConnection(source.server_url, source.username, source.password)
  })

  ipcMain_.handle('sources:startup-check', async (event) => {
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

  ipcMain_.handle('sources:update', async (_event, args: {
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

  ipcMain_.handle('sources:toggle-disabled', async (_event, sourceId: string) => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE sources SET disabled = NOT disabled WHERE id = ?`).run(sourceId)
    invalidateEnabledSources()
    const row = sqlite.prepare(`SELECT disabled FROM sources WHERE id = ?`).get(sourceId) as DisabledRow | undefined
    return { disabled: !!row?.disabled }
  })

  ipcMain_.handle('sources:sync', async (event, sourceId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sqlite = getSqlite()

    const source = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
    if (!source) return { success: false, error: 'Source not found' }

    const isM3u = source.type === 'm3u'
    const workerPath = join(__dirname, '..', isM3u ? 'm3u-sync.worker.js' : 'sync.worker.js')
    const wData = isM3u
      ? { sourceId, dbPath: dbPath(), m3uUrl: source.m3u_url, sourceName: source.name }
      : { sourceId, dbPath: dbPath(), serverUrl: source.server_url, username: source.username, password: source.password, sourceName: source.name }

    if (!isM3u && !source.server_url) return { success: false, error: 'Source not found' }
    if (isM3u && !source.m3u_url) return { success: false, error: 'M3U URL not found' }

    const SYNC_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

    // Cancel any running post-sync chain for this source before starting fresh
    activePostSyncChains.delete(sourceId)

    return new Promise((resolve) => {
      const worker = new Worker(workerPath, { workerData: wData })
      activeSyncWorkers.set(sourceId, worker)

      const syncTimeout = setTimeout(() => {
        worker.terminate()
        activeSyncWorkers.delete(sourceId)
        win?.webContents.send('sync:progress', {
          sourceId, phase: 'error', current: 0, total: 0, message: 'Sync timed out after 15 minutes',
        })
        resolve({ success: false, error: 'Sync timed out' })
      }, SYNC_TIMEOUT_MS)

      worker.on('message', (msg: any) => {
        if (msg.type === 'progress') {
          win?.webContents.send('sync:progress', {
            sourceId, phase: msg.phase, current: msg.current, total: msg.total, message: msg.message,
          })
        } else if (msg.type === 'done') {
          clearTimeout(syncTimeout)
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
            const syncMsg = `Synced ${msg.catCount} categories, ${msg.totalItems.toLocaleString()} items`
            const epgSuffix = epgResult
              ? (epgResult.error ? ` · EPG failed: ${epgResult.error}` : ` · EPG ${Number(epgResult.inserted ?? 0).toLocaleString()} entries`)
              : ''
            win?.webContents.send('sync:progress', {
              sourceId, phase: 'post-sync', current: msg.totalItems, total: msg.totalItems,
              message: syncMsg + epgSuffix,
            })
            resolve({ success: true })
            // Chain: iptv-org match → populate metadata (fire and forget)
            runPostSyncChain(sourceId, win, sqlite).catch(() => {})
          })
        } else if (msg.type === 'warning') {
          win?.webContents.send('sync:progress', {
            sourceId, phase: 'warning', current: 0, total: 0, message: msg.message,
          })
        } else if (msg.type === 'error') {
          clearTimeout(syncTimeout)
          win?.webContents.send('sync:progress', {
            sourceId, phase: 'error', current: 0, total: 0, message: msg.message,
          })
          resolve({ success: false, error: msg.message })
        }
      })

      worker.on('error', (err) => {
        clearTimeout(syncTimeout)
        activeSyncWorkers.delete(sourceId)
        win?.webContents.send('sync:progress', {
          sourceId, phase: 'error', current: 0, total: 0, message: String(err),
        })
        resolve({ success: false, error: String(err) })
      })

      worker.on('exit', (code) => {
        clearTimeout(syncTimeout)
        activeSyncWorkers.delete(sourceId)
        if (code !== 0) resolve({ success: false, error: `Worker exited with code ${code}` })
      })
    })
  })
}

