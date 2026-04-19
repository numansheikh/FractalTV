// ─── EPG handlers ─────────────────────────────────────────────────────────────
// Covers: sources:sync-epg, epg:fetch-short, epg:now-next, epg:guide,
//         content:get-catchup-url

import { ipcMain, BrowserWindow } from 'electron'
import { getDb, getSqlite } from '../../database/connection'
import { sources } from '../../database/schema'
import { eq } from 'drizzle-orm'
import { syncEpg, syncEpgFromUrl, getNowNext, fetchShortEpgForChannel } from '../../services/epg.service'
import { xtreamService } from '../../services/xtream.service'
import { ChannelRow } from './shared'

// Last-fetch timestamp (ms) per channel-id for `epg:fetch-short`. Prevents
// refetch storms when a detail panel is opened repeatedly.
const shortEpgCache = new Map<string, number>()

export function registerEpgHandlers(ipcMain_: typeof ipcMain): void {
  // `sources:sync-epg` — standalone EPG-only sync for Xtream sources.
  // Mirrors the EPG chain inside sources:sync but without re-syncing content.
  ipcMain_.handle('sources:sync-epg', async (event, sourceId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sqlite = getSqlite()
    const source = sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined
    if (!source) return { success: false, error: 'Source not found' }
    const onEpgProgress = (m: string) => win?.webContents.send('sync:progress', {
      sourceId, phase: 'epg', current: 0, total: 0, message: m,
    })

    win?.webContents.send('sync:progress', {
      sourceId, phase: 'epg', current: 0, total: 0, message: 'Fetching EPG…',
    })

    let result: { inserted: number; error?: string }
    if (source.type === 'm3u') {
      const epgUrl = source.epg_url ?? null
      if (!epgUrl) return { success: false, error: 'No EPG URL found in this M3U playlist' }
      result = await syncEpgFromUrl(sourceId, epgUrl, onEpgProgress)
    } else {
      if (!source.server_url) return { success: false, error: 'Source missing server URL' }
      result = await syncEpg(
        sourceId, source.server_url, source.username, source.password, onEpgProgress
      )
    }
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

  // `epg:fetch-short` — on-demand per-channel EPG fallback for Xtream channels
  // that returned nothing from the full xmltv.php sync. 1-hour in-memory cache
  // guard prevents refetch storms when a detail panel is opened repeatedly.
  ipcMain_.handle('epg:fetch-short', async (_event, contentId: string) => {
    const cached = shortEpgCache.get(contentId)
    if (cached && Date.now() - cached < 3_600_000) return { cached: true, inserted: 0 }

    const sqlite = getSqlite()
    const ch = sqlite.prepare(
      `SELECT external_id, source_id, epg_channel_id FROM channels WHERE id = ?`
    ).get(contentId) as { external_id: string; source_id: string; epg_channel_id: string | null } | undefined
    if (!ch?.external_id) return { error: 'Channel not found', inserted: 0 }

    const source = sqlite.prepare(
      `SELECT type, server_url, username, password FROM sources WHERE id = ?`
    ).get(ch.source_id) as { type: string; server_url: string; username: string; password: string } | undefined
    if (source?.type !== 'xtream' || !source.server_url) {
      return { error: 'Xtream-only fallback', inserted: 0 }
    }

    const epgChannelId = ch.epg_channel_id ?? ch.external_id
    const result = await fetchShortEpgForChannel(
      ch.source_id, source.server_url, source.username, source.password,
      ch.external_id, epgChannelId,
    )
    shortEpgCache.set(contentId, Date.now())
    return result
  })

  // `epg:now-next` and `epg:guide` are read-only lookups.
  ipcMain_.handle('epg:now-next', (_event, contentId: string) => getNowNext(contentId))

  ipcMain_.handle('epg:guide', (_event, args: { contentIds: string[]; startTime?: number; endTime?: number }) => {
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

  ipcMain_.handle('content:get-catchup-url', async (_event, args: { contentId: string; startTime: number; duration: number }) => {
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
}
