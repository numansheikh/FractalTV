import { getDb } from '../database/connection'
import { sources } from '../database/schema'
import { randomUUID } from 'crypto'

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
