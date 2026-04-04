import { getDb, getSqlite } from '../database/connection'
import { sources, categories, content, contentSources } from '../database/schema'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { normalizeForSearch } from '../lib/normalize'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/** Normalize text for FTS indexing (anyAscii + lowercase). Returns null for empty input. */
function normalize(text: string | null | undefined): string | null {
  if (!text) return null
  return normalizeForSearch(text)
}

// ─── Xtream API Types ─────────────────────────────────────────────────────────

interface XtreamUserInfo {
  username: string
  password: string
  status: string
  exp_date: string | null
  max_connections: string
  active_cons: string
}

interface XtreamServerInfo {
  url: string
  port: string
  https_port: string
  server_protocol: string
  rtmp_port: string
  timezone: string
  timestamp_now: number
  time_now: string
}

interface XtreamCategory {
  category_id: string
  category_name: string
  parent_id: number
}

interface XtreamLiveStream {
  num: number
  name: string
  stream_type: string
  stream_id: number
  stream_icon: string
  epg_channel_id: string
  added: string
  category_id: string
  custom_sid: string
  tv_archive: number
  direct_source: string
  tv_archive_duration: number
}

interface XtreamVodStream {
  num: number
  name: string
  stream_type: string
  stream_id: number
  stream_icon: string
  rating: string
  rating_5based: number
  added: string
  category_id: string
  container_extension: string
  custom_sid: string
  direct_source: string
}

interface XtreamSeries {
  num: number
  name: string
  series_id: number
  cover: string
  plot: string
  cast: string
  director: string
  genre: string
  releaseDate: string
  last_modified: string
  rating: string
  rating_5based: number
  backdrop_path: string[]
  youtube_trailer: string
  episode_run_time: string
  category_id: string
}

// ─── Sync result for progress reporting ──────────────────────────────────────

export interface SyncProgress {
  sourceId: string
  phase: 'categories' | 'live' | 'movies' | 'series' | 'done' | 'error'
  current: number
  total: number
  message: string
}

export type SyncProgressCallback = (progress: SyncProgress) => void

// ─── XtreamService ────────────────────────────────────────────────────────────

export class XtreamService {
  private buildApiUrl(serverUrl: string, username: string, password: string, action: string, extra = '') {
    const base = serverUrl.replace(/\/$/, '')
    return `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=${action}${extra}`
  }

  async testConnection(serverUrl: string, username: string, password: string): Promise<{
    success: boolean
    userInfo?: XtreamUserInfo
    serverInfo?: XtreamServerInfo
    error?: string
  }> {
    try {
      const url = this.buildApiUrl(serverUrl, username, password, 'get_user_info') + '&' +
        `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`

      // Basic auth info endpoint
      const base = serverUrl.replace(/\/$/, '')
      const resp = await fetch(`${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`, {
        signal: AbortSignal.timeout(10000),
      })

      if (!resp.ok) {
        return { success: false, error: `Server returned ${resp.status}` }
      }

      const data = await resp.json() as { user_info: XtreamUserInfo; server_info: XtreamServerInfo }

      if (!data.user_info) {
        return { success: false, error: 'Invalid credentials or server response' }
      }

      return {
        success: true,
        userInfo: data.user_info,
        serverInfo: data.server_info,
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  async addSource(name: string, serverUrl: string, username: string, password: string): Promise<{
    success: boolean
    sourceId?: string
    error?: string
  }> {
    // Test connection first
    const test = await this.testConnection(serverUrl, username, password)
    if (!test.success) {
      return { success: false, error: test.error }
    }

    const db = getDb()
    const sourceId = randomUUID()

    await db.insert(sources).values({
      id: sourceId,
      type: 'xtream',
      name,
      serverUrl: serverUrl.replace(/\/$/, ''),
      username,
      password,
      status: 'active',
      expDate: test.userInfo?.exp_date ?? null,
      maxConnections: test.userInfo?.max_connections ? parseInt(test.userInfo.max_connections) : null,
      subscriptionType: (test.userInfo as any)?.subscription_type ?? null,
    } as any)

    return { success: true, sourceId }
  }

  async syncSource(sourceId: string, onProgress?: SyncProgressCallback): Promise<void> {
    const db = getDb()
    const sqlite = getSqlite()

    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId))
    if (!source || source.type !== 'xtream') {
      throw new Error(`Source ${sourceId} not found`)
    }

    const { serverUrl, username, password } = source
    if (!serverUrl || !username || !password) {
      throw new Error('Source missing credentials')
    }

    // Mark as syncing
    await db.update(sources).set({ status: 'syncing' }).where(eq(sources.id, sourceId))

    try {
      const base = serverUrl.replace(/\/$/, '')
      const apiBase = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`

      // ── Sync categories (3 fast API calls) ───────────────────────────────
      onProgress?.({ sourceId, phase: 'categories', current: 0, total: 3, message: 'Fetching categories...' })

      const [liveCats, vodCats, seriesCats] = await Promise.all([
        fetch(`${apiBase}&action=get_live_categories`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()) as Promise<XtreamCategory[]>,
        fetch(`${apiBase}&action=get_vod_categories`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()) as Promise<XtreamCategory[]>,
        fetch(`${apiBase}&action=get_series_categories`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()) as Promise<XtreamCategory[]>,
      ])

      // Upsert categories — preserve content_synced so existing synced categories
      // don't get wiped on re-sync (only update the name if it changed)
      const insertCat = sqlite.prepare(`
        INSERT INTO categories (id, source_id, external_id, name, type, position)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, position = excluded.position
      `)
      const insertAllCats = sqlite.transaction((cats: XtreamCategory[], type: string) => {
        for (let i = 0; i < cats.length; i++) {
          const cat = cats[i]
          insertCat.run(`${sourceId}:${type}:${cat.category_id}`, sourceId, cat.category_id, cat.category_name, type, i)
        }
      })
      insertAllCats(liveCats || [], 'live')
      insertAllCats(vodCats || [], 'movie')
      insertAllCats(seriesCats || [], 'series')

      const catCount = (liveCats?.length ?? 0) + (vodCats?.length ?? 0) + (seriesCats?.length ?? 0)

      // ── Bulk fetch all content (3 calls, no per-category loop) ───────────
      // Use longer timeouts — some providers return 50k+ items per endpoint
      const FETCH_TIMEOUT = 120_000 // 2 minutes

      onProgress?.({ sourceId, phase: 'live', current: 0, total: 0, message: 'Fetching live streams…' })
      const liveStreams = await this.fetchJson<XtreamLiveStream[]>(`${apiBase}&action=get_live_streams`, FETCH_TIMEOUT, 'live_streams')
      await this.upsertLiveStreams(sqlite, sourceId, liveStreams || [], onProgress)

      onProgress?.({ sourceId, phase: 'movies', current: 0, total: 0, message: 'Fetching movies…' })
      const vodStreams = await this.fetchJson<XtreamVodStream[]>(`${apiBase}&action=get_vod_streams`, FETCH_TIMEOUT, 'vod_streams')
      await this.upsertVodStreams(sqlite, sourceId, vodStreams || [], onProgress)

      onProgress?.({ sourceId, phase: 'series', current: 0, total: 0, message: 'Fetching series…' })
      const seriesList = await this.fetchJson<XtreamSeries[]>(`${apiBase}&action=get_series`, FETCH_TIMEOUT, 'series')
      await this.upsertSeries(sqlite, sourceId, seriesList || [], onProgress)

      // ── Save raw API responses for inspection (async to avoid blocking) ──
      try {
        const srcName = source.name ?? 'unknown'
        const dumpDir = join(homedir(), '.fractals', 'sync-dumps', `${srcName.replace(/[^a-zA-Z0-9]/g, '_')}_${sourceId.slice(0, 8)}`)
        mkdirSync(dumpDir, { recursive: true })
        // Categories are small — write synchronously
        writeFileSync(join(dumpDir, 'live_categories.json'), JSON.stringify(liveCats, null, 2))
        writeFileSync(join(dumpDir, 'vod_categories.json'), JSON.stringify(vodCats, null, 2))
        writeFileSync(join(dumpDir, 'series_categories.json'), JSON.stringify(seriesCats, null, 2))
        // Content lists can be huge — write counts + sample only
        const writeSample = (name: string, data: any[]) => {
          const summary = { total: data?.length ?? 0, sample: (data || []).slice(0, 5) }
          writeFileSync(join(dumpDir, name), JSON.stringify(summary, null, 2))
        }
        writeSample('live_streams.json', liveStreams as any[])
        writeSample('vod_streams.json', vodStreams as any[])
        writeSample('series_list.json', seriesList as any[])
        console.log(`[Sync] API dump saved to ${dumpDir} (live:${liveStreams?.length ?? 0}, vod:${vodStreams?.length ?? 0}, series:${seriesList?.length ?? 0})`)
      } catch (e) {
        console.warn('[Sync] Failed to save dump:', e)
      }

      // Mark all categories as synced (content is now in DB)
      sqlite.prepare('UPDATE categories SET content_synced = 1 WHERE source_id = ?').run(sourceId)

      const totalItems = (sqlite.prepare('SELECT COUNT(*) as n FROM content WHERE primary_source_id = ?').get(sourceId) as any).n

      await db.update(sources).set({
        status: 'active',
        lastSync: new Date(),
        lastError: null,
        itemCount: totalItems,
      } as any).where(eq(sources.id, sourceId))

      onProgress?.({ sourceId, phase: 'done', current: totalItems, total: totalItems, message: `Synced ${catCount} categories, ${totalItems.toLocaleString()} items` })

    } catch (err) {
      await db.update(sources).set({
        status: 'error',
        lastError: String(err),
      }).where(eq(sources.id, sourceId))

      onProgress?.({ sourceId, phase: 'error', current: 0, total: 0, message: String(err) })
      throw err
    }
  }

  /** Fetch content for a single category from the Xtream API and store it. */
  async syncCategory(sourceId: string, categoryExternalId: string, categoryType: 'live' | 'movie' | 'series'): Promise<number> {
    const db = getDb()
    const sqlite = getSqlite()

    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId))
    if (!source?.serverUrl || !source.username || !source.password) {
      throw new Error(`Source ${sourceId} not found or missing credentials`)
    }

    const base = source.serverUrl.replace(/\/$/, '')
    const apiBase = `${base}/player_api.php?username=${encodeURIComponent(source.username)}&password=${encodeURIComponent(source.password)}`
    const catParam = `&category_id=${encodeURIComponent(categoryExternalId)}`

    let count = 0
    if (categoryType === 'live') {
      const streams = await this.fetchJson<XtreamLiveStream[]>(`${apiBase}&action=get_live_streams${catParam}`, 60_000, `cat:${categoryExternalId}:live`)
      await this.upsertLiveStreams(sqlite, sourceId, streams || [])
      count = streams?.length ?? 0
    } else if (categoryType === 'movie') {
      const streams = await this.fetchJson<XtreamVodStream[]>(`${apiBase}&action=get_vod_streams${catParam}`, 60_000, `cat:${categoryExternalId}:vod`)
      await this.upsertVodStreams(sqlite, sourceId, streams || [])
      count = streams?.length ?? 0
    } else {
      const seriesList = await this.fetchJson<XtreamSeries[]>(`${apiBase}&action=get_series${catParam}`, 60_000, `cat:${categoryExternalId}:series`)
      await this.upsertSeries(sqlite, sourceId, seriesList || [])
      count = seriesList?.length ?? 0
    }

    // Mark this category as synced
    sqlite.prepare(`UPDATE categories SET content_synced = 1 WHERE source_id = ? AND external_id = ? AND type = ?`)
      .run(sourceId, categoryExternalId, categoryType)

    // Update source item count
    const total = (sqlite.prepare('SELECT COUNT(*) as n FROM content WHERE primary_source_id = ?').get(sourceId) as any).n
    sqlite.prepare('UPDATE sources SET item_count = ? WHERE id = ?').run(total, sourceId)

    return count
  }

  /** Fetch JSON with timeout + error logging (never silently swallows errors). */
  private async fetchJson<T>(url: string, timeout: number, label: string): Promise<T> {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(timeout) })
      if (!resp.ok) {
        console.error(`[Sync] ${label}: HTTP ${resp.status} ${resp.statusText}`)
        return [] as unknown as T
      }
      const data = await resp.json()
      const count = Array.isArray(data) ? data.length : '?'
      console.log(`[Sync] ${label}: fetched ${count} items`)
      return data as T
    } catch (err) {
      console.error(`[Sync] ${label}: fetch failed —`, err)
      return [] as unknown as T
    }
  }

  private async upsertLiveStreams(
    sqlite: ReturnType<typeof getSqlite>,
    sourceId: string,
    streams: XtreamLiveStream[],
    onProgress?: SyncProgressCallback
  ) {
    const insertContent = sqlite.prepare(`
      INSERT OR REPLACE INTO content
        (id, primary_source_id, external_id, type, title, category_id, poster_url, catchup_supported, catchup_days, updated_at)
      VALUES (?, ?, ?, 'live', ?, ?, ?, ?, ?, unixepoch())
    `)
    const insertSource = sqlite.prepare(`
      INSERT OR REPLACE INTO content_sources (id, content_id, source_id, external_id, quality)
      VALUES (?, ?, ?, ?, 'HD')
    `)
    const updateFts = sqlite.prepare(`
      INSERT OR REPLACE INTO content_fts (content_id, title)
      VALUES (?, ?)
    `)
    const insertCC = sqlite.prepare(`
      INSERT OR IGNORE INTO content_categories (content_id, category_id)
      VALUES (?, ?)
    `)

    const batch = sqlite.transaction((items: XtreamLiveStream[]) => {
      for (const stream of items) {
        const contentId = `${sourceId}:live:${stream.stream_id}`
        const contentSourceId = `${sourceId}:live:${stream.stream_id}`

        insertContent.run(
          contentId, sourceId, String(stream.stream_id), stream.name,
          stream.category_id || null, stream.stream_icon || null,
          stream.tv_archive ? 1 : 0, stream.tv_archive_duration || 0
        )
        insertSource.run(contentSourceId, contentId, sourceId, String(stream.stream_id))
        updateFts.run(contentId, normalize(stream.name))
        if (stream.category_id) {
          insertCC.run(contentId, `${sourceId}:live:${stream.category_id}`)
        }
      }
    })

    // Process in batches of 500, yielding to event loop between batches
    const BATCH = 500
    for (let i = 0; i < streams.length; i += BATCH) {
      batch(streams.slice(i, i + BATCH))
      onProgress?.({ sourceId, phase: 'live', current: Math.min(i + BATCH, streams.length), total: streams.length, message: `Channels: ${Math.min(i + BATCH, streams.length)}/${streams.length}` })
      // Yield to event loop so the UI stays responsive
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  private async upsertVodStreams(
    sqlite: ReturnType<typeof getSqlite>,
    sourceId: string,
    streams: XtreamVodStream[],
    onProgress?: SyncProgressCallback
  ) {
    const insertContent = sqlite.prepare(`
      INSERT OR REPLACE INTO content
        (id, primary_source_id, external_id, type, title, category_id, poster_url, rating_tmdb, container_extension, updated_at)
      VALUES (?, ?, ?, 'movie', ?, ?, ?, ?, ?, unixepoch())
    `)
    const insertSource = sqlite.prepare(`
      INSERT OR REPLACE INTO content_sources (id, content_id, source_id, external_id)
      VALUES (?, ?, ?, ?)
    `)
    const updateFts = sqlite.prepare(`
      INSERT OR REPLACE INTO content_fts (content_id, title)
      VALUES (?, ?)
    `)
    const insertCC = sqlite.prepare(`
      INSERT OR IGNORE INTO content_categories (content_id, category_id)
      VALUES (?, ?)
    `)

    const batch = sqlite.transaction((items: XtreamVodStream[]) => {
      for (const stream of items) {
        const contentId = `${sourceId}:movie:${stream.stream_id}`
        const contentSourceId = `${sourceId}:movie:${stream.stream_id}`

        insertContent.run(
          contentId, sourceId, String(stream.stream_id), stream.name,
          stream.category_id || null, stream.stream_icon || null,
          stream.rating_5based ? stream.rating_5based * 2 : null, // convert 5-based to 10-based
          stream.container_extension || null
        )
        insertSource.run(contentSourceId, contentId, sourceId, String(stream.stream_id))
        updateFts.run(contentId, normalize(stream.name))
        if (stream.category_id) {
          insertCC.run(contentId, `${sourceId}:movie:${stream.category_id}`)
        }
      }
    })

    const BATCH = 500
    for (let i = 0; i < streams.length; i += BATCH) {
      batch(streams.slice(i, i + BATCH))
      onProgress?.({ sourceId, phase: 'movies', current: Math.min(i + BATCH, streams.length), total: streams.length, message: `Movies: ${Math.min(i + BATCH, streams.length)}/${streams.length}` })
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  private async upsertSeries(
    sqlite: ReturnType<typeof getSqlite>,
    sourceId: string,
    seriesList: XtreamSeries[],
    onProgress?: SyncProgressCallback
  ) {
    const insertContent = sqlite.prepare(`
      INSERT OR REPLACE INTO content
        (id, primary_source_id, external_id, type, title, category_id, poster_url, plot, director, cast, rating_tmdb, updated_at)
      VALUES (?, ?, ?, 'series', ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `)
    const insertSource = sqlite.prepare(`
      INSERT OR REPLACE INTO content_sources (id, content_id, source_id, external_id)
      VALUES (?, ?, ?, ?)
    `)
    const updateFts = sqlite.prepare(`
      INSERT OR REPLACE INTO content_fts (content_id, title, plot, cast, director)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertCC = sqlite.prepare(`
      INSERT OR IGNORE INTO content_categories (content_id, category_id)
      VALUES (?, ?)
    `)

    const batch = sqlite.transaction((items: XtreamSeries[]) => {
      for (const series of items) {
        const contentId = `${sourceId}:series:${series.series_id}`
        const contentSourceId = `${sourceId}:series:${series.series_id}`

        insertContent.run(
          contentId, sourceId, String(series.series_id), series.name,
          series.category_id || null, series.cover || null,
          series.plot || null, series.director || null, series.cast || null,
          series.rating_5based ? series.rating_5based * 2 : null
        )
        insertSource.run(contentSourceId, contentId, sourceId, String(series.series_id))
        updateFts.run(contentId, normalize(series.name), normalize(series.plot), normalize(series.cast), normalize(series.director))
        if (series.category_id) {
          insertCC.run(contentId, `${sourceId}:series:${series.category_id}`)
        }
      }
    })

    const BATCH = 500
    for (let i = 0; i < seriesList.length; i += BATCH) {
      batch(seriesList.slice(i, i + BATCH))
      onProgress?.({ sourceId, phase: 'series', current: Math.min(i + BATCH, seriesList.length), total: seriesList.length, message: `Series: ${Math.min(i + BATCH, seriesList.length)}/${seriesList.length}` })
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  buildStreamUrl(serverUrl: string, username: string, password: string, type: 'live' | 'movie' | 'series', streamId: string, extension?: string): string {
    const base = serverUrl.replace(/\/$/, '')
    if (type === 'live') {
      return `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.m3u8`
    }
    if (type === 'series') {
      return `${base}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${extension ?? 'mkv'}`
    }
    return `${base}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${extension ?? 'mkv'}`
  }

  async getSeriesInfo(serverUrl: string, username: string, password: string, seriesId: string): Promise<{
    seasons: Record<string, Array<{
      id: string
      episode_num: number
      title: string
      container_extension: string
      season: number
      plot?: string
      duration?: string
      releaseDate?: string
    }>>
  }> {
    const url = this.buildApiUrl(serverUrl, username, password, 'get_series_info', `&series_id=${seriesId}`)
    const res = await fetch(url)
    const data = await res.json() as any
    const seasons: Record<string, any[]> = {}
    // Xtream episodes: { "1": [...], "2": [...] } keyed by season number
    const rawEpisodes = data?.episodes ?? data?.Episodes ?? {}
    if (rawEpisodes && typeof rawEpisodes === 'object' && !Array.isArray(rawEpisodes)) {
      for (const [season, eps] of Object.entries(rawEpisodes as Record<string, any>)) {
        const epArr = Array.isArray(eps) ? eps : [eps]
        seasons[season] = epArr.map((ep: any) => ({
          id: String(ep.id ?? ep.stream_id ?? ep.episode_id ?? ''),
          episode_num: Number(ep.episode_num ?? ep.episodeNum ?? ep.num ?? 1),
          title: ep.title ?? ep.name ?? `Episode ${ep.episode_num ?? ep.num ?? '?'}`,
          container_extension: ep.container_extension ?? ep.containerExtension ?? 'mkv',
          season: Number(season),
          poster: ep.info?.movie_image ?? ep.cover ?? undefined,
          plot: ep.info?.plot ?? ep.plot ?? undefined,
          duration: ep.info?.duration ?? ep.duration ?? undefined,
          releaseDate: ep.info?.releasedate ?? ep.releaseDate ?? undefined,
        }))
      }
    }
    return { seasons, seriesInfo: data?.info ?? {} }
  }

  buildCatchupUrl(serverUrl: string, username: string, password: string, streamId: string, start: Date, duration: number): string {
    const base = serverUrl.replace(/\/$/, '')
    const startStr = start.toISOString().replace('T', ' ').substring(0, 19)
    return `${base}/timeshift/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${duration}/${encodeURIComponent(startStr)}/${streamId}.ts`
  }
}

export const xtreamService = new XtreamService()
