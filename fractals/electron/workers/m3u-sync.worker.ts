/**
 * M3U sync worker — g2.
 *
 * Fetches an M3U playlist, parses it, and writes:
 *   - `channels`            — live entries
 *   - `movies`              — standalone VOD entries
 *   - `series` + `episodes` — VOD entries with S##E## title patterns
 *   - `channel_categories`  — live categories from group-title
 *   - `movie_categories`    — movie categories from group-title
 *   - `series_categories`   — series categories from group-title
 *
 * Two-pass classification:
 *   Pass 1 — classify each entry (live / series / movie)
 *   Pass 2 — write to DB (channels, movies, series parents + episodes)
 *
 * Populates `search_title` inline via `normalizeForSearch`. md_* columns are
 * NOT populated here — use the manual "Populate Metadata" button after sync.
 *
 * If the M3U header contains an EPG URL (url-tvg / x-tvg-url), it's stored on
 * the source row for later EPG sync via the manual EPG button.
 *
 * Sync does NOT preserve user data — resyncs wipe user_data via CASCADE.
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { normalizeForSearch } from '../lib/normalize'
import { parseM3u } from '../lib/m3u-parser'
import { parseSeriesTitle } from '../lib/title-parser'
import type { M3uEntry } from '../lib/m3u-parser'

interface WorkerData {
  sourceId: string
  dbPath: string
  m3uUrl: string
  sourceName: string
}

const { sourceId, dbPath, m3uUrl } = workerData as WorkerData

function send(phase: string, current: number, total: number, message: string) {
  parentPort?.postMessage({ type: 'progress', phase, current, total, message })
}
function sendError(message: string) {
  parentPort?.postMessage({ type: 'error', message })
}
function sendDone(totalItems: number, catCount: number) {
  parentPort?.postMessage({ type: 'done', totalItems, catCount })
}

/** Stable short hash for M3U URLs. */
function hashUrl(url: string): string {
  return createHash('md5').update(url).digest('hex').slice(0, 12)
}

/** Serialize httpHeaders to provider_metadata JSON, or null if empty. */
function headersToMeta(headers?: Record<string, string>): string | null {
  if (!headers || Object.keys(headers).length === 0) return null
  return JSON.stringify({ httpHeaders: headers })
}

// ─── Series grouping types ──────────────────────────────────────────────────

interface SeriesGroup {
  key: string              // normalized base title + year for grouping
  baseTitle: string        // clean display title
  year: number | null
  category: string         // most common group-title across episodes
  logo: string | null      // first episode's tvg-logo
  episodes: Array<{
    entry: M3uEntry
    season: number
    episode: number | null
  }>
}

async function run() {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = normal')
  db.pragma('foreign_keys = ON')

  // Tracks whether we've started mutating existing rows. Once true, the
  // catch block can't claim "last snapshot" — current rows are either empty
  // or partial new data, not the prior good state.
  let wipeStarted = false

  try {
    db.prepare('UPDATE sources SET status = ? WHERE id = ?').run('syncing', sourceId)

    // ── Fetch M3U ────────────────────────────────────────────────────────
    const isLocal = m3uUrl.startsWith('file://') || (!m3uUrl.startsWith('http://') && !m3uUrl.startsWith('https://'))
    send('fetching', 0, 0, isLocal ? 'Reading file…' : 'Downloading playlist…')

    let text: string
    if (isLocal) {
      const filePath = m3uUrl.startsWith('file://') ? m3uUrl.slice(7) : m3uUrl
      text = readFileSync(filePath, 'utf-8')
    } else {
      const resp = await fetch(m3uUrl, { signal: AbortSignal.timeout(120_000) })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
      text = await resp.text()
    }
    send('fetching', 1, 1, 'Parsing playlist…')

    // ── Parse ────────────────────────────────────────────────────────────
    const { entries, epgUrl } = parseM3u(text)

    // Schema guard: refuse to proceed (and wipe) on empty / malformed payloads.
    // Preserves last-good snapshot when the remote URL returns 200 + empty body
    // (common for expired playlists served by CDNs).
    if (entries.length === 0) {
      throw new Error('No valid entries found in M3U playlist (refusing to wipe existing content)')
    }
    const withUrl = entries.filter((e) => e.url && /^https?:|^file:|^rtmp:|^udp:|^rtp:/i.test(e.url)).length
    if (withUrl === 0) {
      throw new Error('Parsed M3U has no playable entries (refusing to wipe existing content)')
    }
    send('parsing', entries.length, entries.length, `Found ${entries.length.toLocaleString()} entries`)

    // ── Store EPG URL if found ───────────────────────────────────────────
    if (epgUrl) {
      db.prepare(`UPDATE sources SET epg_url = ? WHERE id = ?`).run(epgUrl, sourceId)
    } else {
      console.warn(`[m3u-sync] No url-tvg / x-tvg-url header in playlist for source ${sourceId}. Live TV will have no EPG unless a separate XMLTV URL is configured.`)
    }

    // ── Pass 1: Classify ────────────────────────────────────────────────
    send('content', 0, entries.length, 'Classifying entries…')

    const liveEntries: M3uEntry[] = []
    const movieEntries: M3uEntry[] = []
    const seriesMap = new Map<string, SeriesGroup>()

    for (const entry of entries) {
      if (entry.type === 'live') {
        liveEntries.push(entry)
        continue
      }

      // Series detection: title S##E## first, then URL /series/ path
      const parsed = parseSeriesTitle(entry.title)
      const isSeries = parsed.isSeries || entry.type === 'series'

      if (isSeries) {
        const normBase = normalizeForSearch(parsed.baseTitle)
        const key = parsed.year ? `${normBase}::${parsed.year}` : normBase

        let group = seriesMap.get(key)
        if (!group) {
          group = {
            key,
            baseTitle: parsed.baseTitle,
            year: parsed.year,
            category: entry.groupTitle,
            logo: entry.tvgLogo || null,
            episodes: [],
          }
          seriesMap.set(key, group)
        }
        if (!group.logo && entry.tvgLogo) group.logo = entry.tvgLogo

        group.episodes.push({
          entry,
          season: parsed.season ?? 1,
          episode: parsed.episode,
        })
      } else {
        movieEntries.push(entry)
      }
    }

    send('content', entries.length, entries.length,
      `Live: ${liveEntries.length}, Movies: ${movieEntries.length}, Series: ${seriesMap.size} (${[...seriesMap.values()].reduce((n, g) => n + g.episodes.length, 0)} episodes)`)

    // ── Categories ───────────────────────────────────────────────────────
    const chanCats = new Map<string, string>()
    const movieCats = new Map<string, string>()
    const seriesCats = new Map<string, string>()

    for (const entry of liveEntries) {
      if (!chanCats.has(entry.groupTitle)) chanCats.set(entry.groupTitle, entry.groupTitle)
    }
    for (const entry of movieEntries) {
      if (!movieCats.has(entry.groupTitle)) movieCats.set(entry.groupTitle, entry.groupTitle)
    }
    for (const [, group] of seriesMap) {
      if (!seriesCats.has(group.category)) seriesCats.set(group.category, group.category)
    }

    // Wipe existing per-source data (content first, then categories to avoid
    // unnecessary SET NULL updates on category_id FKs)
    wipeStarted = true
    db.prepare(`DELETE FROM channels            WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM movies              WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM series              WHERE source_id = ?`).run(sourceId)
    // episodes CASCADE from series
    db.prepare(`DELETE FROM channel_categories  WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM movie_categories    WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM series_categories   WHERE source_id = ?`).run(sourceId)

    const insertChanCat   = db.prepare(`INSERT INTO channel_categories (id, source_id, external_id, name, position) VALUES (?, ?, ?, ?, ?)`)
    const insertMovieCat  = db.prepare(`INSERT INTO movie_categories   (id, source_id, external_id, name, position) VALUES (?, ?, ?, ?, ?)`)
    const insertSeriesCat = db.prepare(`INSERT INTO series_categories  (id, source_id, external_id, name, position) VALUES (?, ?, ?, ?, ?)`)

    const writeCats = db.transaction(() => {
      let pos = 0
      for (const [name] of chanCats) {
        const extId = hashUrl(`live:${name}`)
        insertChanCat.run(`${sourceId}:chancat:${extId}`, sourceId, extId, name, pos++)
      }
      pos = 0
      for (const [name] of movieCats) {
        const extId = hashUrl(`movie:${name}`)
        insertMovieCat.run(`${sourceId}:moviecat:${extId}`, sourceId, extId, name, pos++)
      }
      pos = 0
      for (const [name] of seriesCats) {
        const extId = hashUrl(`series:${name}`)
        insertSeriesCat.run(`${sourceId}:seriescat:${extId}`, sourceId, extId, name, pos++)
      }
    })
    writeCats()

    const catTotal = chanCats.size + movieCats.size + seriesCats.size
    send('categories', catTotal, catTotal, `${catTotal} categories`)

    // ── Pass 2: Write content ───────────────────────────────────────────
    const insertChannel = db.prepare(`
      INSERT OR REPLACE INTO channels (
        id, source_id, category_id, external_id, title, search_title,
        thumbnail_url, stream_url, tvg_id, epg_channel_id, provider_metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertMovie = db.prepare(`
      INSERT OR REPLACE INTO movies (
        id, source_id, category_id, external_id, title, search_title,
        thumbnail_url, stream_url, container_extension, provider_metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertSeries = db.prepare(`
      INSERT OR REPLACE INTO series (
        id, source_id, category_id, external_id, title, search_title,
        thumbnail_url, provider_metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertEpisode = db.prepare(`
      INSERT OR REPLACE INTO episodes (
        id, series_id, external_id, title, stream_url,
        container_extension, season, episode_num
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const totalContent = liveEntries.length + movieEntries.length +
      [...seriesMap.values()].reduce((n, g) => n + g.episodes.length, 0)
    let written = 0
    const BATCH = 500

    // ── Channels ─────────────────────────────────────────────────────────
    const batchChannels = db.transaction((items: M3uEntry[]) => {
      for (const entry of items) {
        const urlHash = hashUrl(entry.url)
        const rawTitle = entry.title || 'Unknown'
        const catExtId = hashUrl(`live:${entry.groupTitle}`)
        const catId = `${sourceId}:chancat:${catExtId}`
        const tvgId = entry.tvgId || null
        insertChannel.run(
          `${sourceId}:live:${urlHash}`, sourceId, catId, urlHash,
          rawTitle, normalizeForSearch(rawTitle),
          entry.tvgLogo || null, entry.url, tvgId, tvgId,
          headersToMeta(entry.httpHeaders)
        )
      }
    })

    for (let i = 0; i < liveEntries.length; i += BATCH) {
      batchChannels(liveEntries.slice(i, i + BATCH))
      written += Math.min(BATCH, liveEntries.length - i)
      send('content', written, totalContent, `Items: ${written.toLocaleString()}/${totalContent.toLocaleString()}`)
    }

    // ── Movies ───────────────────────────────────────────────────────────
    const batchMovies = db.transaction((items: M3uEntry[]) => {
      for (const entry of items) {
        const urlHash = hashUrl(entry.url)
        const rawTitle = entry.title || 'Unknown'
        const catExtId = hashUrl(`movie:${entry.groupTitle}`)
        const catId = `${sourceId}:moviecat:${catExtId}`
        insertMovie.run(
          `${sourceId}:movie:${urlHash}`, sourceId, catId, urlHash,
          rawTitle, normalizeForSearch(rawTitle),
          entry.tvgLogo || null, entry.url, entry.containerExtension || null,
          headersToMeta(entry.httpHeaders)
        )
      }
    })

    for (let i = 0; i < movieEntries.length; i += BATCH) {
      batchMovies(movieEntries.slice(i, i + BATCH))
      written += Math.min(BATCH, movieEntries.length - i)
      send('content', written, totalContent, `Items: ${written.toLocaleString()}/${totalContent.toLocaleString()}`)
    }

    // ── Series + Episodes ────────────────────────────────────────────────
    const batchSeries = db.transaction((groups: SeriesGroup[]) => {
      for (const group of groups) {
        const seriesHash = hashUrl(group.key)
        const seriesId = `${sourceId}:series:${seriesHash}`
        const catExtId = hashUrl(`series:${group.category}`)
        const catId = `${sourceId}:seriescat:${catExtId}`

        // Use headers from first episode that has them (shared across episodes)
        const firstHeaders = group.episodes.find(e => e.entry.httpHeaders)?.entry.httpHeaders
        insertSeries.run(
          seriesId, sourceId, catId, seriesHash,
          group.baseTitle, normalizeForSearch(group.baseTitle),
          group.logo, headersToMeta(firstHeaders)
        )

        for (const ep of group.episodes) {
          const urlHash = hashUrl(ep.entry.url)
          const epId = `${sourceId}:episode:${urlHash}`
          const epTitle = ep.entry.title || 'Unknown'

          insertEpisode.run(
            epId, seriesId, urlHash, epTitle,
            ep.entry.url, ep.entry.containerExtension || null,
            ep.season, ep.episode
          )
        }
      }
    })

    const seriesGroups = [...seriesMap.values()]
    // Batch series in groups of ~50 series at a time
    const SERIES_BATCH = 50
    for (let i = 0; i < seriesGroups.length; i += SERIES_BATCH) {
      const batch = seriesGroups.slice(i, i + SERIES_BATCH)
      batchSeries(batch)
      const epCount = batch.reduce((n, g) => n + g.episodes.length, 0)
      written += epCount
      send('content', written, totalContent, `Items: ${written.toLocaleString()}/${totalContent.toLocaleString()}`)
    }

    // ── Finalize ─────────────────────────────────────────────────────────
    const chCount = (db.prepare('SELECT COUNT(*) as n FROM channels WHERE source_id = ?').get(sourceId) as { n: number }).n
    const mvCount = (db.prepare('SELECT COUNT(*) as n FROM movies   WHERE source_id = ?').get(sourceId) as { n: number }).n
    const srCount = (db.prepare('SELECT COUNT(*) as n FROM series   WHERE source_id = ?').get(sourceId) as { n: number }).n
    const epCount = (db.prepare(`
      SELECT COUNT(*) as n FROM episodes e
      JOIN series s ON e.series_id = s.id
      WHERE s.source_id = ?
    `).get(sourceId) as { n: number }).n
    const totalItems = chCount + mvCount + srCount

    // Drop categories with no referencing content for this source.
    for (const [catTable, contentTable] of [
      ['channel_categories', 'channels'],
      ['movie_categories',   'movies'],
      ['series_categories',  'series'],
    ] as const) {
      db.prepare(`
        DELETE FROM ${catTable}
        WHERE source_id = ?
          AND id NOT IN (
            SELECT DISTINCT category_id FROM ${contentTable}
            WHERE source_id = ? AND category_id IS NOT NULL
          )
      `).run(sourceId, sourceId)
    }

    db.prepare(`
      UPDATE sources SET status = 'active', last_sync = unixepoch(), last_error = NULL, item_count = ?
      WHERE id = ?
    `).run(totalItems, sourceId)

    send('content', totalContent, totalContent,
      `Done — ${chCount} channels, ${mvCount} movies, ${srCount} series (${epCount} episodes)`)

    sendDone(totalItems, catTotal)
  } catch (err) {
    // Only claim "last snapshot" when the failure was BEFORE any wipe —
    // once wipeStarted=true the rows are either empty or partial new data,
    // not the prior good state, so a plain error is more honest.
    const existing = wipeStarted ? 0
      : (db.prepare('SELECT COUNT(*) as n FROM channels WHERE source_id = ?').get(sourceId) as { n: number }).n
        + (db.prepare('SELECT COUNT(*) as n FROM movies WHERE source_id = ?').get(sourceId) as { n: number }).n
        + (db.prepare('SELECT COUNT(*) as n FROM series WHERE source_id = ?').get(sourceId) as { n: number }).n
    if (existing > 0) {
      db.prepare(`UPDATE sources SET status = 'active', last_error = ? WHERE id = ?`).run(`Refresh failed — showing last snapshot: ${String(err)}`, sourceId)
    } else {
      db.prepare(`UPDATE sources SET status = 'error', last_error = ? WHERE id = ?`).run(String(err), sourceId)
    }
    sendError(String(err))
  } finally {
    db.close()
  }
}

run()
