import { ipcMain, BrowserWindow, app, dialog } from 'electron'
import { spawn } from 'child_process'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { getDb, getSqlite, getSetting, setSetting, rebuildFtsIfNeeded } from '../database/connection'
import { sources } from '../database/schema'
import { eq } from 'drizzle-orm'
import { xtreamService } from '../services/xtream.service'
import { m3uService } from '../services/m3u.service'
import { tmdbService } from '../services/tmdb.service'
import { syncEpg, getNowNext } from '../services/epg.service'
import { normalizeForSearch } from '../lib/normalize'

// ── Minimal interfaces for raw SQLite query results ─────────────────────────
// These replace `as any` on the most dangerous direct-property-access patterns.

/** Result of `SELECT COUNT(*) as n FROM ...` */
interface CountRow { n: number }

/** Result of `SELECT canonical_id FROM streams WHERE id = ?` */
interface StreamCanonicalRef { canonical_id: string }

/** Result of `SELECT canonical_id, type FROM streams WHERE id = ?` */
interface StreamCanonicalTypeRef { canonical_id: string; type: string }

/** Result of `SELECT * FROM streams WHERE id = ?` */
interface StreamRow {
  id: string; source_id: string; stream_id: string; type: string
  title: string; category_id?: string; thumbnail_url?: string
  container_extension?: string; stream_url?: string
  catchup_supported?: number; catchup_days?: number
  epg_channel_id?: string; canonical_id?: string
}

/** Result of `SELECT * FROM sources WHERE id = ?` (raw SQLite, not Drizzle) */
interface SourceRow {
  id: string; type: string; name: string
  server_url: string; username: string; password: string
  m3u_url?: string; status?: string; disabled?: number
  color_index?: number; last_epg_sync?: number
}

/** Result of `SELECT value FROM settings WHERE key = ?` */
interface SettingRow { value: string }

/** Result of `SELECT disabled FROM sources WHERE id = ?` */
interface DisabledRow { disabled: number }

/** Result of `SELECT is_favorite FROM user_data ...` */
interface FavoriteRow { is_favorite: number }

/** Result of `SELECT is_watchlisted FROM user_data ...` */
interface WatchlistRow { is_watchlisted: number }

/** Result of `SELECT * FROM user_data WHERE canonical_id = ? ...` */
interface UserDataRow {
  canonical_id: string; profile_id: string
  is_favorite?: number; is_watchlisted?: number; rating?: number
  watch_position?: number; last_watched_at?: string; completed?: number
  fav_sort_order?: number
}

const EPG_REFRESH_INTERVAL_HOURS = 24

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

export function registerHandlers() {

  // Load TMDB key from DB and activate it immediately
  const storedTmdbKey = getSetting('tmdb_api_key')
  if (storedTmdbKey) tmdbService.setApiKey(storedTmdbKey)

  // Rebuild FTS index in background if needed (one-time after Unicode normalization upgrade)
  rebuildFtsIfNeeded().catch(console.error)

  // ── Ping (health check) ──────────────────────────────────────────────────
  ipcMain.handle('ping', () => 'pong')

  // ── File dialog ──────────────────────────────────────────────────────────
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

  // ── DevTools ─────────────────────────────────────────────────────────────
  ipcMain.handle('devtools:toggle', (event) => {
    event.sender.toggleDevTools()
  })

  // ── Sources ──────────────────────────────────────────────────────────────

  ipcMain.handle('sources:list', async () => {
    const db = getDb()
    const sqlite = getSqlite()
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

    const sources = sqlite.prepare(`
      SELECT id, type, name, server_url, username, password, m3u_url, status, disabled, color_index
      FROM sources ORDER BY created_at ASC
    `).all()

    // Settings: export non-UI keys (tmdb key + any future service keys)
    const settingKeys = ['tmdb_api_key']
    const settings: Record<string, string> = {}
    for (const key of settingKeys) {
      const row = sqlite.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as SettingRow | undefined
      if (row?.value) settings[key] = row.value
    }

    const payload: any = {
      version: 1,
      exported_at: new Date().toISOString(),
      sources,
      settings,
    }

    if (opts.includeUserData) {
      payload.user_data = sqlite.prepare(`SELECT * FROM user_data`).all()
    }

    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `fractals-backup-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8')
    return { canceled: false, count: (sources as any[]).length }
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
    const insertUserData = sqlite.prepare(`
      INSERT OR REPLACE INTO user_data (canonical_id, profile_id, is_favorite, fav_sort_order, is_watchlisted, rating, watch_position, watch_duration, last_watched_at, completed)
      SELECT @canonical_id, @profile_id, @is_favorite, @fav_sort_order, @is_watchlisted, @rating, @watch_position, @watch_duration, @last_watched_at, @completed
      WHERE EXISTS (SELECT 1 FROM canonical WHERE id = @canonical_id)
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

        if (parsed.settings) {
          const upsertSetting = sqlite.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`)
          for (const [key, value] of Object.entries(parsed.settings)) {
            upsertSetting.run(key, value)
          }
          // Re-activate TMDB key if present
          if (parsed.settings.tmdb_api_key) tmdbService.setApiKey(parsed.settings.tmdb_api_key)
        }

        if (Array.isArray(parsed.user_data)) {
          for (const row of parsed.user_data) insertUserData.run(row)
        }
      })()

      // Count orphaned user_data rows (canonical_id references that don't exist yet)
      const orphaned = (sqlite.prepare('SELECT COUNT(*) as n FROM user_data WHERE canonical_id NOT IN (SELECT id FROM canonical)').get() as CountRow)!.n

      return { ok: true, count: parsed.sources.length, orphanedUserData: orphaned }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  ipcMain.handle('sources:factory-reset', () => {
    const sqlite = getSqlite()
    sqlite.pragma('foreign_keys = OFF')
    try {
      sqlite.transaction(() => {
        sqlite.prepare(`DELETE FROM user_data`).run()
        sqlite.prepare(`DELETE FROM epg`).run()
        sqlite.prepare(`DELETE FROM stream_categories`).run()
        sqlite.prepare(`DELETE FROM streams`).run()
        sqlite.prepare(`DELETE FROM canonical_fts`).run()
        sqlite.prepare(`DELETE FROM canonical`).run()
        sqlite.prepare(`DELETE FROM categories`).run()
        sqlite.prepare(`DELETE FROM sources`).run()
        sqlite.prepare(`DELETE FROM settings WHERE key NOT LIKE 'migration_%'`).run()
        try { sqlite.prepare(`DELETE FROM embeddings`).run() } catch {}
      })()
    } finally {
      sqlite.pragma('foreign_keys = ON')
    }
    return { ok: true }
  })

  // Total content count across all enabled sources
  ipcMain.handle('sources:total-count', () => {
    const sqlite = getSqlite()
    const row = sqlite.prepare(`
      SELECT COUNT(*) as n FROM streams s
      JOIN sources src ON src.id = s.source_id AND src.disabled = 0
    `).get() as CountRow | undefined
    return row?.n ?? 0
  })

  ipcMain.handle('sources:add-xtream', async (_event, args: {
    name: string
    serverUrl: string
    username: string
    password: string
  }) => {
    return xtreamService.addSource(args.name, args.serverUrl, args.username, args.password)
  })

  ipcMain.handle('sources:test-xtream', async (_event, args: {
    serverUrl: string
    username: string
    password: string
  }) => {
    return xtreamService.testConnection(args.serverUrl, args.username, args.password)
  })

  ipcMain.handle('sources:test-m3u', async (_event, args: { m3uUrl: string }) => {
    return m3uService.testConnection(args.m3uUrl)
  })

  ipcMain.handle('sources:add-m3u', async (_event, args: { name: string; m3uUrl: string }) => {
    return m3uService.addSource(args.name, args.m3uUrl)
  })

  ipcMain.handle('sources:remove', async (_event, sourceId: string) => {
    const dbPath = join(app.getPath('userData'), 'data', process.env.FRACTALS_DB ? `fractals-${process.env.FRACTALS_DB}.db` : 'fractaltv.db')
    const workerPath = join(__dirname, 'delete.worker.js')

    return new Promise((resolve) => {
      const worker = new Worker(workerPath, {
        workerData: { sourceId, dbPath },
      })
      worker.on('message', (msg: any) => resolve(msg))
      worker.on('error', (err) => resolve({ success: false, error: String(err) }))
      worker.on('exit', (code) => {
        if (code !== 0) resolve({ success: false, error: `Worker exited with code ${code}` })
      })
    })
  })

  // Live account info from Xtream API (always fresh)
  ipcMain.handle('sources:account-info', async (_event, sourceId: string) => {
    const sqlite = getSqlite()
    const source = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
    if (!source?.server_url) return { error: 'Source not found' }
    return xtreamService.testConnection(source.server_url, source.username, source.password)
  })

  // Startup health check — tests all active sources, stores results, emits events
  ipcMain.handle('sources:startup-check', async (event) => {
    const sqlite = getSqlite()
    const db = getDb()
    const activeSources = sqlite.prepare(
      `SELECT * FROM sources WHERE disabled = 0 AND type = 'xtream'`
    ).all() as any[]

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

    // Refresh stale EPG in background — any source whose EPG hasn't been fetched
    // or was last fetched more than EPG_REFRESH_INTERVAL_HOURS ago
    const staleThreshold = Math.floor(Date.now() / 1000) - EPG_REFRESH_INTERVAL_HOURS * 3600
    const staleSources = sqlite.prepare(`
      SELECT * FROM sources
      WHERE disabled = 0 AND server_url IS NOT NULL
        AND (last_epg_sync IS NULL OR last_epg_sync < ?)
    `).all(staleThreshold) as any[]

    for (const src of staleSources) {
      runEpgSync(sqlite, win, src.id, src)
    }

    return { done: true }
  })

  ipcMain.handle('sources:update', async (_event, args: {
    sourceId: string
    name?: string
    serverUrl?: string
    username?: string
    password?: string
    m3uUrl?: string
  }) => {
    const sqlite = getSqlite()
    const sets: string[] = []
    const params: any[] = []
    if (args.name !== undefined) { sets.push('name = ?'); params.push(args.name) }
    if (args.serverUrl !== undefined) { sets.push('server_url = ?'); params.push(args.serverUrl.replace(/\/$/, '')) }
    if (args.username !== undefined) { sets.push('username = ?'); params.push(args.username) }
    if (args.password !== undefined) { sets.push('password = ?'); params.push(args.password) }
    if (args.m3uUrl !== undefined) { sets.push('m3u_url = ?'); params.push(args.m3uUrl) }
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

    // Get source info
    const source = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
    if (!source) return { success: false, error: 'Source not found' }

    // DB path — same as what connection.ts uses
    const dbPath = join(app.getPath('userData'), 'data', process.env.FRACTALS_DB ? `fractals-${process.env.FRACTALS_DB}.db` : 'fractaltv.db')

    // Pick worker + workerData based on source type
    const isM3u = source.type === 'm3u'
    const workerPath = join(__dirname, isM3u ? 'm3u-sync.worker.js' : 'sync.worker.js')
    const wData = isM3u
      ? { sourceId, dbPath, m3uUrl: source.m3u_url, sourceName: source.name }
      : { sourceId, dbPath, serverUrl: source.server_url, username: source.username, password: source.password, sourceName: source.name }

    if (!isM3u && !source.server_url) return { success: false, error: 'Source not found' }
    if (isM3u && !source.m3u_url) return { success: false, error: 'M3U URL not found' }

    return new Promise((resolve) => {
      const worker = new Worker(workerPath, { workerData: wData })

      worker.on('message', (msg: any) => {
        if (msg.type === 'progress') {
          win?.webContents.send('sync:progress', {
            sourceId,
            phase: msg.phase,
            current: msg.current,
            total: msg.total,
            message: msg.message,
          })
        } else if (msg.type === 'done') {
          win?.webContents.send('sync:progress', {
            sourceId,
            phase: 'done',
            current: msg.totalItems,
            total: msg.totalItems,
            message: `Synced ${msg.catCount} categories, ${msg.totalItems.toLocaleString()} items`,
          })
          resolve({ success: true })
          // Kick off EPG sync in background after content sync
          const src = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
          if (src?.server_url) {
            runEpgSync(sqlite, win, sourceId, src)
          }
        } else if (msg.type === 'warning') {
          win?.webContents.send('sync:progress', {
            sourceId,
            phase: 'warning',
            current: 0,
            total: 0,
            message: msg.message,
          })
        } else if (msg.type === 'error') {
          win?.webContents.send('sync:progress', {
            sourceId,
            phase: 'error',
            current: 0,
            total: 0,
            message: msg.message,
          })
          resolve({ success: false, error: msg.message })
        }
      })

      worker.on('error', (err) => {
        win?.webContents.send('sync:progress', {
          sourceId,
          phase: 'error',
          current: 0,
          total: 0,
          message: String(err),
        })
        resolve({ success: false, error: String(err) })
      })

      worker.on('exit', (code) => {
        if (code !== 0) {
          resolve({ success: false, error: `Worker exited with code ${code}` })
        }
      })
    })
  })

  // ── EPG ──────────────────────────────────────────────────────────────────

  ipcMain.handle('epg:sync', async (event, sourceId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sqlite = getSqlite()
    const source = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
    if (!source?.server_url) return { success: false, error: 'Source not found' }

    const result = await syncEpg(
      sourceId,
      source.server_url,
      source.username,
      source.password,
      (msg) => win?.webContents.send('epg:progress', { sourceId, message: msg })
    )

    return result.error ? { success: false, ...result } : { success: true, ...result }
  })

  ipcMain.handle('epg:now-next', (_event, contentId: string) => {
    return getNowNext(contentId)
  })

  ipcMain.handle('epg:guide', (_event, args: { contentIds: string[]; startTime?: number; endTime?: number }) => {
    const sqlite = getSqlite()
    const now = Math.floor(Date.now() / 1000)
    const startTime = args.startTime ?? (now - 4 * 3600)
    const endTime = args.endTime ?? (now + 20 * 3600)

    if (!args.contentIds?.length) return { channels: [], programmes: {}, windowStart: startTime, windowEnd: endTime }

    const placeholders = args.contentIds.map(() => '?').join(',')
    const rows = sqlite.prepare(`
      SELECT s.id, COALESCE(c.title, s.title) as title,
             COALESCE(c.poster_path, s.thumbnail_url) as poster_url,
             s.epg_channel_id, s.source_id as primary_source_id,
             s.catchup_supported, s.catchup_days,
             s.stream_id as external_id
      FROM streams s
      LEFT JOIN canonical c ON c.id = s.canonical_id
      WHERE s.id IN (${placeholders}) AND s.type = 'live'
    `).all(...args.contentIds) as any[]

    const programmes: Record<string, any[]> = {}

    // Build mapping: epg_channel_id+source_id → content id(s)
    const epgKeyToContentIds: Record<string, string[]> = {}
    const epgChannelIds: string[] = []
    const epgSourceIds: string[] = []
    for (const ch of rows) {
      if (!ch.epg_channel_id) {
        programmes[ch.id] = []
        continue
      }
      const key = `${ch.epg_channel_id}|${ch.primary_source_id}`
      if (!epgKeyToContentIds[key]) {
        epgKeyToContentIds[key] = []
        epgChannelIds.push(ch.epg_channel_id)
        epgSourceIds.push(ch.primary_source_id)
      }
      epgKeyToContentIds[key].push(ch.id)
    }

    // Single batched query for all EPG data
    if (epgChannelIds.length > 0) {
      const pairs = epgChannelIds.map((_, i) => `(channel_external_id = ? AND source_id = ?)`).join(' OR ')
      const pairParams: any[] = []
      for (let i = 0; i < epgChannelIds.length; i++) {
        pairParams.push(epgChannelIds[i], epgSourceIds[i])
      }
      const epgRows = sqlite.prepare(`
        SELECT channel_external_id, source_id, id, title, description, start_time, end_time, category
        FROM epg
        WHERE (${pairs}) AND end_time > ? AND start_time < ?
        ORDER BY channel_external_id, start_time ASC
      `).all(...pairParams, startTime, endTime) as any[]

      // Group by content id
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

    // Ensure all channels have an entry (even if empty)
    for (const ch of rows) {
      if (!programmes[ch.id]) programmes[ch.id] = []
    }

    return {
      channels: rows.map((ch) => ({
        contentId: ch.id,
        title: ch.title,
        posterUrl: ch.poster_url,
        sourceId: ch.primary_source_id,
        catchupSupported: !!ch.catchup_supported,
        catchupDays: ch.catchup_days ?? 0,
        externalId: ch.external_id,
      })),
      programmes,
      windowStart: startTime,
      windowEnd: endTime,
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
      stream.stream_id,
      new Date(args.startTime * 1000),
      args.duration
    )

    return { url }
  })

  // ── Search ───────────────────────────────────────────────────────────────

  ipcMain.handle('search:query', async (_event, args: {
    query: string
    type?: 'live' | 'movie' | 'series'
    categoryName?: string
    sourceIds?: string[]
    limit?: number
    offset?: number
  }) => {
    const sqlite = getSqlite()
    const { type, categoryName, sourceIds, limit = 50, offset = 0 } = args
    const rawQuery = args.query
    const query = rawQuery.trim()

    // Map API types to canonical types
    const canonicalType = type === 'live' ? 'channel' : type

    // Source filter — simple WHERE on streams.source_id
    const enabledSources = (sqlite.prepare(`SELECT id FROM sources WHERE disabled = 0`).all() as { id: string }[]).map(r => r.id)
    const filterIds = sourceIds && sourceIds.length > 0
      ? sourceIds.filter(id => enabledSources.includes(id))
      : enabledSources
    if (!filterIds.length) return []
    const sourceFilter = `AND s.source_id IN (${filterIds.map(() => '?').join(',')})`

    // Category filter via junction table
    const catJoin = categoryName
      ? `JOIN stream_categories sc ON sc.stream_id = s.id JOIN categories cat ON cat.id = sc.category_id AND cat.name = ?`
      : ''
    const catParams: any[] = categoryName ? [categoryName] : []

    // Type filter on canonical (channel/movie/series)
    const typeFilter = canonicalType ? `AND c.type = '${canonicalType}'` : ''

    if (!query || query.trim().length === 0) {
      const sql = `
        SELECT DISTINCT s.id, s.source_id as primary_source_id, s.source_id as source_ids,
          s.stream_id as external_id, s.type, COALESCE(c.title, s.title) as title,
          s.category_id, s.thumbnail_url as poster_url, s.container_extension,
          s.catchup_supported, s.catchup_days, s.epg_channel_id,
          c.id as canonical_id, c.original_title, c.year, c.overview as plot,
          c.poster_path, c.backdrop_path as backdrop_url, c.vote_average as rating_tmdb,
          c.rating_imdb, c.genres, c.director, c.cast_json as cast, c.keywords,
          c.runtime, c.tmdb_id, c.enriched, c.enriched_at, c.tvg_id,
          CASE WHEN s.epg_channel_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM epg e WHERE e.channel_external_id = s.epg_channel_id AND e.source_id = s.source_id LIMIT 1
          ) THEN 1 ELSE 0 END as has_epg_data
        FROM streams s
        JOIN canonical c ON c.id = s.canonical_id
        ${catJoin}
        WHERE 1=1
        ${typeFilter}
        ${sourceFilter}
        ORDER BY s.added_at DESC
        LIMIT ? OFFSET ?
      `
      return sqlite.prepare(sql).all(...catParams, ...filterIds, limit, offset)
    }

    // Build FTS query term with space-aware word boundary detection:
    //   "der"    → prefix match: der*  (matches "dermatologist", "Der Untergang")
    //   "der "   → exact token:  der   (trailing space = done typing this word)
    //   '"der"'  → exact phrase: "der" (quotes = explicit exact match)
    //   " der"   → prefix match: der*  (leading space is just whitespace before the word)
    // Multi-word: each word individually gets prefix or exact based on its trailing space.

    // Check if user wrapped entire query in quotes → exact phrase match
    const quotedMatch = rawQuery.match(/^"(.+)"$/)
    let ftsQuery: string

    if (quotedMatch) {
      const phrase = normalizeForSearch(quotedMatch[1]).replace(/"/g, '""')
      ftsQuery = `{title original_title}: "${phrase}" OR {cast director genres}: "${phrase}"`
      console.log(`[Search] Quoted mode: "${phrase}"`)
    } else {
      // Space-aware tokenization: trailing space after a word = exact, otherwise prefix
      const tokens: { word: string; exact: boolean }[] = []
      const tokenRegex = /(\S+)(\s|$)/g
      let match
      const normalizedRaw = normalizeForSearch(rawQuery)
      while ((match = tokenRegex.exec(normalizedRaw)) !== null) {
        // Strip FTS5 special characters: ( ) * " ^ { } + -
        const word = match[1].replace(/[(){}*"^+\-]/g, '')
        if (!word) continue
        // Token is exact if there's trailing whitespace after it (user typed a space = done with this word)
        const hasTrailingSpace = match[2] === ' ' || (match.index + match[0].length < normalizedRaw.length)
        tokens.push({ word, exact: hasTrailingSpace })
      }

      if (tokens.length === 0) {
        return []
      }

      // Build FTS expression
      // Title columns: prefix or exact per token
      // Cast/director/genres: always exact tokens (users type full names)
      const titleParts = tokens.map(t => t.exact ? t.word.replace(/"/g, '""') : `${t.word}*`)
      const titleQuery = tokens.length > 1
        ? `(${titleParts.join(' AND ')})`
        : titleParts[0]
      const exactPhrase = tokens.map(t => t.word.replace(/"/g, '""')).join(' ')
      ftsQuery = `{title original_title}: ${titleQuery} OR {cast director genres}: "${exactPhrase}"`
      console.log(`[Search] Tokens: ${tokens.map(t => `"${t.word}"${t.exact ? ' (exact)' : ' (prefix)'}`).join(', ')} → FTS: ${ftsQuery}`)
    }

    // Query contains special chars that FTS5 strips → LIKE should run first
    const hasSpecialChars = /[[\]()_\-]/.test(query)

    // Common SELECT columns for search results
    const searchSelect = `
      s.id, s.source_id as primary_source_id, s.source_id as source_ids,
      s.stream_id as external_id, s.type, COALESCE(c.title, s.title) as title,
      s.category_id, s.thumbnail_url as poster_url, s.container_extension,
      s.catchup_supported, s.catchup_days, s.epg_channel_id,
      c.id as canonical_id, c.original_title, c.year, c.overview as plot,
      c.poster_path, c.backdrop_path as backdrop_url, c.vote_average as rating_tmdb,
      c.rating_imdb, c.genres, c.director, c.cast_json as cast, c.keywords,
      c.runtime, c.tmdb_id, c.enriched, c.enriched_at, c.tvg_id,
      CASE WHEN s.epg_channel_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM epg e WHERE e.channel_external_id = s.epg_channel_id AND e.source_id = s.source_id LIMIT 1
      ) THEN 1 ELSE 0 END as has_epg_data
    `

    const runSearch = (searchTypeFilter: string, typeLimit: number): any[] => {
      // ── LIKE search (substring, preserves special characters) ──────────
      const words = query.split(/\s+/).filter(Boolean)
      const likeConditions = words.map(() => `COALESCE(c.title, s.title) LIKE ?`).join(' AND ')
      const likeParams = words.map(w => `%${w}%`)
      const runLike = (lim: number, excludeIds?: Set<string>): any[] => {
        const likeSql = `
          SELECT DISTINCT ${searchSelect}
          FROM streams s
          JOIN canonical c ON c.id = s.canonical_id
          ${catJoin}
          WHERE ${likeConditions}
          ${searchTypeFilter}
          ${sourceFilter}
          ORDER BY s.added_at DESC
          LIMIT ? OFFSET ?
        `
        const rows = sqlite.prepare(likeSql).all(...catParams, ...likeParams, ...filterIds, lim + (excludeIds?.size ?? 0), offset) as any[]
        if (!excludeIds) return rows.slice(0, lim)
        const filtered: any[] = []
        for (const r of rows) {
          if (!excludeIds.has(r.id)) {
            filtered.push(r)
            if (filtered.length >= lim) break
          }
        }
        return filtered
      }

      // ── FTS5 search (ranked word matching) ─────────────────────────────
      const runFts = (lim: number, excludeIds?: Set<string>): any[] => {
        try {
          const ftsSql = `
            SELECT DISTINCT ${searchSelect}, fts.rank
            FROM canonical_fts fts
            JOIN canonical c ON c.id = fts.canonical_id
            JOIN streams s ON s.canonical_id = c.id
            ${catJoin}
            WHERE canonical_fts MATCH ?
            ${searchTypeFilter}
            ${sourceFilter}
            ORDER BY fts.rank
            LIMIT ? OFFSET ?
          `
          const rows = sqlite.prepare(ftsSql).all(...catParams, ftsQuery, ...filterIds, lim + (excludeIds?.size ?? 0), offset) as any[]
          if (!excludeIds) return rows.slice(0, lim)
          const filtered: any[] = []
          for (const r of rows) {
            if (!excludeIds.has(r.id)) {
              filtered.push(r)
              if (filtered.length >= lim) break
            }
          }
          return filtered
        } catch (err) {
          console.warn(`[Search] FTS failed for "${query}":`, (err as Error).message)
          return []
        }
      }

      // ── Merge: primary fills first, secondary fills remaining ──────────
      const primary = hasSpecialChars ? runLike(typeLimit) : runFts(typeLimit)
      const remaining = typeLimit - primary.length
      if (remaining <= 0) return primary

      const primaryIds = new Set(primary.map((r: any) => r.id))
      const secondary = hasSpecialChars ? runFts(remaining, primaryIds) : runLike(remaining, primaryIds)
      return [...primary, ...secondary]
    }

    return runSearch(typeFilter, limit)
  })

  // ── Content ──────────────────────────────────────────────────────────────

  ipcMain.handle('content:get', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const item = sqlite.prepare(`
      SELECT s.id, s.source_id as primary_source_id, s.source_id as source_ids,
        s.stream_id as external_id, s.type, COALESCE(c.title, s.title) as title,
        s.category_id, s.thumbnail_url as poster_url, s.container_extension,
        s.catchup_supported, s.catchup_days, s.epg_channel_id,
        c.id as canonical_id, c.original_title, c.year, c.overview as plot,
        c.poster_path, c.backdrop_path as backdrop_url, c.vote_average as rating_tmdb,
        c.rating_imdb, c.genres, c.director, c.cast_json as cast, c.keywords,
        c.runtime, c.tmdb_id, c.enriched, c.enriched_at, c.tvg_id,
        s.parent_canonical_id as parent_id, s.season_number, s.episode_number,
        GROUP_CONCAT(DISTINCT cat.name) as category_name,
        CASE WHEN s.epg_channel_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM epg e WHERE e.channel_external_id = s.epg_channel_id AND e.source_id = s.source_id LIMIT 1
        ) THEN 1 ELSE 0 END as has_epg_data
      FROM streams s
      LEFT JOIN canonical c ON c.id = s.canonical_id
      LEFT JOIN stream_categories sc ON sc.stream_id = s.id
      LEFT JOIN categories cat ON cat.id = sc.category_id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(contentId)
    return item
  })

  ipcMain.handle('content:get-stream-url', async (_event, args: {
    contentId: string
    sourceId?: string
  }) => {
    const db = getDb()
    const sqlite = getSqlite()

    const stream = sqlite.prepare('SELECT * FROM streams WHERE id = ?').get(args.contentId) as StreamRow | undefined
    if (!stream) return { error: 'Content not found' }

    const sourceId = args.sourceId ?? stream.source_id
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId))
    if (!source) return { error: 'No stream source found' }

    // M3U sources: URL stored directly on streams row
    if (source.type === 'm3u') {
      if (!stream.stream_url) return { error: 'Stream URL missing for M3U content' }
      return { url: stream.stream_url, sourceId: source.id }
    }

    if (!source.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    const streamType = stream.type === 'live' ? 'live' : (stream.type === 'series' || stream.type === 'episode') ? 'series' : 'movie'
    const url = xtreamService.buildStreamUrl(
      source.serverUrl, source.username, source.password,
      streamType,
      stream.stream_id,
      stream.container_extension
    )

    return { url, sourceId: source.id }
  })

  ipcMain.handle('series:get-info', async (_event, args: { contentId: string }) => {
    const db = getDb()
    const sqlite = getSqlite()

    const stream = sqlite.prepare('SELECT * FROM streams WHERE id = ?').get(args.contentId) as StreamRow | undefined
    if (!stream) return { error: 'Content not found' }

    const [source] = await db.select().from(sources).where(eq(sources.id, stream.source_id))
    if (!source?.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    try {
      const info = await xtreamService.getSeriesInfo(source.serverUrl, source.username, source.password, stream.stream_id)

      // Persist episodes into canonical + streams so position saves work
      // (user_data FK references canonical.id — episodes must exist in DB)
      const upsertCanonical = sqlite.prepare(`
        INSERT INTO canonical (id, type, title, overview)
        VALUES (?, 'episode', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          overview = COALESCE(excluded.overview, canonical.overview)
      `)
      const upsertStream = sqlite.prepare(`
        INSERT INTO streams (id, canonical_id, source_id, type, stream_id, title, parent_canonical_id, season_number, episode_number, container_extension)
        VALUES (?, ?, ?, 'episode', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          season_number = excluded.season_number,
          episode_number = excluded.episode_number,
          container_extension = excluded.container_extension
      `)
      const parentCanonicalId = stream.canonical_id
      const insertEpisodes = sqlite.transaction((seasons: Record<string, any[]>) => {
        for (const [, eps] of Object.entries(seasons)) {
          for (const ep of eps) {
            const epStreamId = `${source.id}:episode:${ep.id}`
            const epCanonicalId = `ep:${source.id}:${ep.id}`
            upsertCanonical.run(epCanonicalId, ep.title, ep.plot ?? null)
            upsertStream.run(epStreamId, epCanonicalId, source.id, String(ep.id), ep.title, parentCanonicalId, ep.season, ep.episode_num, ep.container_extension ?? 'mkv')
          }
        }
      })
      insertEpisodes(info.seasons ?? {})

      return { ...info, sourceId: source.id, serverUrl: source.serverUrl, username: source.username, password: source.password }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── User data ────────────────────────────────────────────────────────────

  ipcMain.handle('user:get-data', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const stream = sqlite.prepare('SELECT canonical_id FROM streams WHERE id = ?').get(contentId) as StreamCanonicalRef | undefined
    if (!stream?.canonical_id) return null
    const row = sqlite.prepare('SELECT * FROM user_data WHERE canonical_id = ? AND profile_id = ?').get(stream.canonical_id, 'default') as UserDataRow | undefined
    if (!row) return null
    // Alias columns to v1-compatible names for frontend
    return {
      content_id: contentId,
      favorite: row.is_favorite ?? 0,
      watchlist: row.is_watchlisted ?? 0,
      rating: row.rating,
      last_position: row.watch_position ?? 0,
      last_watched_at: row.last_watched_at,
      completed: row.completed ?? 0,
      fav_sort_order: row.fav_sort_order,
    }
  })

  ipcMain.handle('user:set-position', async (_event, args: { contentId: string; position: number }) => {
    const sqlite = getSqlite()
    const stream = sqlite.prepare('SELECT canonical_id FROM streams WHERE id = ?').get(args.contentId) as StreamCanonicalRef | undefined
    if (!stream?.canonical_id) return { success: false }
    sqlite.prepare(`
      INSERT INTO user_data (canonical_id, watch_position, last_watched_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(canonical_id, profile_id) DO UPDATE SET
        watch_position  = excluded.watch_position,
        last_watched_at = excluded.last_watched_at
    `).run(stream.canonical_id, args.position)
    return { success: true }
  })

  ipcMain.handle('user:toggle-favorite', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const stream = sqlite.prepare('SELECT canonical_id FROM streams WHERE id = ?').get(contentId) as StreamCanonicalRef | undefined
    if (!stream?.canonical_id) return { favorite: false }
    sqlite.prepare(`
      INSERT INTO user_data (canonical_id, is_favorite)
      VALUES (?, 1)
      ON CONFLICT(canonical_id, profile_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(stream.canonical_id)
    const row = sqlite.prepare('SELECT is_favorite FROM user_data WHERE canonical_id = ? AND profile_id = ?').get(stream.canonical_id, 'default') as FavoriteRow | undefined
    return { favorite: !!row?.is_favorite }
  })

  ipcMain.handle('user:toggle-watchlist', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const stream = sqlite.prepare('SELECT canonical_id FROM streams WHERE id = ?').get(contentId) as StreamCanonicalRef | undefined
    if (!stream?.canonical_id) return { watchlist: false }
    sqlite.prepare(`
      INSERT INTO user_data (canonical_id, is_watchlisted)
      VALUES (?, 1)
      ON CONFLICT(canonical_id, profile_id) DO UPDATE SET is_watchlisted = NOT is_watchlisted
    `).run(stream.canonical_id)
    const row = sqlite.prepare('SELECT is_watchlisted FROM user_data WHERE canonical_id = ? AND profile_id = ?').get(stream.canonical_id, 'default') as WatchlistRow | undefined
    return { watchlist: !!row?.is_watchlisted }
  })

  ipcMain.handle('user:favorites', async (_event, args?: { type?: 'live' | 'movie' | 'series' }) => {
    const sqlite = getSqlite()
    // Map API type to canonical type
    const canonicalType = args?.type === 'live' ? 'channel' : args?.type
    const typeFilter = canonicalType ? `AND c.type = ?` : ''
    const params: any[] = canonicalType ? [canonicalType] : []
    return sqlite.prepare(`
      SELECT s.id, s.source_id as primary_source_id, s.source_id as source_ids,
        s.stream_id as external_id, s.type, COALESCE(c.title, s.title) as title,
        s.category_id, s.thumbnail_url as poster_url, s.container_extension,
        s.catchup_supported, s.catchup_days, s.epg_channel_id,
        c.id as canonical_id, c.original_title, c.year, c.overview as plot,
        c.poster_path, c.backdrop_path as backdrop_url, c.vote_average as rating_tmdb,
        c.rating_imdb, c.genres, c.director, c.cast_json as cast, c.keywords,
        c.runtime, c.tmdb_id, c.enriched, c.enriched_at, c.tvg_id,
        ud.fav_sort_order, ud.last_watched_at, 1 as favorite,
        CASE WHEN s.epg_channel_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM epg e WHERE e.channel_external_id = s.epg_channel_id AND e.source_id = s.source_id LIMIT 1
        ) THEN 1 ELSE 0 END as has_epg_data
      FROM user_data ud
      JOIN canonical c ON c.id = ud.canonical_id
      LEFT JOIN streams s ON s.canonical_id = c.id
        AND s.source_id = (
          SELECT s2.source_id FROM streams s2
          JOIN sources src ON src.id = s2.source_id AND src.disabled = 0
          WHERE s2.canonical_id = c.id
          ORDER BY s2.added_at ASC LIMIT 1
        )
      WHERE ud.is_favorite = 1 AND ud.profile_id = 'default'
      ${typeFilter}
      GROUP BY c.id
      ORDER BY COALESCE(ud.fav_sort_order, 999999) ASC, ud.last_watched_at DESC
    `).all(...params)
  })

  ipcMain.handle('user:reorder-favorites', async (_event, order: { contentId: string; sortOrder: number }[]) => {
    const sqlite = getSqlite()
    // Look up canonical_id from stream id, then update user_data
    const getCanonical = sqlite.prepare('SELECT canonical_id FROM streams WHERE id = ?')
    const update = sqlite.prepare(
      `UPDATE user_data SET fav_sort_order = ? WHERE canonical_id = ? AND profile_id = 'default'`
    )
    const runAll = sqlite.transaction((items: typeof order) => {
      for (const { contentId, sortOrder } of items) {
        const stream = getCanonical.get(contentId) as any
        const cid = stream?.canonical_id ?? contentId
        update.run(sortOrder, cid)
      }
    })
    runAll(order)
    return { ok: true }
  })

  // ── New schema: channel handlers (Phase A) ────────────────────────────

  ipcMain.handle('channels:favorites', async (_event, args?: { profileId?: string }) => {
    const sqlite = getSqlite()
    const profileId = args?.profileId ?? 'default'
    // Return stream-compatible rows: id = stream id (for playback), canonical_id attached for mutations
    return sqlite.prepare(`
      SELECT
        COALESCE(s.id, c.id)          AS id,
        'live'                         AS type,
        c.title,
        COALESCE(s.thumbnail_url, c.poster_path) AS poster_url,
        s.source_id                    AS primary_source_id,
        c.id                           AS canonical_id,
        c.tvg_id,
        s.category_id,
        ud.fav_sort_order,
        ud.last_watched_at,
        1                              AS favorite
      FROM user_data ud
      JOIN canonical c ON c.id = ud.canonical_id
      LEFT JOIN streams s ON s.canonical_id = c.id
        AND s.source_id = (
          SELECT s2.source_id FROM streams s2
          JOIN sources src ON src.id = s2.source_id AND src.disabled = 0
          WHERE s2.canonical_id = c.id
          ORDER BY s2.added_at ASC LIMIT 1
        )
      WHERE ud.is_favorite = 1 AND ud.profile_id = ?
        AND c.type = 'channel'
      GROUP BY c.id
      ORDER BY COALESCE(ud.fav_sort_order, 999999) ASC, ud.last_watched_at DESC
    `).all(profileId)
  })

  ipcMain.handle('channels:toggle-favorite', async (_event, canonicalId: string) => {
    const sqlite = getSqlite()
    sqlite.prepare(`
      INSERT INTO user_data (canonical_id, is_favorite)
      VALUES (?, 1)
      ON CONFLICT(canonical_id, profile_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(canonicalId)
    const row = sqlite.prepare(
      `SELECT is_favorite FROM user_data WHERE canonical_id = ? AND profile_id = 'default'`
    ).get(canonicalId) as any
    return { favorite: !!row?.is_favorite }
  })

  ipcMain.handle('channels:reorder-favorites', async (_event, order: { canonicalId: string; sortOrder: number }[]) => {
    const sqlite = getSqlite()
    const update = sqlite.prepare(
      `UPDATE user_data SET fav_sort_order = ? WHERE canonical_id = ? AND profile_id = 'default'`
    )
    const runAll = sqlite.transaction((items: typeof order) => {
      for (const { canonicalId, sortOrder } of items) {
        update.run(sortOrder, canonicalId)
      }
    })
    runAll(order)
    return { ok: true }
  })

  ipcMain.handle('channels:get-data', async (_event, canonicalId: string) => {
    const sqlite = getSqlite()
    const row = sqlite.prepare(
      `SELECT * FROM user_data WHERE canonical_id = ? AND profile_id = 'default'`
    ).get(canonicalId) as any
    return {
      favorite:    !!row?.is_favorite,
      watchlisted: !!row?.is_watchlisted,
      rating:      row?.rating ?? null,
      position:    row?.watch_position ?? 0,
      completed:   !!row?.completed,
    }
  })

  // ── End new schema handlers ────────────────────────────────────────────

  ipcMain.handle('user:watchlist', async (_event, args?: { type?: 'live' | 'movie' | 'series' }) => {
    const sqlite = getSqlite()
    const canonicalType = args?.type === 'live' ? 'channel' : args?.type
    const typeFilter = canonicalType ? `AND c.type = ?` : ''
    const params: any[] = canonicalType ? [canonicalType] : []
    return sqlite.prepare(`
      SELECT s.id, s.source_id as primary_source_id, s.source_id as source_ids,
        s.stream_id as external_id, s.type, COALESCE(c.title, s.title) as title,
        s.category_id, s.thumbnail_url as poster_url, s.container_extension,
        c.id as canonical_id, c.original_title, c.year, c.overview as plot,
        c.poster_path, c.backdrop_path as backdrop_url, c.vote_average as rating_tmdb,
        c.genres, c.director, c.cast_json as cast, c.keywords,
        c.runtime, c.tmdb_id, c.enriched, c.tvg_id
      FROM user_data ud
      JOIN canonical c ON c.id = ud.canonical_id
      LEFT JOIN streams s ON s.canonical_id = c.id
        AND s.source_id = (
          SELECT s2.source_id FROM streams s2
          JOIN sources src ON src.id = s2.source_id AND src.disabled = 0
          WHERE s2.canonical_id = c.id
          ORDER BY s2.added_at ASC LIMIT 1
        )
      WHERE ud.is_watchlisted = 1 AND ud.profile_id = 'default'
      ${typeFilter}
      GROUP BY c.id
      ORDER BY ud.last_watched_at DESC
    `).all(...params)
  })

  ipcMain.handle('user:continue-watching', async (_event, args?: { type?: 'movie' | 'series' }) => {
    const sqlite = getSqlite()

    // In-progress movies
    const moviesSql = `
      SELECT s.id, s.source_id as primary_source_id, s.source_id as source_ids,
        s.stream_id as external_id, s.type, COALESCE(c.title, s.title) as title,
        s.category_id, s.thumbnail_url as poster_url, s.container_extension,
        c.id as canonical_id, c.original_title, c.year, c.overview as plot,
        c.poster_path, c.backdrop_path as backdrop_url, c.vote_average as rating_tmdb,
        c.genres, c.director, c.cast_json as cast, c.keywords,
        c.runtime, c.tmdb_id, c.enriched, c.tvg_id,
        ud.watch_position as last_position, ud.last_watched_at
      FROM user_data ud
      JOIN canonical c ON c.id = ud.canonical_id
      LEFT JOIN streams s ON s.canonical_id = c.id
        AND s.source_id = (
          SELECT s2.source_id FROM streams s2
          JOIN sources src ON src.id = s2.source_id AND src.disabled = 0
          WHERE s2.canonical_id = c.id
          ORDER BY s2.added_at ASC LIMIT 1
        )
      WHERE ud.watch_position > 0 AND ud.completed = 0
        AND c.type = 'movie'
        AND ud.profile_id = 'default'
      GROUP BY c.id
      ORDER BY ud.last_watched_at DESC
      LIMIT 20
    `

    // In-progress series: find most recently watched episode per series,
    // return the parent series row enriched with episode resume info.
    const seriesSql = `
      WITH ranked_episodes AS (
        SELECT
          ep_s.parent_canonical_id,
          ep_s.id              AS resume_episode_id,
          ep_s.season_number   AS resume_season_number,
          ep_s.episode_number  AS resume_episode_number,
          COALESCE(ep_c.title, ep_s.title) AS resume_episode_title,
          ud.watch_position    AS last_position,
          ud.last_watched_at,
          ROW_NUMBER() OVER (
            PARTITION BY ep_s.parent_canonical_id
            ORDER BY ud.last_watched_at DESC
          ) AS rn
        FROM user_data ud
        JOIN canonical ep_c ON ep_c.id = ud.canonical_id
        JOIN streams ep_s ON ep_s.canonical_id = ep_c.id
        WHERE ud.watch_position > 0
          AND ud.completed = 0
          AND ep_c.type = 'episode'
          AND ep_s.parent_canonical_id IS NOT NULL
          AND ud.profile_id = 'default'
      )
      SELECT
        ps.id, ps.source_id as primary_source_id, ps.source_id as source_ids,
        ps.stream_id as external_id, ps.type, COALESCE(pc.title, ps.title) as title,
        ps.category_id, ps.thumbnail_url as poster_url, ps.container_extension,
        pc.id as canonical_id, pc.original_title, pc.year, pc.overview as plot,
        pc.poster_path, pc.backdrop_path as backdrop_url, pc.vote_average as rating_tmdb,
        pc.genres, pc.director, pc.cast_json as cast, pc.keywords,
        pc.runtime, pc.tmdb_id, pc.enriched, pc.tvg_id,
        r.resume_episode_id,
        r.resume_season_number,
        r.resume_episode_number,
        r.resume_episode_title,
        r.last_position,
        r.last_watched_at
      FROM ranked_episodes r
      JOIN canonical pc ON pc.id = r.parent_canonical_id
      LEFT JOIN streams ps ON ps.canonical_id = pc.id
        AND ps.source_id = (
          SELECT s2.source_id FROM streams s2
          JOIN sources src ON src.id = s2.source_id AND src.disabled = 0
          WHERE s2.canonical_id = pc.id
          ORDER BY s2.added_at ASC LIMIT 1
        )
      WHERE r.rn = 1
      GROUP BY pc.id
      ORDER BY r.last_watched_at DESC
      LIMIT 20
    `

    if (args?.type === 'movie') return sqlite.prepare(moviesSql).all()
    if (args?.type === 'series') return sqlite.prepare(seriesSql).all()

    const movies = sqlite.prepare(moviesSql).all() as any[]
    const series = sqlite.prepare(seriesSql).all() as any[]
    return [...movies, ...series]
      .sort((a, b) => (b.last_watched_at ?? 0) - (a.last_watched_at ?? 0))
      .slice(0, 20)
  })

  ipcMain.handle('user:history', async (_event, args?: { limit?: number }) => {
    const sqlite = getSqlite()
    const limit = args?.limit ?? 50

    // Non-episode history (movies, live, series watched directly)
    const directRows = sqlite.prepare(`
      SELECT s.id, s.source_id as primary_source_id, s.source_id as source_ids,
        s.stream_id as external_id, s.type, COALESCE(c.title, s.title) as title,
        s.category_id, s.thumbnail_url as poster_url, s.container_extension,
        c.id as canonical_id, c.original_title, c.year, c.overview as plot,
        c.poster_path, c.backdrop_path as backdrop_url, c.vote_average as rating_tmdb,
        c.genres, c.director, c.cast_json as cast, c.keywords,
        c.runtime, c.tmdb_id, c.enriched, c.tvg_id,
        ud.watch_position as last_position, ud.last_watched_at
      FROM user_data ud
      JOIN canonical c ON c.id = ud.canonical_id
      LEFT JOIN streams s ON s.canonical_id = c.id
        AND s.source_id = (
          SELECT s2.source_id FROM streams s2
          JOIN sources src ON src.id = s2.source_id AND src.disabled = 0
          WHERE s2.canonical_id = c.id
          ORDER BY s2.added_at ASC LIMIT 1
        )
      WHERE ud.last_watched_at IS NOT NULL AND ud.profile_id = 'default'
        AND c.type != 'episode'
      GROUP BY c.id
      ORDER BY ud.last_watched_at DESC
      LIMIT ?
    `).all(limit) as any[]

    // Episode history → transform to parent series with resume info
    const episodeRows = sqlite.prepare(`
      WITH ranked_episodes AS (
        SELECT
          ep_s.parent_canonical_id,
          ep_s.id              AS resume_episode_id,
          ep_s.season_number   AS resume_season_number,
          ep_s.episode_number  AS resume_episode_number,
          COALESCE(ep_c.title, ep_s.title) AS resume_episode_title,
          ud.watch_position    AS last_position,
          ud.last_watched_at,
          ROW_NUMBER() OVER (
            PARTITION BY ep_s.parent_canonical_id
            ORDER BY ud.last_watched_at DESC
          ) AS rn
        FROM user_data ud
        JOIN canonical ep_c ON ep_c.id = ud.canonical_id
        JOIN streams ep_s ON ep_s.canonical_id = ep_c.id
        WHERE ud.last_watched_at IS NOT NULL
          AND ep_c.type = 'episode'
          AND ep_s.parent_canonical_id IS NOT NULL
          AND ud.profile_id = 'default'
      )
      SELECT
        ps.id, ps.source_id as primary_source_id, ps.source_id as source_ids,
        ps.stream_id as external_id, ps.type, COALESCE(pc.title, ps.title) as title,
        ps.category_id, ps.thumbnail_url as poster_url, ps.container_extension,
        pc.id as canonical_id, pc.original_title, pc.year, pc.overview as plot,
        pc.poster_path, pc.backdrop_path as backdrop_url, pc.vote_average as rating_tmdb,
        pc.genres, pc.director, pc.cast_json as cast, pc.keywords,
        pc.runtime, pc.tmdb_id, pc.enriched, pc.tvg_id,
        r.resume_episode_id,
        r.resume_season_number,
        r.resume_episode_number,
        r.resume_episode_title,
        r.last_position,
        r.last_watched_at
      FROM ranked_episodes r
      JOIN canonical pc ON pc.id = r.parent_canonical_id
      LEFT JOIN streams ps ON ps.canonical_id = pc.id
        AND ps.source_id = (
          SELECT s2.source_id FROM streams s2
          JOIN sources src ON src.id = s2.source_id AND src.disabled = 0
          WHERE s2.canonical_id = pc.id
          ORDER BY s2.added_at ASC LIMIT 1
        )
      WHERE r.rn = 1
      GROUP BY pc.id
      ORDER BY r.last_watched_at DESC
      LIMIT ?
    `).all(limit) as any[]

    const seen = new Set<string>()
    return [...directRows, ...episodeRows]
      .sort((a, b) => (b.last_watched_at ?? 0) - (a.last_watched_at ?? 0))
      .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true })
      .slice(0, limit)
  })

  ipcMain.handle('user:bulk-get-data', async (_event, contentIds: string[]) => {
    const sqlite = getSqlite()
    if (!contentIds.length) return {}
    // Look up canonical_ids from stream ids
    const inList = contentIds.map(() => '?').join(',')
    const streams = sqlite.prepare(
      `SELECT id, canonical_id FROM streams WHERE id IN (${inList})`
    ).all(...contentIds) as any[]
    const streamToCanonical = new Map<string, string>()
    const canonicalIds: string[] = []
    for (const s of streams) {
      if (s.canonical_id) {
        streamToCanonical.set(s.id, s.canonical_id)
        canonicalIds.push(s.canonical_id)
      }
    }
    if (!canonicalIds.length) return {}
    const cInList = canonicalIds.map(() => '?').join(',')
    const rows = sqlite.prepare(
      `SELECT * FROM user_data WHERE canonical_id IN (${cInList}) AND profile_id = 'default'`
    ).all(...canonicalIds) as any[]
    const canonicalToData = new Map<string, any>()
    for (const row of rows) canonicalToData.set(row.canonical_id, row)
    // Return keyed by stream id with v1-compatible column names
    const result: Record<string, any> = {}
    for (const [streamId, canonicalId] of streamToCanonical) {
      const row = canonicalToData.get(canonicalId)
      if (row) {
        result[streamId] = {
          content_id: streamId,
          favorite: row.is_favorite ?? 0,
          watchlist: row.is_watchlisted ?? 0,
          rating: row.rating,
          last_position: row.watch_position ?? 0,
          last_watched_at: row.last_watched_at,
          completed: row.completed ?? 0,
          fav_sort_order: row.fav_sort_order,
        }
      }
    }
    return result
  })

  ipcMain.handle('user:set-completed', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const stream = sqlite.prepare('SELECT canonical_id FROM streams WHERE id = ?').get(contentId) as StreamCanonicalRef | undefined
    if (!stream?.canonical_id) return { success: false }
    sqlite.prepare(`
      INSERT INTO user_data (canonical_id, completed, watch_position, last_watched_at)
      VALUES (?, 1, 0, unixepoch())
      ON CONFLICT(canonical_id, profile_id) DO UPDATE SET
        completed       = 1,
        watch_position  = 0,
        last_watched_at = unixepoch()
    `).run(stream.canonical_id)
    return { success: true }
  })

  ipcMain.handle('user:set-rating', async (_event, args: { contentId: string; rating: number | null }) => {
    const sqlite = getSqlite()
    const stream = sqlite.prepare('SELECT canonical_id FROM streams WHERE id = ?').get(args.contentId) as StreamCanonicalRef | undefined
    if (!stream?.canonical_id) return { success: false }
    sqlite.prepare(`
      INSERT INTO user_data (canonical_id, rating)
      VALUES (?, ?)
      ON CONFLICT(canonical_id, profile_id) DO UPDATE SET rating = excluded.rating
    `).run(stream.canonical_id, args.rating)
    return { success: true }
  })

  // ── User data management ──────────────────────────────────────────────────

  ipcMain.handle('user:clear-continue', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const stream = sqlite.prepare('SELECT canonical_id FROM streams WHERE id = ?').get(contentId) as StreamCanonicalRef | undefined
    if (!stream?.canonical_id) return { success: false }
    sqlite.prepare(`
      UPDATE user_data SET watch_position = 0, completed = 1
      WHERE canonical_id = ? AND profile_id = 'default'
    `).run(stream.canonical_id)
    return { success: true }
  })

  ipcMain.handle('user:clear-item-history', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const stream = sqlite.prepare('SELECT canonical_id FROM streams WHERE id = ?').get(contentId) as StreamCanonicalRef | undefined
    if (!stream?.canonical_id) return { success: false }
    sqlite.prepare(`
      UPDATE user_data SET watch_position = 0, last_watched_at = NULL, completed = 0
      WHERE canonical_id = ? AND profile_id = 'default'
    `).run(stream.canonical_id)
    return { success: true }
  })

  ipcMain.handle('user:clear-history', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE user_data SET watch_position = 0, last_watched_at = NULL, completed = 0`).run()
    return { success: true }
  })

  ipcMain.handle('user:clear-favorites', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE user_data SET is_favorite = 0, is_watchlisted = 0`).run()
    return { success: true }
  })

  ipcMain.handle('user:clear-all-data', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`DELETE FROM user_data`).run()
    return { success: true }
  })

  // ── Diagnostic: category item check ──────────────────────────────────────

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
      const items = sqlite.prepare(`
        SELECT st.id, COALESCE(c.title, st.title) as title, st.stream_id as external_id, st.type, st.source_id as primary_source_id
        FROM stream_categories sc
        JOIN streams st ON st.id = sc.stream_id
        LEFT JOIN canonical c ON c.id = st.canonical_id
        WHERE sc.category_id = ?
      `).all(catId) as any[]

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

  // ── TMDB enrichment ──────────────────────────────────────────────────────

  ipcMain.handle('enrichment:set-api-key', (_event, key: string) => {
    tmdbService.setApiKey(key)
    setSetting('tmdb_api_key', key)
    return { success: true }
  })

  ipcMain.handle('settings:get', (_event, key: string) => {
    return getSetting(key)
  })

  ipcMain.handle('enrichment:status', () => {
    const sqlite = getSqlite()
    const total = (sqlite.prepare(`SELECT COUNT(*) as n FROM canonical WHERE type NOT IN ('channel', 'episode')`).get() as CountRow)!.n
    const enriched = (sqlite.prepare(`SELECT COUNT(*) as n FROM canonical WHERE type NOT IN ('channel', 'episode') AND enriched = 1`).get() as CountRow)!.n
    return { total, enriched, pending: total - enriched }
  })

  // ── Categories ───────────────────────────────────────────────────────────

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
    const params: any[] = [...filterIds]
    const typeFilter = args.type ? `AND cat.type = ?` : ''
    if (args.type) params.push(args.type)
    const sql = `
      SELECT
        cat.name,
        cat.type,
        GROUP_CONCAT(DISTINCT cat.source_id) as source_ids,
        COUNT(DISTINCT sc.stream_id) as item_count,
        MIN(cat.content_synced) as needs_sync,
        MIN(cat.position) as position
      FROM categories cat
      LEFT JOIN stream_categories sc ON sc.category_id = cat.id
      WHERE cat.source_id IN (${inList})
      ${typeFilter}
      GROUP BY cat.name, cat.type
      HAVING item_count > 0 OR MIN(cat.content_synced) = 0
      ORDER BY item_count DESC
    `
    return sqlite.prepare(sql).all(...params)
  })

  // ── Content browse ───────────────────────────────────────────────────────

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

    const inList = filterIds.map(() => '?').join(',')

    // Safe sort column map
    const sortCol: Record<string, string> = {
      title: 'COALESCE(c.title, s.title)', year: 'c.year', rating: 'c.vote_average', updated: 's.added_at',
    }
    const orderBy = `${sortCol[sortBy] ?? 's.added_at'} ${sortDir === 'asc' ? 'ASC' : 'DESC'}`

    // Category filter via stream_categories junction table
    const catJoin = categoryName
      ? `JOIN stream_categories sc ON sc.stream_id = s.id JOIN categories cat ON cat.id = sc.category_id AND cat.name = ?`
      : ''
    const catParams: any[] = categoryName ? [categoryName] : []

    // Type filter on streams
    const typeFilter = type ? `AND s.type = ?` : ''
    const typeParams: any[] = type ? [type] : []

    const countSql = `
      SELECT COUNT(*) as n
      FROM streams s
      ${catJoin}
      WHERE s.source_id IN (${inList})
      ${typeFilter}
    `
    const total = (sqlite.prepare(countSql).get(...catParams, ...filterIds, ...typeParams) as CountRow)!.n

    const itemSql = `
      SELECT DISTINCT s.id, s.source_id as primary_source_id, s.source_id as source_ids,
        s.stream_id as external_id, s.type, COALESCE(c.title, s.title) as title,
        s.category_id, s.thumbnail_url as poster_url, s.container_extension,
        s.catchup_supported, s.catchup_days, s.epg_channel_id,
        c.id as canonical_id, c.original_title, c.year, c.overview as plot,
        c.poster_path, c.backdrop_path as backdrop_url, c.vote_average as rating_tmdb,
        c.rating_imdb, c.genres, c.director, c.cast_json as cast, c.keywords,
        c.runtime, c.tmdb_id, c.enriched, c.enriched_at, c.tvg_id,
        CASE WHEN s.epg_channel_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM epg e WHERE e.channel_external_id = s.epg_channel_id AND e.source_id = s.source_id LIMIT 1
        ) THEN 1 ELSE 0 END as has_epg_data
      FROM streams s
      LEFT JOIN canonical c ON c.id = s.canonical_id
      ${catJoin}
      WHERE s.source_id IN (${inList})
      ${typeFilter}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `
    const items = sqlite.prepare(itemSql).all(...catParams, ...filterIds, ...typeParams, limit, offset)
    return { items, total }
  })

  // ── External player (MPV / VLC) ─────────────────────────────────────────

  ipcMain.handle('player:open-external', async (_event, args: {
    player: 'mpv' | 'vlc'
    url: string
    title: string
    customPath?: string
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

  ipcMain.handle('player:detect-external', () => {
    return { mpv: findMpv(), vlc: findVlc() }
  })

  // Enrich a single content item on demand (triggered when detail panel opens)
  ipcMain.handle('enrichment:enrich-single', async (_event, contentId: string) => {
    const hasKey = tmdbService.hasKey()
    console.log(`[Enrich] Single enrichment for ${contentId}, hasKey=${hasKey}`)
    if (!hasKey) return { success: false, error: 'No TMDB API key configured' }

    const sqlite = getSqlite()
    const stream = sqlite.prepare('SELECT canonical_id, type FROM streams WHERE id = ?').get(contentId) as StreamCanonicalTypeRef | undefined
    if (!stream?.canonical_id) return { success: false, error: 'Content not found' }
    if (stream.type === 'live') return { success: false, error: 'Live channels are not enriched' }

    const canonical = sqlite.prepare('SELECT * FROM canonical WHERE id = ?').get(stream.canonical_id) as any
    if (!canonical) return { success: false, error: 'Canonical not found' }

    const hasData = canonical.overview || canonical.director || canonical.cast_json || canonical.genres
    if (canonical.enriched && hasData) {
      console.log(`[Enrich] ${contentId} already enriched with data`)
      return { success: true, alreadyEnriched: true }
    }
    if (canonical.enriched && !hasData) {
      console.log(`[Enrich] ${contentId} was marked enriched but has no data — retrying`)
      sqlite.prepare('UPDATE canonical SET enriched = 0 WHERE id = ?').run(stream.canonical_id)
    }

    console.log(`[Enrich] Calling TMDB for "${canonical.title}" (type=${canonical.type}, year=${canonical.year})`)
    try {
      await tmdbService.enrichBatch([stream.canonical_id])
    } catch (err) {
      console.error(`[Enrich] enrichBatch failed:`, err)
      return { success: false, error: String(err) }
    }

    // Return the updated row with v1-compatible column aliases
    const updated = sqlite.prepare(`
      SELECT s.id, s.source_id as primary_source_id, s.source_id as source_ids,
        s.stream_id as external_id, s.type, COALESCE(c.title, s.title) as title,
        s.category_id, s.thumbnail_url as poster_url, s.container_extension,
        c.id as canonical_id, c.original_title, c.year, c.overview as plot,
        c.poster_path, c.backdrop_path as backdrop_url, c.vote_average as rating_tmdb,
        c.rating_imdb, c.genres, c.director, c.cast_json as cast, c.keywords,
        c.runtime, c.tmdb_id, c.enriched, c.enriched_at, c.tvg_id,
        GROUP_CONCAT(DISTINCT cat.name) as category_name
      FROM streams s
      LEFT JOIN canonical c ON c.id = s.canonical_id
      LEFT JOIN stream_categories sc ON sc.stream_id = s.id
      LEFT JOIN categories cat ON cat.id = sc.category_id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(contentId) as any
    const enrichedWithData = !!(updated?.plot || updated?.director || updated?.cast || updated?.genres)
    console.log(`[Enrich] Done for ${contentId}, gotData=${enrichedWithData}`)
    return { success: true, content: updated, enrichedWithData }
  })

  // Manual enrichment — user provides a corrected search title
  ipcMain.handle('enrichment:enrich-manual', async (_event, args: { contentId: string; title: string; year?: number }) => {
    if (!tmdbService.hasKey()) return { success: false, error: 'No TMDB API key configured' }

    const sqlite = getSqlite()
    const stream = sqlite.prepare('SELECT canonical_id, type FROM streams WHERE id = ?').get(args.contentId) as StreamCanonicalTypeRef | undefined
    if (!stream?.canonical_id) return { success: false, error: 'Content not found' }

    sqlite.prepare('UPDATE canonical SET enriched = 0 WHERE id = ?').run(stream.canonical_id)

    console.log(`[Enrich] Manual search: "${args.title}" (year=${args.year ?? 'none'}) for ${args.contentId}`)

    try {
      const canonicalType = stream.type === 'live' ? 'channel' : stream.type
      await tmdbService.enrichWithTitle(stream.canonical_id, args.title, canonicalType, args.year)
    } catch (err) {
      console.error(`[Enrich] Manual enrich failed:`, err)
      return { success: false, error: String(err) }
    }

    const updated = sqlite.prepare(`
      SELECT s.id, s.source_id as primary_source_id, s.source_id as source_ids,
        s.stream_id as external_id, s.type, COALESCE(c.title, s.title) as title,
        s.category_id, s.thumbnail_url as poster_url, s.container_extension,
        c.id as canonical_id, c.original_title, c.year, c.overview as plot,
        c.poster_path, c.backdrop_path as backdrop_url, c.vote_average as rating_tmdb,
        c.genres, c.director, c.cast_json as cast, c.keywords,
        c.runtime, c.tmdb_id, c.enriched, c.enriched_at,
        GROUP_CONCAT(DISTINCT cat.name) as category_name
      FROM streams s
      LEFT JOIN canonical c ON c.id = s.canonical_id
      LEFT JOIN stream_categories sc ON sc.stream_id = s.id
      LEFT JOIN categories cat ON cat.id = sc.category_id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(args.contentId) as any
    const enrichedWithData = !!(updated?.plot || updated?.director || updated?.cast || updated?.genres)
    console.log(`[Enrich] Manual done for ${args.contentId}, gotData=${enrichedWithData}`)
    return { success: true, content: updated, enrichedWithData }
  })

  // Search TMDB and return multiple results for user to choose from
  ipcMain.handle('enrichment:search-tmdb', async (_event, args: { title: string; year?: number; type: 'movie' | 'series' }) => {
    if (!tmdbService.hasKey()) return { success: false, error: 'No TMDB API key configured' }
    try {
      const results = args.type === 'movie'
        ? await tmdbService.searchMovieMulti(args.title, args.year)
        : await tmdbService.searchTvMulti(args.title, args.year)

      const imageBase = 'https://image.tmdb.org/t/p'
      return {
        success: true,
        results: results.map((r: any) => ({
          tmdbId: r.id,
          title: r.title ?? r.name,
          originalTitle: r.original_title ?? r.original_name,
          year: (r.release_date ?? r.first_air_date)?.substring(0, 4) ?? null,
          overview: r.overview?.substring(0, 150) ?? null,
          posterUrl: r.poster_path ? `${imageBase}/w185${r.poster_path}` : null,
          rating: r.vote_average > 0 ? r.vote_average : null,
        })),
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Enrich a content item with a specific TMDB ID chosen by the user
  ipcMain.handle('enrichment:enrich-by-id', async (_event, args: { contentId: string; tmdbId: number }) => {
    if (!tmdbService.hasKey()) return { success: false, error: 'No TMDB API key configured' }

    const sqlite = getSqlite()
    const stream = sqlite.prepare('SELECT canonical_id, type FROM streams WHERE id = ?').get(args.contentId) as StreamCanonicalTypeRef | undefined
    if (!stream?.canonical_id) return { success: false, error: 'Content not found' }

    const canonical = sqlite.prepare('SELECT title FROM canonical WHERE id = ?').get(stream.canonical_id) as any
    console.log(`[Enrich] User chose TMDB ID ${args.tmdbId} for "${canonical?.title}"`)
    try {
      const canonicalType = stream.type === 'live' ? 'channel' : stream.type
      await tmdbService.enrichById(stream.canonical_id, args.tmdbId, canonicalType)
    } catch (err) {
      console.error(`[Enrich] enrichById failed:`, err)
      return { success: false, error: String(err) }
    }

    const updated = sqlite.prepare(`
      SELECT s.id, s.source_id as primary_source_id, s.source_id as source_ids,
        s.stream_id as external_id, s.type, COALESCE(c.title, s.title) as title,
        s.category_id, s.thumbnail_url as poster_url, s.container_extension,
        c.id as canonical_id, c.original_title, c.year, c.overview as plot,
        c.poster_path, c.backdrop_path as backdrop_url, c.vote_average as rating_tmdb,
        c.genres, c.director, c.cast_json as cast, c.keywords,
        c.runtime, c.tmdb_id, c.enriched, c.enriched_at,
        GROUP_CONCAT(DISTINCT cat.name) as category_name
      FROM streams s
      LEFT JOIN canonical c ON c.id = s.canonical_id
      LEFT JOIN stream_categories sc ON sc.stream_id = s.id
      LEFT JOIN categories cat ON cat.id = sc.category_id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(args.contentId) as any
    const enrichedWithData = !!(updated?.plot || updated?.director || updated?.cast || updated?.genres)
    return { success: true, content: updated, enrichedWithData }
  })

  ipcMain.handle('enrichment:start', async (event, apiKey?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sqlite = getSqlite()

    if (apiKey) tmdbService.setApiKey(apiKey)

    // Get unenriched canonical IDs (movies + series only)
    const rows = sqlite.prepare(
      `SELECT id FROM canonical WHERE type NOT IN ('channel', 'episode') AND enriched = 0 ORDER BY created_at DESC LIMIT 500`
    ).all() as { id: string }[]

    if (rows.length === 0) return { success: true, message: 'Nothing to enrich' }

    const ids = rows.map((r) => r.id)

    tmdbService.enrichBatch(ids, (done, total) => {
      win?.webContents.send('enrichment:progress', { done, total })
    }).then(() => {
      win?.webContents.send('enrichment:progress', { done: ids.length, total: ids.length, complete: true })
    }).catch((err) => {
      win?.webContents.send('enrichment:progress', { error: String(err) })
    })

    return { success: true, message: `Enriching ${ids.length} items…` }
  })

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
