import { ipcMain, BrowserWindow, app } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { getDb, getSqlite, getSetting, setSetting, rebuildFtsIfNeeded } from '../database/connection'
import { sources } from '../database/schema'
import { eq } from 'drizzle-orm'
import { xtreamService, SyncProgress } from '../services/xtream.service'
import { tmdbService } from '../services/tmdb.service'
import { normalizeForSearch } from '../lib/normalize'

export function registerHandlers() {

  // Load TMDB key from DB and activate it immediately
  const storedTmdbKey = getSetting('tmdb_api_key')
  if (storedTmdbKey) tmdbService.setApiKey(storedTmdbKey)

  // Rebuild FTS index in background if needed (one-time after Unicode normalization upgrade)
  rebuildFtsIfNeeded().catch(console.error)

  // ── Ping (health check) ──────────────────────────────────────────────────
  ipcMain.handle('ping', () => 'pong')

  // ── DevTools ─────────────────────────────────────────────────────────────
  ipcMain.handle('devtools:toggle', (event) => {
    event.sender.toggleDevTools()
  })

  // ── Sources ──────────────────────────────────────────────────────────────

  ipcMain.handle('sources:list', async () => {
    const db = getDb()
    return db.select().from(sources).all()
  })

  // Total content count across all enabled sources
  ipcMain.handle('sources:total-count', () => {
    const sqlite = getSqlite()
    const row = sqlite.prepare(`
      SELECT COUNT(*) as n FROM content c
      JOIN sources s ON s.id = c.primary_source_id AND s.disabled = 0
    `).get() as any
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

  ipcMain.handle('sources:remove', async (_event, sourceId: string) => {
    const dbPath = join(app.getPath('userData'), 'data', 'fractals.db')
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
    const source = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as any
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
    return { done: true }
  })

  ipcMain.handle('sources:update', async (_event, args: {
    sourceId: string
    name?: string
    serverUrl?: string
    username?: string
    password?: string
  }) => {
    const sqlite = getSqlite()
    const sets: string[] = []
    const params: any[] = []
    if (args.name !== undefined) { sets.push('name = ?'); params.push(args.name) }
    if (args.serverUrl !== undefined) { sets.push('server_url = ?'); params.push(args.serverUrl.replace(/\/$/, '')) }
    if (args.username !== undefined) { sets.push('username = ?'); params.push(args.username) }
    if (args.password !== undefined) { sets.push('password = ?'); params.push(args.password) }
    if (sets.length === 0) return { success: false, error: 'Nothing to update' }
    params.push(args.sourceId)
    sqlite.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return { success: true }
  })

  ipcMain.handle('sources:toggle-disabled', async (_event, sourceId: string) => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE sources SET disabled = NOT disabled WHERE id = ?`).run(sourceId)
    const row = sqlite.prepare(`SELECT disabled FROM sources WHERE id = ?`).get(sourceId) as any
    return { disabled: !!row?.disabled }
  })

  ipcMain.handle('sources:sync', async (event, sourceId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sqlite = getSqlite()

    // Get source credentials
    const source = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as any
    if (!source?.server_url) return { success: false, error: 'Source not found' }

    // Resolve worker path — built alongside main.js by electron-vite
    const workerPath = join(__dirname, 'sync.worker.js')

    // DB path — same as what connection.ts uses
    const dbPath = join(app.getPath('userData'), 'data', 'fractals.db')

    return new Promise((resolve) => {
      const worker = new Worker(workerPath, {
        workerData: {
          sourceId,
          dbPath,
          serverUrl: source.server_url,
          username: source.username,
          password: source.password,
          sourceName: source.name,
        },
      })

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

    // Source filter — simple WHERE on primary_source_id
    const enabledSources = (sqlite.prepare(`SELECT id FROM sources WHERE disabled = 0`).all() as { id: string }[]).map(r => r.id)
    const filterIds = sourceIds && sourceIds.length > 0
      ? sourceIds.filter(id => enabledSources.includes(id))
      : enabledSources
    if (!filterIds.length) return []
    const sourceFilter = `AND c.primary_source_id IN (${filterIds.map(() => '?').join(',')})`

    // Category filter via junction table (supports multi-category membership)
    const catJoin = categoryName
      ? `JOIN content_categories cc ON cc.content_id = c.id JOIN categories cat ON cat.id = cc.category_id AND cat.name = ?`
      : ''
    const catParams: any[] = categoryName ? [categoryName] : []

    if (!query || query.trim().length === 0) {
      const sql = `
        SELECT DISTINCT c.*, c.primary_source_id as source_ids
        FROM content c
        ${catJoin}
        WHERE 1=1
        ${type ? `AND c.type = '${type}'` : ''}
        ${sourceFilter}
        ORDER BY c.updated_at DESC
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

    const runSearch = (typeFilter: string, typeLimit: number): any[] => {
      // 1. FTS5 — prefix/exact matches (fast, ranked)
      let ftsResults: any[] = []
      try {
        const ftsSql = `
          SELECT DISTINCT c.*, fts.rank, c.primary_source_id as source_ids
          FROM content_fts fts
          JOIN content c ON c.id = fts.content_id
          ${catJoin}
          WHERE content_fts MATCH ?
          ${typeFilter}
          ${sourceFilter}
          ORDER BY fts.rank
          LIMIT ? OFFSET ?
        `
        ftsResults = sqlite.prepare(ftsSql).all(...catParams, ftsQuery, ...filterIds, typeLimit, offset) as any[]
      } catch (err) {
        console.warn(`[Search] FTS failed for "${query}":`, (err as Error).message)
      }

      // 2. LIKE — substring matches (catches "dar" inside "undark")
      //    Only fill remaining slots to avoid redundant work
      const remaining = typeLimit - ftsResults.length
      if (remaining <= 0) return ftsResults

      const ftsIds = new Set(ftsResults.map((r: any) => r.id))
      // Split query into words — each word must appear somewhere in the title
      // "dar kni" → title LIKE '%dar%' AND title LIKE '%kni%' → matches "Dark Knight"
      const words = query.split(/\s+/).filter(Boolean)
      const likeConditions = words.map(() => `c.title LIKE ?`).join(' AND ')
      const likeParams = words.map(w => `%${w}%`)
      const likeSql = `
        SELECT DISTINCT c.*, c.primary_source_id as source_ids
        FROM content c
        ${catJoin}
        WHERE ${likeConditions}
        ${typeFilter}
        ${sourceFilter}
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?
      `
      const likeResults = sqlite.prepare(likeSql).all(...catParams, ...likeParams, ...filterIds, remaining + ftsIds.size, offset) as any[]

      // Merge: FTS first (ranked), then LIKE results not already in FTS
      const merged = [...ftsResults]
      for (const r of likeResults) {
        if (!ftsIds.has(r.id)) {
          merged.push(r)
          if (merged.length >= typeLimit) break
        }
      }

      return merged
    }

    return runSearch(type ? `AND c.type = '${type}'` : '', limit)
  })

  // ── Content ──────────────────────────────────────────────────────────────

  ipcMain.handle('content:get', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const item = sqlite.prepare(`
      SELECT c.*, c.primary_source_id as source_ids,
             GROUP_CONCAT(DISTINCT cat.name) as category_name
      FROM content c
      LEFT JOIN content_categories cc ON cc.content_id = c.id
      LEFT JOIN categories cat ON cat.id = cc.category_id
      WHERE c.id = ?
      GROUP BY c.id
    `).get(contentId)
    return item
  })

  ipcMain.handle('content:get-stream-url', async (_event, args: {
    contentId: string
    sourceId?: string
  }) => {
    const db = getDb()
    const sqlite = getSqlite()

    const item = sqlite.prepare('SELECT * FROM content WHERE id = ?').get(args.contentId) as any
    if (!item) return { error: 'Content not found' }

    const sourceRow = args.sourceId
      ? sqlite.prepare('SELECT * FROM content_sources WHERE content_id = ? AND source_id = ?').get(args.contentId, args.sourceId) as any
      : sqlite.prepare('SELECT * FROM content_sources WHERE content_id = ? ORDER BY priority DESC LIMIT 1').get(args.contentId) as any

    if (!sourceRow) return { error: 'No stream source found' }

    const [source] = await db.select().from(sources).where(eq(sources.id, sourceRow.source_id))
    if (!source?.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    const streamType = item.type === 'live' ? 'live' : item.type === 'series' ? 'series' : 'movie'
    const url = xtreamService.buildStreamUrl(
      source.serverUrl, source.username, source.password,
      streamType,
      sourceRow.external_id,
      item.container_extension
    )

    return { url, sourceId: source.id }
  })

  ipcMain.handle('series:get-info', async (_event, args: { contentId: string }) => {
    const db = getDb()
    const sqlite = getSqlite()

    const item = sqlite.prepare('SELECT * FROM content WHERE id = ?').get(args.contentId) as any
    if (!item) return { error: 'Content not found' }

    const sourceRow = sqlite.prepare('SELECT * FROM content_sources WHERE content_id = ? ORDER BY priority DESC LIMIT 1').get(args.contentId) as any
    if (!sourceRow) return { error: 'No source found' }

    const [source] = await db.select().from(sources).where(eq(sources.id, sourceRow.source_id))
    if (!source?.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    try {
      const info = await xtreamService.getSeriesInfo(source.serverUrl, source.username, source.password, sourceRow.external_id)
      return { ...info, sourceId: source.id, serverUrl: source.serverUrl, username: source.username, password: source.password }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── User data ────────────────────────────────────────────────────────────

  ipcMain.handle('user:get-data', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    return sqlite.prepare('SELECT * FROM user_data WHERE content_id = ?').get(contentId)
  })

  ipcMain.handle('user:set-position', async (_event, args: { contentId: string; position: number }) => {
    const sqlite = getSqlite()
    sqlite.prepare(`
      INSERT INTO user_data (content_id, last_position, last_watched_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(content_id) DO UPDATE SET
        last_position = excluded.last_position,
        last_watched_at = excluded.last_watched_at
    `).run(args.contentId, args.position)
    return { success: true }
  })

  ipcMain.handle('user:toggle-favorite', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    sqlite.prepare(`
      INSERT INTO user_data (content_id, favorite)
      VALUES (?, 1)
      ON CONFLICT(content_id) DO UPDATE SET favorite = NOT favorite
    `).run(contentId)
    const row = sqlite.prepare('SELECT favorite FROM user_data WHERE content_id = ?').get(contentId) as any
    return { favorite: !!row?.favorite }
  })

  ipcMain.handle('user:toggle-watchlist', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    sqlite.prepare(`
      INSERT INTO user_data (content_id, watchlist)
      VALUES (?, 1)
      ON CONFLICT(content_id) DO UPDATE SET watchlist = NOT watchlist
    `).run(contentId)
    const row = sqlite.prepare('SELECT watchlist FROM user_data WHERE content_id = ?').get(contentId) as any
    return { watchlist: !!row?.watchlist }
  })

  ipcMain.handle('user:favorites', async (_event, args?: { type?: 'live' | 'movie' | 'series' }) => {
    const sqlite = getSqlite()
    const typeFilter = args?.type ? `AND c.type = ?` : ''
    const params: any[] = args?.type ? [args.type] : []
    return sqlite.prepare(`
      SELECT c.*, c.primary_source_id as source_ids
      FROM user_data ud
      JOIN content c ON c.id = ud.content_id
      WHERE ud.favorite = 1 AND ud.profile_id = 'default'
      ${typeFilter}
      ORDER BY ud.last_watched_at DESC
    `).all(...params)
  })

  ipcMain.handle('user:watchlist', async (_event, args?: { type?: 'live' | 'movie' | 'series' }) => {
    const sqlite = getSqlite()
    const typeFilter = args?.type ? `AND c.type = ?` : ''
    const params: any[] = args?.type ? [args.type] : []
    return sqlite.prepare(`
      SELECT c.*, c.primary_source_id as source_ids
      FROM user_data ud
      JOIN content c ON c.id = ud.content_id
      WHERE ud.watchlist = 1 AND ud.profile_id = 'default'
      ${typeFilter}
      ORDER BY ud.last_watched_at DESC
    `).all(...params)
  })

  ipcMain.handle('user:continue-watching', async () => {
    const sqlite = getSqlite()
    return sqlite.prepare(`
      SELECT c.*, c.primary_source_id as source_ids, ud.last_position
      FROM user_data ud
      JOIN content c ON c.id = ud.content_id
      WHERE ud.last_position > 0 AND ud.completed = 0
        AND c.type IN ('movie')
        AND ud.profile_id = 'default'
      ORDER BY ud.last_watched_at DESC
      LIMIT 20
    `).all()
  })

  ipcMain.handle('user:history', async (_event, args?: { limit?: number }) => {
    const sqlite = getSqlite()
    const limit = args?.limit ?? 50
    return sqlite.prepare(`
      SELECT c.*, c.primary_source_id as source_ids, ud.last_position, ud.last_watched_at
      FROM user_data ud
      JOIN content c ON c.id = ud.content_id
      WHERE ud.last_watched_at IS NOT NULL AND ud.profile_id = 'default'
      ORDER BY ud.last_watched_at DESC
      LIMIT ?
    `).all(limit)
  })

  ipcMain.handle('user:bulk-get-data', async (_event, contentIds: string[]) => {
    const sqlite = getSqlite()
    if (!contentIds.length) return {}
    const inList = contentIds.map(() => '?').join(',')
    const rows = sqlite.prepare(`
      SELECT * FROM user_data WHERE content_id IN (${inList}) AND profile_id = 'default'
    `).all(...contentIds) as any[]
    const result: Record<string, any> = {}
    for (const row of rows) {
      result[row.content_id] = row
    }
    return result
  })

  ipcMain.handle('user:set-completed', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    sqlite.prepare(`
      INSERT INTO user_data (content_id, completed, last_position, last_watched_at)
      VALUES (?, 1, 0, unixepoch())
      ON CONFLICT(content_id) DO UPDATE SET
        completed = 1,
        last_position = 0,
        last_watched_at = unixepoch()
    `).run(contentId)
    return { success: true }
  })

  ipcMain.handle('user:set-rating', async (_event, args: { contentId: string; rating: number | null }) => {
    const sqlite = getSqlite()
    sqlite.prepare(`
      INSERT INTO user_data (content_id, rating)
      VALUES (?, ?)
      ON CONFLICT(content_id) DO UPDATE SET rating = excluded.rating
    `).run(args.contentId, args.rating)
    return { success: true }
  })

  // ── Diagnostic: category item check ──────────────────────────────────────

  ipcMain.handle('debug:category-items', async (_event, categoryNameSearch: string) => {
    const sqlite = getSqlite()
    // Find all categories matching the search
    const cats = sqlite.prepare(`
      SELECT cat.*, s.name as source_name
      FROM categories cat
      JOIN sources s ON s.id = cat.source_id
      WHERE cat.name LIKE ?
      ORDER BY cat.name
    `).all(`%${categoryNameSearch}%`) as any[]

    const results: any[] = []
    for (const cat of cats) {
      // Find content in this category via junction table
      const catId = `${cat.source_id}:${cat.type}:${cat.external_id}`
      const items = sqlite.prepare(`
        SELECT c.id, c.title, c.external_id, c.type, c.primary_source_id
        FROM content_categories cc
        JOIN content c ON c.id = cc.content_id
        WHERE cc.category_id = ?
      `).all(catId) as any[]

      results.push({
        categoryName: cat.name,
        categoryExternalId: cat.external_id,
        sourceId: cat.source_id,
        sourceName: cat.source_name,
        type: cat.type,
        dbItemCount: cat.item_count,
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
    const total = (sqlite.prepare(`SELECT COUNT(*) as n FROM content WHERE type != 'live'`).get() as any).n
    const enriched = (sqlite.prepare(`SELECT COUNT(*) as n FROM content WHERE type != 'live' AND enriched = 1`).get() as any).n
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
        COUNT(DISTINCT cc.content_id) as item_count,
        MIN(cat.content_synced) as needs_sync,
        MIN(cat.position) as position
      FROM categories cat
      LEFT JOIN content_categories cc ON cc.category_id = cat.id
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

    // Safe sort column map (prevent injection)
    const sortCol: Record<string, string> = {
      title: 'c.title', year: 'c.year', rating: 'c.rating_tmdb', updated: 'c.updated_at',
    }
    const orderBy = `${sortCol[sortBy] ?? 'c.updated_at'} ${sortDir === 'asc' ? 'ASC' : 'DESC'}`

    // Use junction table for category filter (supports multi-category membership)
    const catJoin = categoryName
      ? `JOIN content_categories cc ON cc.content_id = c.id JOIN categories cat ON cat.id = cc.category_id AND cat.name = ?`
      : ''

    // Build WHERE params: [categoryName?, ...filterIds, type?]
    const catParams: any[] = categoryName ? [categoryName] : []
    const typeFilter = type ? `AND c.type = ?` : ''
    const typeParams: any[] = type ? [type] : []

    const countSql = `
      SELECT COUNT(DISTINCT c.id) as n
      FROM content c
      ${catJoin}
      WHERE c.primary_source_id IN (${inList})
      ${typeFilter}
    `
    const total = (sqlite.prepare(countSql).get(...catParams, ...filterIds, ...typeParams) as any).n

    const itemSql = `
      SELECT DISTINCT c.*, c.primary_source_id as source_ids
      FROM content c
      ${catJoin}
      WHERE c.primary_source_id IN (${inList})
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
    const item = sqlite.prepare('SELECT * FROM content WHERE id = ?').get(contentId) as any
    if (!item) return { success: false, error: 'Content not found' }
    if (item.type === 'live') return { success: false, error: 'Live channels are not enriched' }

    // If previously enriched but has no metadata, reset so we retry
    const hasData = item.plot || item.director || item.cast || item.genres
    if (item.enriched && hasData) {
      console.log(`[Enrich] ${contentId} already enriched with data`)
      return { success: true, alreadyEnriched: true }
    }
    if (item.enriched && !hasData) {
      console.log(`[Enrich] ${contentId} was marked enriched but has no data — retrying`)
      sqlite.prepare('UPDATE content SET enriched = 0 WHERE id = ?').run(contentId)
    }

    console.log(`[Enrich] Calling TMDB for "${item.title}" (type=${item.type}, year=${item.year})`)
    try {
      await tmdbService.enrichBatch([contentId])
    } catch (err) {
      console.error(`[Enrich] enrichBatch failed:`, err)
      return { success: false, error: String(err) }
    }

    // Return the updated content row
    const updated = sqlite.prepare(`
      SELECT c.*, c.primary_source_id as source_ids,
             GROUP_CONCAT(DISTINCT cat.name) as category_name
      FROM content c
      LEFT JOIN content_categories cc ON cc.content_id = c.id
      LEFT JOIN categories cat ON cat.id = cc.category_id
      WHERE c.id = ?
      GROUP BY c.id
    `).get(contentId) as any
    const enrichedWithData = !!(updated?.plot || updated?.director || updated?.cast || updated?.genres)
    console.log(`[Enrich] Done for ${contentId}, gotData=${enrichedWithData}`)
    return { success: true, content: updated, enrichedWithData }
  })

  // Manual enrichment — user provides a corrected search title
  ipcMain.handle('enrichment:enrich-manual', async (_event, args: { contentId: string; title: string; year?: number }) => {
    if (!tmdbService.hasKey()) return { success: false, error: 'No TMDB API key configured' }

    const sqlite = getSqlite()
    const item = sqlite.prepare('SELECT * FROM content WHERE id = ?').get(args.contentId) as any
    if (!item) return { success: false, error: 'Content not found' }

    // Reset enriched flag so enrichBatch will process it
    sqlite.prepare('UPDATE content SET enriched = 0 WHERE id = ?').run(args.contentId)

    // Temporarily override the title for search purposes
    console.log(`[Enrich] Manual search: "${args.title}" (year=${args.year ?? 'none'}) for ${args.contentId}`)

    // Call enrichMovie/enrichSeries directly with the user-provided title
    try {
      await tmdbService.enrichWithTitle(args.contentId, args.title, item.type, args.year)
    } catch (err) {
      console.error(`[Enrich] Manual enrich failed:`, err)
      return { success: false, error: String(err) }
    }

    const updated = sqlite.prepare(`
      SELECT c.*, c.primary_source_id as source_ids,
             GROUP_CONCAT(DISTINCT cat.name) as category_name
      FROM content c
      LEFT JOIN content_categories cc ON cc.content_id = c.id
      LEFT JOIN categories cat ON cat.id = cc.category_id
      WHERE c.id = ?
      GROUP BY c.id
    `).get(args.contentId) as any
    const enrichedWithData = !!(updated?.plot || updated?.director || updated?.cast || updated?.genres)
    console.log(`[Enrich] Manual done for ${args.contentId}, gotData=${enrichedWithData}`)
    return { success: true, content: updated, enrichedWithData }
  })

  ipcMain.handle('enrichment:start', async (event, apiKey?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sqlite = getSqlite()

    if (apiKey) tmdbService.setApiKey(apiKey)

    // Get unenriched content IDs (batch up to 500 at a time to avoid memory issues)
    const rows = sqlite.prepare(
      `SELECT id FROM content WHERE type != 'live' AND enriched = 0 ORDER BY updated_at DESC LIMIT 500`
    ).all() as { id: string }[]

    if (rows.length === 0) return { success: true, message: 'Nothing to enrich' }

    const ids = rows.map((r) => r.id)

    // Run in background, send progress events
    tmdbService.enrichBatch(ids, (done, total) => {
      win?.webContents.send('enrichment:progress', { done, total })
    }).then(() => {
      win?.webContents.send('enrichment:progress', { done: ids.length, total: ids.length, complete: true })
    }).catch((err) => {
      win?.webContents.send('enrichment:progress', { error: String(err) })
    })

    return { success: true, message: `Enriching ${ids.length} items…` }
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
