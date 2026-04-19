// ─── Content handlers ─────────────────────────────────────────────────────────
// Covers: content:get, content:get-stream-url, content:get-vod-info,
//         series:get-info, content:browse,
//         user:get-data, user:set-position, user:toggle-favorite,
//         user:toggle-watchlist, user:favorites, user:reorder-favorites,
//         user:watchlist, user:continue-watching, user:history, user:bulk-get-data,
//         user:set-completed, user:set-rating, user:clear-continue,
//         user:clear-item-history, user:clear-history, user:clear-favorites,
//         user:clear-all-data,
//         channels:favorites, channels:toggle-favorite, channels:reorder-favorites,
//         channels:get-data, channels:siblings

import { ipcMain } from 'electron'
import { getDb, getSqlite } from '../../database/connection'
import { sources } from '../../database/schema'
import { eq } from 'drizzle-orm'
import { xtreamService } from '../../services/xtream.service'
import {
  CHANNEL_SELECT, MOVIE_SELECT, SERIES_SELECT,
  ChannelRow, MovieRow, SeriesRow, EpisodeRow,
  DEFAULT_PROFILE,
  idKind,
  getEnabledSourceIds,
  readUserData, bulkReadUserData,
  toggleFavorite, toggleWatchlist,
  listFavorites, listWatchlist, listContinueWatching, listHistory,
  runBrowseSearch,
} from './shared'

export function registerContentHandlers(ipcMain_: typeof ipcMain): void {
  // ── Content ─────────────────────────────────────────────────────────────
  ipcMain_.handle('content:get', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const kind = idKind(contentId)

    if (kind === 'channel') {
      return sqlite.prepare(`
        SELECT ${CHANNEL_SELECT}, cat.name AS category_name,
          ic.name            AS io_name,
          ic.alt_names       AS io_alt_names,
          ic.network         AS io_network,
          ic.owners          AS io_owners,
          ic.country         AS io_country,
          ic.country_name    AS io_country_name,
          ic.country_flag    AS io_country_flag,
          ic.category_labels AS io_category_labels,
          ic.is_nsfw         AS io_is_nsfw,
          ic.is_blocked      AS io_is_blocked,
          ic.launched        AS io_launched,
          ic.closed          AS io_closed,
          ic.replaced_by     AS io_replaced_by,
          ic.website         AS io_website,
          ic.logo_url        AS io_logo_url
        FROM channels c
        LEFT JOIN channel_categories cat ON cat.id = c.category_id
        LEFT JOIN iptv_channels ic ON ic.id = c.iptv_org_id
        WHERE c.id = ?
      `).get(contentId) ?? null
    }
    if (kind === 'movie') {
      return sqlite.prepare(`
        SELECT ${MOVIE_SELECT}, cat.name AS category_name
        FROM movies m
        LEFT JOIN movie_categories cat ON cat.id = m.category_id
        WHERE m.id = ?
      `).get(contentId) ?? null
    }
    if (kind === 'series') {
      return sqlite.prepare(`
        SELECT ${SERIES_SELECT}, cat.name AS category_name
        FROM series sr
        LEFT JOIN series_categories cat ON cat.id = sr.category_id
        WHERE sr.id = ?
      `).get(contentId) ?? null
    }
    if (kind === 'episode') {
      // Return a minimal episode record. Callers typically want series info.
      return sqlite.prepare(`SELECT * FROM episodes WHERE id = ?`).get(contentId) ?? null
    }
    return null
  })

  ipcMain_.handle('content:get-stream-url', async (_event, args: { contentId: string; sourceId?: string }) => {
    const db = getDb()
    const sqlite = getSqlite()
    const kind = idKind(args.contentId)
    if (!kind) return { error: 'Invalid content ID' }

    let sourceIdFromRow: string | null = null
    let externalId: string | null = null
    let containerExtension: string | null = null
    let directStreamUrl: string | null = null
    let providerMeta: string | null = null
    let xtreamType: 'live' | 'movie' | 'series' = 'movie'

    if (kind === 'channel') {
      const ch = sqlite.prepare('SELECT * FROM channels WHERE id = ?').get(args.contentId) as ChannelRow | undefined
      if (!ch) return { error: 'Content not found' }
      sourceIdFromRow = ch.source_id
      externalId = ch.external_id
      directStreamUrl = ch.stream_url ?? null
      providerMeta = ch.provider_metadata ?? null
      xtreamType = 'live'
    } else if (kind === 'movie') {
      const m = sqlite.prepare('SELECT * FROM movies WHERE id = ?').get(args.contentId) as MovieRow | undefined
      if (!m) return { error: 'Content not found' }
      sourceIdFromRow = m.source_id
      externalId = m.external_id
      containerExtension = m.container_extension ?? null
      directStreamUrl = m.stream_url ?? null
      providerMeta = m.provider_metadata ?? null
      xtreamType = 'movie'
    } else if (kind === 'episode') {
      const ep = sqlite.prepare('SELECT * FROM episodes WHERE id = ?').get(args.contentId) as EpisodeRow | undefined
      if (!ep) return { error: 'Content not found' }
      // Episodes link to series, which owns source_id + provider_metadata (headers).
      const ser = sqlite.prepare('SELECT source_id, provider_metadata FROM series WHERE id = ?').get(ep.series_id) as { source_id: string; provider_metadata?: string } | undefined
      if (!ser) return { error: 'Parent series not found' }
      sourceIdFromRow = ser.source_id
      externalId = ep.external_id
      containerExtension = ep.container_extension ?? null
      directStreamUrl = ep.stream_url ?? null
      providerMeta = ser.provider_metadata ?? null
      xtreamType = 'series'
    } else {
      return { error: 'Series parents are not playable' }
    }

    const sourceId = args.sourceId ?? sourceIdFromRow!
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId))
    if (!source) return { error: 'No stream source found' }

    // M3U sources: stream_url is stored directly on the content row.
    if (source.type === 'm3u') {
      if (!directStreamUrl) return { error: 'Stream URL missing for M3U content' }
      // Include HTTP headers from provider_metadata if present
      let headers: Record<string, string> | undefined
      if (providerMeta) {
        try { headers = JSON.parse(providerMeta).httpHeaders } catch {}
      }
      return { url: directStreamUrl, sourceId: source.id, ...(headers && { headers }) }
    }

    if (!source.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    const url = xtreamService.buildStreamUrl(
      source.serverUrl, source.username, source.password,
      xtreamType, externalId!, containerExtension ?? undefined
    )
    return { url, sourceId: source.id }
  })

  // series:get-info — lazy-fetches season/episode list from Xtream and
  // persists episodes into the episodes table with FK series_id.
  // M3U sources: episodes are already in DB from sync — returns them directly.
  ipcMain_.handle('series:get-info', async (_event, args: { contentId: string }) => {
    const db = getDb()
    const sqlite = getSqlite()

    const seriesRow = sqlite.prepare('SELECT * FROM series WHERE id = ?').get(args.contentId) as SeriesRow | undefined
    if (!seriesRow) return { error: 'Content not found' }

    const [source] = await db.select().from(sources).where(eq(sources.id, seriesRow.source_id))
    if (!source) return { error: 'Source not found' }

    // M3U: episodes pre-populated at sync — group by season and return
    if (source.type === 'm3u') {
      const eps = sqlite.prepare(
        'SELECT * FROM episodes WHERE series_id = ? ORDER BY season, episode_num'
      ).all(seriesRow.id) as Array<{
        id: string; external_id: string; title: string; stream_url: string;
        container_extension: string | null; season: number; episode_num: number;
      }>

      const seasons: Record<string, any[]> = {}
      for (const ep of eps) {
        const sKey = String(ep.season ?? 1)
        if (!seasons[sKey]) seasons[sKey] = []
        seasons[sKey].push({
          id: ep.external_id,
          title: ep.title,
          season: ep.season,
          episode_num: ep.episode_num,
          container_extension: ep.container_extension,
          stream_url: ep.stream_url,
        })
      }

      return { seasons, sourceId: source.id }
    }

    if (!source.serverUrl || !source.username || !source.password) return { error: 'Source credentials missing' }

    try {
      const info = await xtreamService.getSeriesInfo(source.serverUrl, source.username, source.password, seriesRow.external_id)

      const upsertEpisode = sqlite.prepare(`
        INSERT INTO episodes (
          id, series_id, external_id, title,
          container_extension, season, episode_num
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          container_extension = excluded.container_extension,
          season = excluded.season,
          episode_num = excluded.episode_num
      `)

      const tx = sqlite.transaction((seasons: Record<string, any[]>) => {
        for (const [, eps] of Object.entries(seasons)) {
          for (const ep of eps) {
            const season  = Number(ep.season ?? ep.season_number ?? 0)
            const epNum   = Number(ep.episode_num ?? ep.episode ?? 0)
            const epTitle = ep.title ?? `S${season}E${epNum}`
            const epId = `${source.id}:episode:${ep.id}`

            upsertEpisode.run(
              epId, seriesRow.id, String(ep.id), epTitle,
              ep.container_extension ?? 'mkv', season, epNum
            )
          }
        }
      })
      tx(info.seasons ?? {})

      return { ...info, sourceId: source.id, serverUrl: source.serverUrl, username: source.username, password: source.password }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain_.handle('content:get-vod-info', async (_event, args: { contentId: string }) => {
    const db = getDb()
    const sqlite = getSqlite()

    const movieRow = sqlite.prepare('SELECT * FROM movies WHERE id = ?').get(args.contentId) as MovieRow | undefined
    if (!movieRow) return { runtime: null }

    // Return cached value if already persisted
    if (movieRow.md_runtime != null) return { runtime: movieRow.md_runtime }

    const [source] = await db.select().from(sources).where(eq(sources.id, movieRow.source_id))
    if (!source?.serverUrl || !source.username || !source.password) return { runtime: null }

    const result = await xtreamService.getVodInfo(source.serverUrl, source.username, source.password, movieRow.external_id)
    if (result.runtime != null) {
      sqlite.prepare('UPDATE movies SET md_runtime = ? WHERE id = ?').run(result.runtime, args.contentId)
    }
    return result
  })

  // ── User data ──────────────────────────────────────────────────────────
  // Routing by kind:
  //   channel → channel_user_data  (favorite only — live channels don't track position)
  //   movie   → movie_user_data    (favorite/watchlist/rating/position)
  //   series  → series_user_data   (favorite/watchlist/rating — episode positions are per-episode)
  //   episode → episode_user_data  (position/completed) + parent series_user_data for fav/wl

  ipcMain_.handle('user:get-data', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    return readUserData(sqlite, contentId)
  })

  ipcMain_.handle('user:set-position', async (_event, args: { contentId: string; position: number }) => {
    const sqlite = getSqlite()
    const kind = idKind(args.contentId)
    if (kind === 'movie') {
      sqlite.prepare(`
        INSERT INTO movie_user_data (profile_id, movie_id, watch_position, last_watched_at)
        VALUES (?, ?, ?, unixepoch())
        ON CONFLICT(profile_id, movie_id) DO UPDATE SET
          watch_position  = excluded.watch_position,
          last_watched_at = excluded.last_watched_at,
          completed       = 0
      `).run(DEFAULT_PROFILE, args.contentId, args.position)
      return { success: true }
    }
    if (kind === 'episode') {
      sqlite.prepare(`
        INSERT INTO episode_user_data (profile_id, episode_id, watch_position, last_watched_at)
        VALUES (?, ?, ?, unixepoch())
        ON CONFLICT(profile_id, episode_id) DO UPDATE SET
          watch_position  = excluded.watch_position,
          last_watched_at = excluded.last_watched_at,
          completed       = 0
      `).run(DEFAULT_PROFILE, args.contentId, args.position)
      return { success: true }
    }
    // channel/series: no meaningful position state (channels are live, series
    // is a parent not itself playable).
    return { success: false }
  })

  ipcMain_.handle('user:toggle-favorite', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    return { favorite: toggleFavorite(sqlite, contentId) }
  })

  ipcMain_.handle('user:toggle-watchlist', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    return { watchlist: toggleWatchlist(sqlite, contentId) }
  })

  ipcMain_.handle('user:favorites', async (_event, args?: { type?: 'live' | 'movie' | 'series' }) => {
    const sqlite = getSqlite()
    return listFavorites(sqlite, args?.type)
  })

  ipcMain_.handle('user:reorder-favorites', async (_event, order: { contentId: string; sortOrder: number }[]) => {
    const sqlite = getSqlite()
    const updCh = sqlite.prepare(`UPDATE channel_user_data SET fav_sort_order = ? WHERE profile_id = ? AND channel_id = ?`)
    const updMv = sqlite.prepare(`UPDATE movie_user_data   SET fav_sort_order = ? WHERE profile_id = ? AND movie_id = ?`)
    const updSr = sqlite.prepare(`UPDATE series_user_data  SET fav_sort_order = ? WHERE profile_id = ? AND series_id = ?`)
    const runAll = sqlite.transaction((items: typeof order) => {
      for (const { contentId, sortOrder } of items) {
        const kind = idKind(contentId)
        if (kind === 'channel') updCh.run(sortOrder, DEFAULT_PROFILE, contentId)
        else if (kind === 'movie')  updMv.run(sortOrder, DEFAULT_PROFILE, contentId)
        else if (kind === 'series') updSr.run(sortOrder, DEFAULT_PROFILE, contentId)
      }
    })
    runAll(order)
    return { ok: true }
  })

  // ── Channels (live-specific user data) ──────────────────────────────
  ipcMain_.handle('channels:favorites', async (_event, args?: { profileId?: string }) => {
    const sqlite = getSqlite()
    const profileId = args?.profileId ?? DEFAULT_PROFILE
    return sqlite.prepare(`
      SELECT ${CHANNEL_SELECT},
        cud.fav_sort_order                    AS fav_sort_order,
        NULL                                  AS last_watched_at,
        1                                      AS favorite
      FROM channel_user_data cud
      JOIN channels c ON c.id = cud.channel_id
      JOIN sources src ON src.id = c.source_id AND src.disabled = 0
      WHERE cud.is_favorite = 1 AND cud.profile_id = ?
      ORDER BY COALESCE(cud.fav_sort_order, 999999) ASC
    `).all(profileId)
  })

  ipcMain_.handle('channels:toggle-favorite', async (_event, channelId: string) => {
    const sqlite = getSqlite()
    const row = sqlite.prepare('SELECT id FROM channels WHERE id = ?').get(channelId) as { id?: string } | undefined
    if (!row?.id) return { favorite: false }
    sqlite.prepare(`
      INSERT INTO channel_user_data (profile_id, channel_id, is_favorite)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, channel_id) DO UPDATE SET is_favorite = NOT is_favorite
    `).run(DEFAULT_PROFILE, row.id)
    const r = sqlite.prepare(`SELECT is_favorite FROM channel_user_data WHERE profile_id = ? AND channel_id = ?`).get(DEFAULT_PROFILE, row.id) as { is_favorite?: number } | undefined
    return { favorite: !!r?.is_favorite }
  })

  ipcMain_.handle('channels:reorder-favorites', async (_event, order: { canonicalId: string; sortOrder: number }[]) => {
    const sqlite = getSqlite()
    const update = sqlite.prepare(`UPDATE channel_user_data SET fav_sort_order = ? WHERE profile_id = ? AND channel_id = ?`)
    const runAll = sqlite.transaction((items: typeof order) => {
      for (const { canonicalId, sortOrder } of items) update.run(sortOrder, DEFAULT_PROFILE, canonicalId)
    })
    runAll(order)
    return { ok: true }
  })

  ipcMain_.handle('channels:get-data', async (_event, channelId: string) => {
    const sqlite = getSqlite()
    const fav = sqlite.prepare(`SELECT is_favorite FROM channel_user_data WHERE profile_id = ? AND channel_id = ?`).get(DEFAULT_PROFILE, channelId) as { is_favorite?: number } | undefined
    return {
      favorite:    !!fav?.is_favorite,
      watchlisted: false,
      rating:      null,
      position:    0,
      completed:   false,
    }
  })

  ipcMain_.handle('channels:siblings', async (_event, channelId: string) => {
    const sqlite = getSqlite()
    const ch = sqlite.prepare('SELECT iptv_org_id FROM channels WHERE id = ?').get(channelId) as { iptv_org_id?: string | null } | undefined
    if (!ch?.iptv_org_id) return []
    return sqlite.prepare(`
      SELECT c.id, c.title, c.source_id
      FROM channels c
      WHERE c.iptv_org_id = ? AND c.id != ?
      LIMIT 10
    `).all(ch.iptv_org_id, channelId)
  })

  ipcMain_.handle('user:watchlist', async (_event, args?: { type?: 'live' | 'movie' | 'series' }) => {
    const sqlite = getSqlite()
    return listWatchlist(sqlite, args?.type)
  })

  ipcMain_.handle('user:continue-watching', async (_event, args?: { type?: 'movie' | 'series' }) => {
    const sqlite = getSqlite()
    return listContinueWatching(sqlite, args?.type)
  })

  ipcMain_.handle('user:history', async (_event, args?: { limit?: number }) => {
    const sqlite = getSqlite()
    return listHistory(sqlite, args?.limit ?? 50)
  })

  ipcMain_.handle('user:bulk-get-data', async (_event, contentIds: string[]) => {
    const sqlite = getSqlite()
    if (!contentIds.length) return {}
    return bulkReadUserData(sqlite, contentIds)
  })

  ipcMain_.handle('user:set-completed', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const kind = idKind(contentId)
    if (kind === 'movie') {
      sqlite.prepare(`
        INSERT INTO movie_user_data (profile_id, movie_id, completed, watch_position, last_watched_at)
        VALUES (?, ?, 1, 0, unixepoch())
        ON CONFLICT(profile_id, movie_id) DO UPDATE SET
          completed = 1, watch_position = 0, last_watched_at = unixepoch()
      `).run(DEFAULT_PROFILE, contentId)
      return { success: true }
    }
    if (kind === 'episode') {
      sqlite.prepare(`
        INSERT INTO episode_user_data (profile_id, episode_id, completed, watch_position, last_watched_at)
        VALUES (?, ?, 1, 0, unixepoch())
        ON CONFLICT(profile_id, episode_id) DO UPDATE SET
          completed = 1, watch_position = 0, last_watched_at = unixepoch()
      `).run(DEFAULT_PROFILE, contentId)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain_.handle('user:set-rating', async (_event, args: { contentId: string; rating: number | null }) => {
    const sqlite = getSqlite()
    const kind = idKind(args.contentId)
    if (kind === 'movie') {
      sqlite.prepare(`
        INSERT INTO movie_user_data (profile_id, movie_id, rating)
        VALUES (?, ?, ?)
        ON CONFLICT(profile_id, movie_id) DO UPDATE SET rating = excluded.rating
      `).run(DEFAULT_PROFILE, args.contentId, args.rating)
      return { success: true }
    }
    if (kind === 'series') {
      sqlite.prepare(`
        INSERT INTO series_user_data (profile_id, series_id, rating)
        VALUES (?, ?, ?)
        ON CONFLICT(profile_id, series_id) DO UPDATE SET rating = excluded.rating
      `).run(DEFAULT_PROFILE, args.contentId, args.rating)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain_.handle('user:clear-continue', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const kind = idKind(contentId)
    if (kind === 'movie') {
      sqlite.prepare(`
        UPDATE movie_user_data SET watch_position = 0, completed = 1
        WHERE profile_id = ? AND movie_id = ?
      `).run(DEFAULT_PROFILE, contentId)
      return { success: true }
    }
    if (kind === 'episode') {
      sqlite.prepare(`
        UPDATE episode_user_data SET watch_position = 0, completed = 1
        WHERE profile_id = ? AND episode_id = ?
      `).run(DEFAULT_PROFILE, contentId)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain_.handle('user:clear-item-history', async (_event, contentId: string) => {
    const sqlite = getSqlite()
    const kind = idKind(contentId)
    if (kind === 'movie') {
      sqlite.prepare(`
        UPDATE movie_user_data SET watch_position = 0, last_watched_at = NULL, completed = 0
        WHERE profile_id = ? AND movie_id = ?
      `).run(DEFAULT_PROFILE, contentId)
      return { success: true }
    }
    if (kind === 'episode') {
      sqlite.prepare(`
        UPDATE episode_user_data SET watch_position = 0, last_watched_at = NULL, completed = 0
        WHERE profile_id = ? AND episode_id = ?
      `).run(DEFAULT_PROFILE, contentId)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain_.handle('user:clear-history', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE movie_user_data   SET watch_position = 0, last_watched_at = NULL, completed = 0`).run()
    sqlite.prepare(`UPDATE episode_user_data SET watch_position = 0, last_watched_at = NULL, completed = 0`).run()
    return { success: true }
  })

  ipcMain_.handle('user:clear-favorites', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`UPDATE channel_user_data SET is_favorite = 0`).run()
    sqlite.prepare(`UPDATE movie_user_data   SET is_favorite = 0, is_watchlisted = 0`).run()
    sqlite.prepare(`UPDATE series_user_data  SET is_favorite = 0, is_watchlisted = 0`).run()
    return { success: true }
  })

  ipcMain_.handle('user:clear-all-data', async () => {
    const sqlite = getSqlite()
    sqlite.prepare(`DELETE FROM channel_user_data`).run()
    sqlite.prepare(`DELETE FROM movie_user_data`).run()
    sqlite.prepare(`DELETE FROM series_user_data`).run()
    sqlite.prepare(`DELETE FROM episode_user_data`).run()
    return { success: true }
  })

  // ── Browse ────────────────────────────────────────────────────────────
  ipcMain_.handle('content:browse', async (_event, args: {
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

    const enabledSources = getEnabledSourceIds(sqlite)
    const filterIds = args.sourceIds?.length
      ? args.sourceIds.filter(id => enabledSources.has(id))
      : [...enabledSources]
    if (!filterIds.length) return { items: [], total: 0 }

    return runBrowseSearch(type, categoryName, filterIds, limit, offset, sortBy, sortDir)
  })
}
