// ─── Enrichment handlers ──────────────────────────────────────────────────────
// Covers: iptvOrg:status/pull, vodEnrich:* handlers, categories:set-nsfw/list

import { ipcMain, BrowserWindow } from 'electron'
import { getSqlite, getSetting } from '../../database/connection'
import { pullAll as iptvOrgPullAll, getStatus as iptvOrgGetStatus } from '../../services/iptv-org'
import {
  enrichForSource as vodEnrichForSource,
  enrichSingle as vodEnrichSingle,
  getForContent as vodGetForContent,
  pickCandidate as vodPickCandidate,
  disableEnrichment as vodDisableEnrichment,
  resetEnrichment as vodResetEnrichment,
  getEnrichStatus as vodGetEnrichStatus,
  setTmdbInvalidKeyListener,
  setTmdbRateLimitListener,
} from '../../services/enrichment-vod'
import { applyNsfwFlags, getEnabledSourceIds } from './shared'

export function registerEnrichmentHandlers(ipcMain_: typeof ipcMain): void {
  // ── iptv-org channel database (g2 — independent module) ─────────────
  ipcMain_.handle('iptvOrg:status', () => iptvOrgGetStatus())

  ipcMain_.handle('iptvOrg:pull', async (event) => {
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

  // ── VoD enrichment (g2 — keyless: Wikipedia + Wikidata + IMDb suggest) ──

  // Tracks which sources are currently being enriched — prevents concurrent runs per source
  const vodEnrichingJobs = new Set<string>()

  // Broadcast when TMDB returns 401/403 — renderer surfaces a toast + demotion.
  setTmdbInvalidKeyListener(() => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('enrichment:tmdb-invalid')
    }
  })

  // Broadcast when TMDB rate-limits us after retries exhaust — renderer can
  // show a "paused — rate limit" banner until `resumeAtMs`.
  setTmdbRateLimitListener((resumeAtMs: number) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('enrichment:tmdb-rate-limit', { resumeAtMs })
    }
  })

  ipcMain_.handle('vodEnrich:status', () => {
    try { return { ok: true, ...vodGetEnrichStatus() } } catch { return { ok: false, movies_enriched: 0, series_enriched: 0 } }
  })

  ipcMain_.handle('vodEnrich:enrich', (_event, sourceId: string, force = false) => {
    if (vodEnrichingJobs.has(sourceId)) {
      return { ok: false, alreadyRunning: true, error: 'Enrichment already running for this source' }
    }
    vodEnrichingJobs.add(sourceId)

    // Broadcast to all windows — survives SourcesPanel close/reopen
    const broadcast = (p: any) =>
      BrowserWindow.getAllWindows()[0]?.webContents.send('vodEnrich:progress', { sourceId, ...p })

    // Fire and forget — returns immediately, job continues in background
    vodEnrichForSource(sourceId, broadcast, force)
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e)
        broadcast({ phase: 'error', current: 0, total: 0, error: message })
      })
      .finally(() => {
        vodEnrichingJobs.delete(sourceId)
      })

    return { ok: true, started: true }
  })

  ipcMain_.handle('vodEnrich:getForContent', (_event, contentId: string) => {
    try { return vodGetForContent(contentId) } catch { return { disabled: false, selected_id: null, candidates: [] } }
  })

  ipcMain_.handle('vodEnrich:enrichSingle', async (_event, contentId: string, force = false) => {
    try { return await vodEnrichSingle(contentId, force) } catch { return { disabled: false, selected_id: null, candidates: [] } }
  })

  // ── Background prefetch: visible Browse cards ──
  // Each call bumps the epoch, cancelling the previous loop. Level 1 cap protects TMDB quota.
  let prefetchEpoch = 0
  ipcMain_.handle('vodEnrich:prefetchVisible', async (_event, contentIds: string[]) => {
    const myEpoch = ++prefetchEpoch
    for (const id of contentIds) {
      if (myEpoch !== prefetchEpoch) return { ok: true, cancelled: true }
      if (!id.includes(':movie:') && !id.includes(':series:')) continue
      try { await vodEnrichSingle(id, false, '1') } catch { /* silent — prefetch best-effort */ }
      await new Promise<void>((r) => setImmediate(r))
    }
    return { ok: true, cancelled: false }
  })
  ipcMain_.handle('vodEnrich:cancelPrefetch', () => {
    prefetchEpoch++
    return { ok: true }
  })

  ipcMain_.handle('vodEnrich:pickCandidate', (_event, contentId: string, enrichmentId: number) => {
    try { vodPickCandidate(contentId, enrichmentId); return { ok: true } } catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain_.handle('vodEnrich:disable', (_event, contentId: string) => {
    try { vodDisableEnrichment(contentId); return { ok: true } } catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain_.handle('vodEnrich:reset', (_event, contentId: string) => {
    try { vodResetEnrichment(contentId); return { ok: true } } catch (e) { return { ok: false, error: String(e) } }
  })

  // ── Categories ────────────────────────────────────────────────────────
  ipcMain_.handle('categories:set-nsfw', (_event, id: string, value: 0 | 1) => {
    const sqlite = getSqlite()
    const table = id.includes(':chancat:')   ? 'channel_categories'
                : id.includes(':moviecat:')  ? 'movie_categories'
                : id.includes(':seriescat:') ? 'series_categories'
                : (() => { throw new Error(`Unknown category ID format: ${id}`) })()
    const contentType = table === 'channel_categories' ? 'live'
                      : table === 'movie_categories'   ? 'movie'
                      :                                  'series'
    // Mark ALL categories with the same name (covers multiple sources) and
    // persist an override row per (source, external_id) so the decision
    // survives resyncs that wipe and recreate category rows.
    const row = sqlite.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as { name: string } | undefined
    if (!row) return { ok: false }
    const affected = sqlite.prepare(
      `SELECT source_id, external_id FROM ${table} WHERE name = ?`
    ).all(row.name) as { source_id: string; external_id: string }[]
    const upsert = sqlite.prepare(`
      INSERT INTO category_overrides (source_id, content_type, category_external_id, is_nsfw, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(source_id, content_type, category_external_id) DO UPDATE SET
        is_nsfw    = excluded.is_nsfw,
        updated_at = excluded.updated_at
    `)
    sqlite.transaction(() => {
      for (const r of affected) upsert.run(r.source_id, contentType, r.external_id, value)
    })()
    applyNsfwFlags(sqlite)
    return { ok: true }
  })

  ipcMain_.handle('categories:list', (_event, args: {
    type?: 'live' | 'movie' | 'series'
    sourceIds?: string[]
  }) => {
    const sqlite = getSqlite()
    const enabledSources = getEnabledSourceIds(sqlite)
    const filterIds = args.sourceIds?.length
      ? args.sourceIds.filter(id => enabledSources.has(id))
      : [...enabledSources]
    if (!filterIds.length) return []

    const inList = filterIds.map(() => '?').join(',')

    // Query each per-type table, count via the content-table category_id FK,
    // and merge in JS so the shape matches the old `categories` join.
    const queries = [
      { table: 'channel_categories', content: 'channels', type: 'live' as const },
      { table: 'movie_categories',   content: 'movies',   type: 'movie' as const },
      { table: 'series_categories',  content: 'series',   type: 'series' as const },
    ]

    const allowAdult = getSetting('allow_adult') === '1'

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
}
