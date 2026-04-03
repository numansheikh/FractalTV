import { getDb, getSqlite } from '../database/connection'
import { sources, categories, content, contentSources } from '../database/schema'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'

/** Strip diacritics for accent-insensitive FTS indexing. */
function normalize(text: string | null | undefined): string | null {
  if (!text) return null
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
    })

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

      // ── 1. Sync categories ────────────────────────────────────────────────
      onProgress?.({ sourceId, phase: 'categories', current: 0, total: 3, message: 'Fetching categories...' })

      const [liveCats, vodCats, seriesCats] = await Promise.all([
        fetch(`${apiBase}&action=get_live_categories`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()) as Promise<XtreamCategory[]>,
        fetch(`${apiBase}&action=get_vod_categories`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()) as Promise<XtreamCategory[]>,
        fetch(`${apiBase}&action=get_series_categories`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()) as Promise<XtreamCategory[]>,
      ])

      // Insert categories
      const insertCat = sqlite.prepare(`
        INSERT OR REPLACE INTO categories (id, source_id, external_id, name, type)
        VALUES (?, ?, ?, ?, ?)
      `)
      const insertAllCats = sqlite.transaction((cats: XtreamCategory[], type: string) => {
        for (const cat of cats) {
          insertCat.run(`${sourceId}:${type}:${cat.category_id}`, sourceId, cat.category_id, cat.category_name, type)
        }
      })
      insertAllCats(liveCats || [], 'live')
      insertAllCats(vodCats || [], 'movie')
      insertAllCats(seriesCats || [], 'series')

      // ── 2. Sync live streams ──────────────────────────────────────────────
      onProgress?.({ sourceId, phase: 'live', current: 0, total: 0, message: 'Fetching live channels...' })

      const liveStreams = await fetch(`${apiBase}&action=get_live_streams`, { signal: AbortSignal.timeout(60000) })
        .then(r => r.json()) as XtreamLiveStream[]

      onProgress?.({ sourceId, phase: 'live', current: 0, total: liveStreams.length, message: `Importing ${liveStreams.length} channels...` })
      this.upsertLiveStreams(sqlite, sourceId, liveStreams, onProgress)

      // ── 3. Sync VOD ───────────────────────────────────────────────────────
      onProgress?.({ sourceId, phase: 'movies', current: 0, total: 0, message: 'Fetching movies...' })

      const vodStreams = await fetch(`${apiBase}&action=get_vod_streams`, { signal: AbortSignal.timeout(60000) })
        .then(r => r.json()) as XtreamVodStream[]

      onProgress?.({ sourceId, phase: 'movies', current: 0, total: vodStreams.length, message: `Importing ${vodStreams.length} movies...` })
      this.upsertVodStreams(sqlite, sourceId, vodStreams, onProgress)

      // ── 4. Sync series ────────────────────────────────────────────────────
      onProgress?.({ sourceId, phase: 'series', current: 0, total: 0, message: 'Fetching series...' })

      const seriesList = await fetch(`${apiBase}&action=get_series`, { signal: AbortSignal.timeout(60000) })
        .then(r => r.json()) as XtreamSeries[]

      onProgress?.({ sourceId, phase: 'series', current: 0, total: seriesList.length, message: `Importing ${seriesList.length} series...` })
      this.upsertSeries(sqlite, sourceId, seriesList, onProgress)

      // ── Done ──────────────────────────────────────────────────────────────
      const totalItems = (liveStreams?.length ?? 0) + (vodStreams?.length ?? 0) + (seriesList?.length ?? 0)

      await db.update(sources).set({
        status: 'active',
        lastSync: new Date(),
        lastError: null,
        itemCount: totalItems,
      }).where(eq(sources.id, sourceId))

      onProgress?.({ sourceId, phase: 'done', current: totalItems, total: totalItems, message: `Sync complete: ${totalItems} items` })

    } catch (err) {
      await db.update(sources).set({
        status: 'error',
        lastError: String(err),
      }).where(eq(sources.id, sourceId))

      onProgress?.({ sourceId, phase: 'error', current: 0, total: 0, message: String(err) })
      throw err
    }
  }

  private upsertLiveStreams(
    sqlite: ReturnType<typeof getSqlite>,
    sourceId: string,
    streams: XtreamLiveStream[],
    onProgress?: SyncProgressCallback
  ) {
    const insertContent = sqlite.prepare(`
      INSERT OR IGNORE INTO content
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

    const batch = sqlite.transaction((items: XtreamLiveStream[]) => {
      for (const stream of items) {
        const contentId = `live:${stream.stream_id}`
        const contentSourceId = `${sourceId}:live:${stream.stream_id}`

        insertContent.run(
          contentId, sourceId, String(stream.stream_id), stream.name,
          stream.category_id || null, stream.stream_icon || null,
          stream.tv_archive ? 1 : 0, stream.tv_archive_duration || 0
        )
        insertSource.run(contentSourceId, contentId, sourceId, String(stream.stream_id))
        updateFts.run(contentId, normalize(stream.name))
      }
    })

    // Process in batches of 500 for progress reporting
    const BATCH = 500
    for (let i = 0; i < streams.length; i += BATCH) {
      batch(streams.slice(i, i + BATCH))
      onProgress?.({ sourceId, phase: 'live', current: Math.min(i + BATCH, streams.length), total: streams.length, message: `Channels: ${Math.min(i + BATCH, streams.length)}/${streams.length}` })
    }
  }

  private upsertVodStreams(
    sqlite: ReturnType<typeof getSqlite>,
    sourceId: string,
    streams: XtreamVodStream[],
    onProgress?: SyncProgressCallback
  ) {
    const insertContent = sqlite.prepare(`
      INSERT OR IGNORE INTO content
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

    const batch = sqlite.transaction((items: XtreamVodStream[]) => {
      for (const stream of items) {
        const contentId = `movie:${stream.stream_id}`
        const contentSourceId = `${sourceId}:movie:${stream.stream_id}`

        insertContent.run(
          contentId, sourceId, String(stream.stream_id), stream.name,
          stream.category_id || null, stream.stream_icon || null,
          stream.rating_5based ? stream.rating_5based * 2 : null, // convert 5-based to 10-based
          stream.container_extension || null
        )
        insertSource.run(contentSourceId, contentId, sourceId, String(stream.stream_id))
        updateFts.run(contentId, normalize(stream.name))
      }
    })

    const BATCH = 500
    for (let i = 0; i < streams.length; i += BATCH) {
      batch(streams.slice(i, i + BATCH))
      onProgress?.({ sourceId, phase: 'movies', current: Math.min(i + BATCH, streams.length), total: streams.length, message: `Movies: ${Math.min(i + BATCH, streams.length)}/${streams.length}` })
    }
  }

  private upsertSeries(
    sqlite: ReturnType<typeof getSqlite>,
    sourceId: string,
    seriesList: XtreamSeries[],
    onProgress?: SyncProgressCallback
  ) {
    const insertContent = sqlite.prepare(`
      INSERT OR IGNORE INTO content
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

    const batch = sqlite.transaction((items: XtreamSeries[]) => {
      for (const series of items) {
        const contentId = `series:${series.series_id}`
        const contentSourceId = `${sourceId}:series:${series.series_id}`

        insertContent.run(
          contentId, sourceId, String(series.series_id), series.name,
          series.category_id || null, series.cover || null,
          series.plot || null, series.director || null, series.cast || null,
          series.rating_5based ? series.rating_5based * 2 : null
        )
        insertSource.run(contentSourceId, contentId, sourceId, String(series.series_id))
        updateFts.run(contentId, normalize(series.name), normalize(series.plot), normalize(series.cast), normalize(series.director))
      }
    })

    const BATCH = 500
    for (let i = 0; i < seriesList.length; i += BATCH) {
      batch(seriesList.slice(i, i + BATCH))
      onProgress?.({ sourceId, phase: 'series', current: Math.min(i + BATCH, seriesList.length), total: seriesList.length, message: `Series: ${Math.min(i + BATCH, seriesList.length)}/${seriesList.length}` })
    }
  }

  buildStreamUrl(serverUrl: string, username: string, password: string, type: 'live' | 'movie', streamId: string, extension?: string): string {
    const base = serverUrl.replace(/\/$/, '')
    if (type === 'live') {
      return `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.m3u8`
    }
    return `${base}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${extension ?? 'mkv'}`
  }

  buildCatchupUrl(serverUrl: string, username: string, password: string, streamId: string, start: Date, duration: number): string {
    const base = serverUrl.replace(/\/$/, '')
    const startStr = start.toISOString().replace('T', ' ').substring(0, 19)
    return `${base}/timeshift/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${duration}/${encodeURIComponent(startStr)}/${streamId}.ts`
  }
}

export const xtreamService = new XtreamService()
