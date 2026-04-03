import { ipcMain, BrowserWindow } from 'electron'
import { getDb, getSqlite } from '../database/connection'
import { sources } from '../database/schema'
import { eq } from 'drizzle-orm'
import { xtreamService, SyncProgress } from '../services/xtream.service'
import { tmdbService } from '../services/tmdb.service'

export function registerHandlers() {

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
    const sqlite = getSqlite()
    // Manually cascade — content table has no ON DELETE CASCADE
    sqlite.transaction(() => {
      sqlite.prepare(`DELETE FROM content_fts WHERE content_id IN (SELECT id FROM content WHERE primary_source_id = ?)`).run(sourceId)
      sqlite.prepare(`DELETE FROM user_data WHERE content_id IN (SELECT id FROM content WHERE primary_source_id = ?)`).run(sourceId)
      sqlite.prepare(`DELETE FROM embeddings WHERE content_id IN (SELECT id FROM content WHERE primary_source_id = ?)`).run(sourceId)
      sqlite.prepare(`DELETE FROM content_sources WHERE source_id = ?`).run(sourceId)
      sqlite.prepare(`DELETE FROM content WHERE primary_source_id = ?`).run(sourceId)
      sqlite.prepare(`DELETE FROM categories WHERE source_id = ?`).run(sourceId)
      sqlite.prepare(`DELETE FROM epg WHERE source_id = ?`).run(sourceId)
      sqlite.prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId)
    })()
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

    const onProgress = (progress: SyncProgress) => {
      // Send progress updates to the renderer
      win?.webContents.send('sync:progress', progress)
    }

    try {
      await xtreamService.syncSource(sourceId, onProgress)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── Search ───────────────────────────────────────────────────────────────

  ipcMain.handle('search:query', async (_event, args: {
    query: string
    type?: 'live' | 'movie' | 'series'
    sourceIds?: string[]
    limit?: number
    offset?: number
  }) => {
    const sqlite = getSqlite()
    const { type, sourceIds, limit = 50, offset = 0 } = args
    // Normalize: decompose accented chars then strip combining marks
    // "café" → "cafe", "ñ" → "n", "Ö" → "O" — matches both ways
    const query = args.query
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()

    // Build source filter clause — only include content from enabled, selected sources
    const enabledSources = (sqlite.prepare(`SELECT id FROM sources WHERE disabled = 0`).all() as { id: string }[]).map(r => r.id)
    const filterIds = sourceIds && sourceIds.length > 0
      ? sourceIds.filter(id => enabledSources.includes(id))
      : enabledSources
    const sourceFilter = filterIds.length > 0
      ? `AND c.primary_source_id IN (${filterIds.map(() => '?').join(',')})`
      : 'AND 1=0'

    if (!query || query.trim().length === 0) {
      // Empty query = browse content
      const sql = `
        SELECT c.*, GROUP_CONCAT(cs.source_id) as source_ids
        FROM content c
        LEFT JOIN content_sources cs ON cs.content_id = c.id
        WHERE 1=1
        ${type ? `AND c.type = '${type}'` : ''}
        ${sourceFilter}
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?
      `
      return sqlite.prepare(sql).all(...filterIds, limit, offset)
    }

    // FTS5 search
    const sql = `
      SELECT c.*, fts.rank, GROUP_CONCAT(cs.source_id) as source_ids
      FROM content_fts fts
      JOIN content c ON c.id = fts.content_id
      LEFT JOIN content_sources cs ON cs.content_id = c.id
      WHERE content_fts MATCH ?
      ${type ? `AND c.type = '${type}'` : ''}
      ${sourceFilter}
      GROUP BY c.id
      ORDER BY fts.rank
      LIMIT ? OFFSET ?
    `

    try {
      const ftsQuery = `"${query.replace(/"/g, '""')}"* OR ${query.split(/\s+/).map(w => `${w}*`).join(' OR ')}`
      return sqlite.prepare(sql).all(ftsQuery, ...filterIds, limit, offset)
    } catch {
      const likeQuery = `%${query}%`
      return sqlite.prepare(`
        SELECT c.*, GROUP_CONCAT(cs.source_id) as source_ids
        FROM content c
        LEFT JOIN content_sources cs ON cs.content_id = c.id
        WHERE c.title LIKE ?
        ${type ? `AND c.type = '${type}'` : ''}
        ${sourceFilter}
        GROUP BY c.id
        LIMIT ? OFFSET ?
      `).all(likeQuery, ...filterIds, limit, offset)
    }
  })

  // ── Content ──────────────────────────────────────────────────────────────

  ipcMain.handle('content:get', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const item = sqlite.prepare(`
      SELECT c.*, GROUP_CONCAT(cs.source_id) as source_ids
      FROM content c
      LEFT JOIN content_sources cs ON cs.content_id = c.id
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

    // Get content
    const item = sqlite.prepare('SELECT * FROM content WHERE id = ?').get(args.contentId) as any
    if (!item) return { error: 'Content not found' }

    // Get source — prefer requested sourceId, else pick highest priority
    const sourceRow = args.sourceId
      ? sqlite.prepare('SELECT * FROM content_sources WHERE content_id = ? AND source_id = ?').get(args.contentId, args.sourceId) as any
      : sqlite.prepare('SELECT * FROM content_sources WHERE content_id = ? ORDER BY priority DESC LIMIT 1').get(args.contentId) as any

    if (!sourceRow) return { error: 'No stream source found' }

    const [source] = await db.select().from(sources).where(eq(sources.id, sourceRow.source_id))
    if (!source?.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    const url = xtreamService.buildStreamUrl(
      source.serverUrl, source.username, source.password,
      item.type === 'live' ? 'live' : 'movie',
      sourceRow.external_id,
      item.container_extension
    )

    return { url, sourceId: source.id }
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

  // ── TMDB enrichment ──────────────────────────────────────────────────────

  ipcMain.handle('enrichment:set-api-key', (_event, key: string) => {
    tmdbService.setApiKey(key)
    return { success: true }
  })

  ipcMain.handle('enrichment:status', () => {
    const sqlite = getSqlite()
    const total = (sqlite.prepare('SELECT COUNT(*) as n FROM content WHERE type != "live"').get() as any).n
    const enriched = (sqlite.prepare('SELECT COUNT(*) as n FROM content WHERE type != "live" AND enriched = 1').get() as any).n
    return { total, enriched, pending: total - enriched }
  })

  ipcMain.handle('enrichment:start', async (event, apiKey?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sqlite = getSqlite()

    if (apiKey) tmdbService.setApiKey(apiKey)

    // Get unenriched content IDs (batch up to 500 at a time to avoid memory issues)
    const rows = sqlite.prepare(
      'SELECT id FROM content WHERE type != "live" AND enriched = 0 ORDER BY updated_at DESC LIMIT 500'
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
