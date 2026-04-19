/**
 * Export worker — g3.
 *
 * Resolves a user's tree selection into a concrete list of playable entries,
 * prefetches `get_series_info` for un-opened series in the selection, then
 * writes a single .m3u file to `outputPath`.
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { writeFileSync } from 'fs'
import { generateM3u, M3uEntry } from '../lib/m3u-writer'

interface ResolvedSelection {
  favoritesChannels: boolean
  favoritesMovies: boolean
  favoritesSeries: boolean
  channelCategoryIds: Array<{ sourceId: string; categoryId: string }>
  movieCategoryIds: Array<{ sourceId: string; categoryId: string }>
  seriesCategoryIds: Array<{ sourceId: string; categoryId: string }>
}

interface WorkerData {
  dbPath: string
  selection: ResolvedSelection
  outputPath: string
  profileId: string
}

const { dbPath, selection, outputPath, profileId } = workerData as WorkerData

function send(phase: string, current: number, total: number, message: string) {
  parentPort?.postMessage({ type: 'progress', phase, current, total, message })
}
function sendError(message: string) {
  parentPort?.postMessage({ type: 'error', message })
}
function sendDone(filePath: string, entryCount: number) {
  parentPort?.postMessage({ type: 'done', filePath, entryCount })
}

interface SourceRow {
  id: string
  type: 'xtream' | 'm3u'
  server_url: string | null
  username: string | null
  password: string | null
  name: string
}

function buildXtreamUrl(
  serverUrl: string, username: string, password: string,
  type: 'live' | 'movie' | 'series', streamId: string, extension?: string
): string {
  const base = serverUrl.replace(/\/$/, '')
  if (type === 'live') {
    return `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.m3u8`
  }
  if (type === 'series') {
    return `${base}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${extension ?? 'mkv'}`
  }
  return `${base}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${extension ?? 'mkv'}`
}

async function fetchSeriesInfo(
  serverUrl: string, username: string, password: string, seriesExternalId: string
): Promise<Array<{ externalId: string; season: number; episodeNum: number; title: string; ext: string }>> {
  const base = serverUrl.replace(/\/$/, '')
  const url = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series_info&series_id=${seriesExternalId}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    const data = await res.json() as any
    const rawEpisodes = data?.episodes ?? data?.Episodes ?? {}
    const out: Array<{ externalId: string; season: number; episodeNum: number; title: string; ext: string }> = []
    if (rawEpisodes && typeof rawEpisodes === 'object' && !Array.isArray(rawEpisodes)) {
      for (const [seasonKey, eps] of Object.entries(rawEpisodes as Record<string, any>)) {
        const epArr = Array.isArray(eps) ? eps : [eps]
        for (const ep of epArr) {
          out.push({
            externalId: String(ep.id ?? ep.stream_id ?? ep.episode_id ?? ''),
            season: Number(seasonKey),
            episodeNum: Number(ep.episode_num ?? ep.episodeNum ?? ep.num ?? 1),
            title: ep.title ?? ep.name ?? `Episode ${ep.episode_num ?? '?'}`,
            ext: ep.container_extension ?? ep.containerExtension ?? 'mkv',
          })
        }
      }
    }
    return out
  } finally {
    clearTimeout(timeoutId)
  }
}

async function run() {
  const db = new Database(dbPath, { readonly: false })
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  try {
    send('resolving', 0, 0, 'Collecting content…')

    const addedIds = new Set<string>()
    const entries: M3uEntry[] = []

    const sourceRows = db.prepare(`SELECT id, type, server_url, username, password, name FROM sources WHERE disabled = 0`).all() as SourceRow[]
    const sourceById = new Map(sourceRows.map((s) => [s.id, s]))

    // ── Channels from category selections ─────────────────────────────
    const channelSql = db.prepare(`
      SELECT c.id, c.title, c.external_id, c.stream_url, c.thumbnail_url, c.tvg_id,
             cc.name AS category_name, c.source_id
      FROM channels c
      LEFT JOIN channel_categories cc ON cc.id = c.category_id
      WHERE c.category_id = ?
    `)
    for (const { sourceId, categoryId } of selection.channelCategoryIds) {
      const src = sourceById.get(sourceId)
      if (!src) continue
      const rows = channelSql.all(categoryId) as any[]
      for (const r of rows) {
        if (addedIds.has(r.id)) continue
        const url = r.stream_url ?? (src.type === 'xtream' && src.server_url && src.username && src.password
          ? buildXtreamUrl(src.server_url, src.username, src.password, 'live', r.external_id)
          : null)
        if (!url) continue
        addedIds.add(r.id)
        entries.push({
          title: r.title,
          url,
          tvgId: r.tvg_id,
          tvgLogo: r.thumbnail_url,
          groupTitle: r.category_name ?? 'Channels',
        })
      }
    }

    // ── Movies from category selections ───────────────────────────────
    const movieSql = db.prepare(`
      SELECT m.id, m.title, m.external_id, m.stream_url, m.thumbnail_url, m.container_extension,
             mc.name AS category_name, m.source_id
      FROM movies m
      LEFT JOIN movie_categories mc ON mc.id = m.category_id
      WHERE m.category_id = ?
    `)
    for (const { sourceId, categoryId } of selection.movieCategoryIds) {
      const src = sourceById.get(sourceId)
      if (!src) continue
      const rows = movieSql.all(categoryId) as any[]
      for (const r of rows) {
        if (addedIds.has(r.id)) continue
        const url = r.stream_url ?? (src.type === 'xtream' && src.server_url && src.username && src.password
          ? buildXtreamUrl(src.server_url, src.username, src.password, 'movie', r.external_id, r.container_extension)
          : null)
        if (!url) continue
        addedIds.add(r.id)
        entries.push({
          title: r.title,
          url,
          tvgLogo: r.thumbnail_url,
          groupTitle: r.category_name ?? 'Movies',
        })
      }
    }

    // ── Series from category selections (+ prefetch episodes) ─────────
    const seriesSql = db.prepare(`
      SELECT s.id, s.title, s.external_id, s.source_id, s.thumbnail_url,
             sc.name AS category_name
      FROM series s
      LEFT JOIN series_categories sc ON sc.id = s.category_id
      WHERE s.category_id = ?
    `)
    const episodesSql = db.prepare(`
      SELECT id, external_id, title, stream_url, container_extension, season, episode_num
      FROM episodes WHERE series_id = ? ORDER BY season, episode_num
    `)
    const insertEpisode = db.prepare(`
      INSERT OR IGNORE INTO episodes (id, series_id, external_id, title, stream_url, container_extension, season, episode_num)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const allSeriesRows: Array<{ series: any; src: SourceRow }> = []
    for (const { sourceId, categoryId } of selection.seriesCategoryIds) {
      const src = sourceById.get(sourceId)
      if (!src) continue
      const rows = seriesSql.all(categoryId) as any[]
      for (const r of rows) allSeriesRows.push({ series: r, src })
    }

    const seriesToPrefetch = allSeriesRows.filter(({ series }) => {
      const eps = episodesSql.all(series.id) as any[]
      return eps.length === 0
    })

    if (seriesToPrefetch.length > 0) {
      send('fetching_series', 0, seriesToPrefetch.length, `Fetching episodes for ${seriesToPrefetch.length} series…`)
      let done = 0
      const CONCURRENCY = 4
      for (let i = 0; i < seriesToPrefetch.length; i += CONCURRENCY) {
        const batch = seriesToPrefetch.slice(i, i + CONCURRENCY)
        await Promise.all(batch.map(async ({ series, src }) => {
          if (src.type !== 'xtream' || !src.server_url || !src.username || !src.password) return
          try {
            const eps = await fetchSeriesInfo(src.server_url, src.username, src.password, series.external_id)
            const tx = db.transaction(() => {
              for (const ep of eps) {
                if (!ep.externalId) continue
                insertEpisode.run(
                  `${src.id}:episode:${ep.externalId}`,
                  series.id,
                  ep.externalId,
                  ep.title,
                  null,
                  ep.ext,
                  ep.season,
                  ep.episodeNum
                )
              }
            })
            tx()
          } catch (err) {
            console.warn(`[export] Failed to fetch series ${series.id}:`, err)
          }
          done++
          send('fetching_series', done, seriesToPrefetch.length, `Fetched ${done}/${seriesToPrefetch.length}`)
        }))
      }
    }

    // Now emit episodes for every series in selection
    for (const { series, src } of allSeriesRows) {
      const eps = episodesSql.all(series.id) as any[]
      for (const ep of eps) {
        if (addedIds.has(ep.id)) continue
        const url = ep.stream_url ?? (src.type === 'xtream' && src.server_url && src.username && src.password
          ? buildXtreamUrl(src.server_url, src.username, src.password, 'series', ep.external_id, ep.container_extension)
          : null)
        if (!url) continue
        addedIds.add(ep.id)
        const seasonStr = ep.season ? `S${String(ep.season).padStart(2, '0')}` : ''
        const epStr = ep.episode_num ? `E${String(ep.episode_num).padStart(2, '0')}` : ''
        const label = [seasonStr + epStr, ep.title].filter(Boolean).join(' · ')
        entries.push({
          title: `${series.title} - ${label || ep.title}`,
          url,
          tvgLogo: series.thumbnail_url,
          groupTitle: series.title,
        })
      }
    }

    // ── Favorites (aggregated across sources) ─────────────────────────
    if (selection.favoritesChannels) {
      const rows = db.prepare(`
        SELECT c.id, c.title, c.external_id, c.stream_url, c.thumbnail_url, c.tvg_id,
               cc.name AS category_name, c.source_id
        FROM channels c
        LEFT JOIN channel_categories cc ON cc.id = c.category_id
        JOIN channel_user_data cud ON cud.channel_id = c.id AND cud.profile_id = ? AND cud.is_favorite = 1
      `).all(profileId) as any[]
      for (const r of rows) {
        if (addedIds.has(r.id)) continue
        const src = sourceById.get(r.source_id)
        if (!src) continue
        const url = r.stream_url ?? (src.type === 'xtream' && src.server_url && src.username && src.password
          ? buildXtreamUrl(src.server_url, src.username, src.password, 'live', r.external_id)
          : null)
        if (!url) continue
        addedIds.add(r.id)
        entries.push({
          title: r.title,
          url,
          tvgId: r.tvg_id,
          tvgLogo: r.thumbnail_url,
          groupTitle: `${r.category_name ?? 'Channels'} (Favorites)`,
        })
      }
    }

    if (selection.favoritesMovies) {
      const rows = db.prepare(`
        SELECT m.id, m.title, m.external_id, m.stream_url, m.thumbnail_url, m.container_extension,
               mc.name AS category_name, m.source_id
        FROM movies m
        LEFT JOIN movie_categories mc ON mc.id = m.category_id
        JOIN movie_user_data mud ON mud.movie_id = m.id AND mud.profile_id = ? AND mud.is_favorite = 1
      `).all(profileId) as any[]
      for (const r of rows) {
        if (addedIds.has(r.id)) continue
        const src = sourceById.get(r.source_id)
        if (!src) continue
        const url = r.stream_url ?? (src.type === 'xtream' && src.server_url && src.username && src.password
          ? buildXtreamUrl(src.server_url, src.username, src.password, 'movie', r.external_id, r.container_extension)
          : null)
        if (!url) continue
        addedIds.add(r.id)
        entries.push({
          title: r.title,
          url,
          tvgLogo: r.thumbnail_url,
          groupTitle: `${r.category_name ?? 'Movies'} (Favorites)`,
        })
      }
    }

    if (selection.favoritesSeries) {
      const favSeries = db.prepare(`
        SELECT s.id, s.title, s.external_id, s.source_id, s.thumbnail_url
        FROM series s
        JOIN series_user_data sud ON sud.series_id = s.id AND sud.profile_id = ? AND sud.is_favorite = 1
      `).all(profileId) as any[]

      const seriesNeedingFetch = favSeries.filter((s) => {
        const eps = episodesSql.all(s.id) as any[]
        return eps.length === 0
      })

      if (seriesNeedingFetch.length > 0) {
        send('fetching_series', 0, seriesNeedingFetch.length, `Fetching episodes for ${seriesNeedingFetch.length} favorite series…`)
        let done = 0
        const CONCURRENCY = 4
        for (let i = 0; i < seriesNeedingFetch.length; i += CONCURRENCY) {
          const batch = seriesNeedingFetch.slice(i, i + CONCURRENCY)
          await Promise.all(batch.map(async (series) => {
            const src = sourceById.get(series.source_id)
            if (!src || src.type !== 'xtream' || !src.server_url || !src.username || !src.password) return
            try {
              const eps = await fetchSeriesInfo(src.server_url, src.username, src.password, series.external_id)
              const tx = db.transaction(() => {
                for (const ep of eps) {
                  if (!ep.externalId) continue
                  insertEpisode.run(
                    `${src.id}:episode:${ep.externalId}`,
                    series.id,
                    ep.externalId,
                    ep.title,
                    null,
                    ep.ext,
                    ep.season,
                    ep.episodeNum
                  )
                }
              })
              tx()
            } catch (err) {
              console.warn(`[export] Failed to fetch fav series ${series.id}:`, err)
            }
            done++
            send('fetching_series', done, seriesNeedingFetch.length, `Fetched ${done}/${seriesNeedingFetch.length}`)
          }))
        }
      }

      for (const series of favSeries) {
        const src = sourceById.get(series.source_id)
        if (!src) continue
        const eps = episodesSql.all(series.id) as any[]
        for (const ep of eps) {
          if (addedIds.has(ep.id)) continue
          const url = ep.stream_url ?? (src.type === 'xtream' && src.server_url && src.username && src.password
            ? buildXtreamUrl(src.server_url, src.username, src.password, 'series', ep.external_id, ep.container_extension)
            : null)
          if (!url) continue
          addedIds.add(ep.id)
          const seasonStr = ep.season ? `S${String(ep.season).padStart(2, '0')}` : ''
          const epStr = ep.episode_num ? `E${String(ep.episode_num).padStart(2, '0')}` : ''
          const label = [seasonStr + epStr, ep.title].filter(Boolean).join(' · ')
          entries.push({
            title: `${series.title} - ${label || ep.title}`,
            url,
            tvgLogo: series.thumbnail_url,
            groupTitle: `${series.title} (Favorites)`,
          })
        }
      }
    }

    send('writing', entries.length, entries.length, `Writing ${entries.length} entries…`)
    const content = generateM3u(entries)
    writeFileSync(outputPath, content, 'utf-8')
    sendDone(outputPath, entries.length)
  } catch (err: any) {
    sendError(err?.message ?? String(err))
  } finally {
    db.close()
  }
}

run().catch((err) => sendError(err?.message ?? String(err)))
