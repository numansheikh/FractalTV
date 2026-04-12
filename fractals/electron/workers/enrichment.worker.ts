/**
 * Enrichment worker — V3 Phase D2.
 *
 * Drains `oracle_status='pending'` canonicals through the keyless metadata
 * provider chain (L8 for VoD, L10 for Live):
 *
 *   VoD (Latin hint):     IMDb suggest → Wikidata-by-tconst → Wikidata search
 *   VoD (non-Latin hint): Wikidata search → IMDb suggest
 *   Live:                 iptv-org bulk lookup (direct tvg_id match + fuzzy)
 *
 * Runs as a Node worker thread so rate limiting and fetches don't block the
 * main process. Messages to the parent:
 *   { type: 'progress', done, total, phase }
 *   { type: 'done', stats }
 *   { type: 'error', message }
 *
 * This worker is idempotent: it only touches rows where
 * `oracle_status='pending'`, so repeated invocations are cheap after the
 * queue drains. The sync worker (D1) sets new canonicals to 'pending'; the
 * main process kicks this worker on boot and after every sync.
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { normalize as normalizeTitle } from '../services/title-normalizer'
import {
  RateLimiter,
  IMDB_RATE_LIMIT,
  WIKIDATA_RATE_LIMIT,
} from '../services/enrichment/rate-limiter'
import { ImdbSuggestProvider } from '../services/enrichment/providers/imdb-suggest.provider'
import { WikidataProvider } from '../services/enrichment/providers/wikidata.provider'
import { createIptvOrgProvider } from '../services/enrichment/providers/iptv-org.provider'
import { createIptvOrgCache } from '../services/enrichment/iptv-org-cache'
import type { Candidate, LookupHints } from '../services/enrichment/provider'

interface WorkerData {
  dbPath: string
  userDataPath: string
  /** Max VoD canonicals to process per invocation. */
  vodBatchLimit?: number
  /** Max Live canonicals to process per invocation. */
  liveBatchLimit?: number
}

const { dbPath, userDataPath, vodBatchLimit = 300, liveBatchLimit = 1000 } = workerData as WorkerData

function postProgress(phase: string, done: number, total: number) {
  parentPort?.postMessage({ type: 'progress', phase, done, total })
}
function postDone(stats: Record<string, number>) {
  parentPort?.postMessage({ type: 'done', stats })
}
function postError(message: string) {
  parentPort?.postMessage({ type: 'error', message })
}

// ─── Script detection (matches L14 routing hint) ─────────────────────────
const LATIN_RE = /\p{Script=Latin}/u
const ANY_LETTER_RE = /\p{L}/u
function detectScript(text: string): 'latin' | 'non-latin' {
  if (!text) return 'latin'
  let latin = 0
  let nonLatin = 0
  for (const ch of text) {
    if (!ANY_LETTER_RE.test(ch)) continue
    if (LATIN_RE.test(ch)) latin++
    else nonLatin++
  }
  if (nonLatin > latin) return 'non-latin'
  return 'latin'
}

// ─── Candidate → canonical update shape ──────────────────────────────────
interface VodUpdate {
  id: number
  imdbId: string | null
  tmdbId: number | null
  wikidataQid: string | null
  multilingualLabels: string | null
  posterUrl: string | null
  thumbnailUrl: string | null
  posterW: number | null
  posterH: number | null
  oracleStatus: 'resolved' | 'no_match' | 'failed'
}

function candidateToVodUpdate(id: number, c: Candidate | null): VodUpdate {
  if (!c) {
    return {
      id,
      imdbId: null,
      tmdbId: null,
      wikidataQid: null,
      multilingualLabels: null,
      posterUrl: null,
      thumbnailUrl: null,
      posterW: null,
      posterH: null,
      oracleStatus: 'no_match',
    }
  }
  return {
    id,
    imdbId: c.externalIds.imdbId ?? null,
    tmdbId: c.externalIds.tmdbId ?? null,
    wikidataQid: c.externalIds.wikidataQid ?? null,
    multilingualLabels: c.multilingualLabels ? JSON.stringify(c.multilingualLabels) : null,
    posterUrl: c.posterUrl ?? null,
    thumbnailUrl: c.thumbnailUrl ?? null,
    posterW: c.posterW ?? null,
    posterH: c.posterH ?? null,
    oracleStatus: 'resolved',
  }
}

async function run() {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = normal')
  db.pragma('foreign_keys = ON')

  const rateLimiter = new RateLimiter()
  rateLimiter.configure('imdb-suggest', IMDB_RATE_LIMIT)
  rateLimiter.configure('wikidata', WIKIDATA_RATE_LIMIT)

  const imdb = new ImdbSuggestProvider(rateLimiter)
  const wikidata = new WikidataProvider(rateLimiter)
  const iptvCache = createIptvOrgCache(userDataPath)
  const iptvProvider = createIptvOrgProvider(iptvCache)

  const stats = { vodDone: 0, vodResolved: 0, vodNoMatch: 0, liveDone: 0, liveResolved: 0, liveNoMatch: 0 }

  try {
    // ── VOD enrichment pass ──────────────────────────────────────────────
    await enrichVod(db, { imdb, wikidata }, vodBatchLimit, stats)

    // ── Series enrichment pass (same code path, different table) ────────
    await enrichSeries(db, { imdb, wikidata }, vodBatchLimit, stats)

    // ── Live enrichment pass ────────────────────────────────────────────
    await enrichLive(db, iptvProvider, liveBatchLimit, stats)

    postDone(stats as unknown as Record<string, number>)
  } catch (err) {
    postError(String(err))
  } finally {
    db.close()
  }
}

interface VodProviders {
  imdb: ImdbSuggestProvider
  wikidata: WikidataProvider
}

/** Pick the best candidate from a list — prefers year match, else first. */
function pickBest(candidates: Candidate[], year: number | null): Candidate | null {
  if (!candidates.length) return null
  if (year != null) {
    const exact = candidates.find((c) => c.year === year)
    if (exact) return exact
    const near = candidates.find((c) => c.year != null && Math.abs(c.year - year) <= 1)
    if (near) return near
  }
  return candidates[0]
}

async function enrichVod(
  db: Database.Database,
  providers: VodProviders,
  limit: number,
  stats: { vodDone: number; vodResolved: number; vodNoMatch: number }
): Promise<void> {
  interface Row {
    id: number
    normalized_title: string
    year: number | null
  }
  const pending = db.prepare(
    `SELECT id, normalized_title, year FROM canonical_vod WHERE oracle_status = 'pending' LIMIT ?`
  ).all(limit) as Row[]
  if (!pending.length) return

  const updateVod = db.prepare(`
    UPDATE canonical_vod SET
      imdb_id = ?,
      tmdb_id = ?,
      wikidata_qid = ?,
      multilingual_labels = ?,
      poster_url = ?,
      thumbnail_url = ?,
      poster_w = ?,
      poster_h = ?,
      oracle_status = ?,
      oracle_version = oracle_version + 1,
      oracle_attempted_at = unixepoch()
    WHERE id = ?
  `)
  const updateVodFts = db.prepare(`
    UPDATE canonical_vod_fts
    SET multilingual_labels = ?
    WHERE canonical_id = ?
  `)

  for (const row of pending) {
    const candidate = await lookupVodCandidate(providers, row.normalized_title, row.year, 'movie')
    const u = candidateToVodUpdate(row.id, candidate)
    updateVod.run(
      u.imdbId, u.tmdbId, u.wikidataQid, u.multilingualLabels,
      u.posterUrl, u.thumbnailUrl, u.posterW, u.posterH,
      u.oracleStatus, u.id
    )
    // Refresh FTS multilingual_labels column so advanced-mode search finds
    // cross-language labels after enrichment.
    if (u.multilingualLabels) {
      const labelsFlat = Object.values(JSON.parse(u.multilingualLabels) as Record<string, string>).join(' ')
      updateVodFts.run(labelsFlat, u.id)
    }
    stats.vodDone++
    if (u.oracleStatus === 'resolved') stats.vodResolved++
    else stats.vodNoMatch++
    if (stats.vodDone % 10 === 0) postProgress('vod', stats.vodDone, pending.length)
  }
  postProgress('vod', stats.vodDone, pending.length)
}

async function enrichSeries(
  db: Database.Database,
  providers: VodProviders,
  limit: number,
  stats: { vodDone: number; vodResolved: number; vodNoMatch: number }
): Promise<void> {
  interface Row { id: number; normalized_title: string; year: number | null }
  const pending = db.prepare(
    `SELECT id, normalized_title, year FROM canonical_series WHERE oracle_status = 'pending' LIMIT ?`
  ).all(limit) as Row[]
  if (!pending.length) return

  const updateSeries = db.prepare(`
    UPDATE canonical_series SET
      imdb_id = ?,
      tmdb_id = ?,
      wikidata_qid = ?,
      multilingual_labels = ?,
      poster_url = ?,
      thumbnail_url = ?,
      poster_w = ?,
      poster_h = ?,
      oracle_status = ?,
      oracle_version = oracle_version + 1,
      oracle_attempted_at = unixepoch()
    WHERE id = ?
  `)
  const updateSeriesFts = db.prepare(`
    UPDATE canonical_series_fts
    SET multilingual_labels = ?
    WHERE canonical_id = ?
  `)

  for (const row of pending) {
    const candidate = await lookupVodCandidate(providers, row.normalized_title, row.year, 'series')
    const u = candidateToVodUpdate(row.id, candidate)
    updateSeries.run(
      u.imdbId, u.tmdbId, u.wikidataQid, u.multilingualLabels,
      u.posterUrl, u.thumbnailUrl, u.posterW, u.posterH,
      u.oracleStatus, u.id
    )
    if (u.multilingualLabels) {
      const labelsFlat = Object.values(JSON.parse(u.multilingualLabels) as Record<string, string>).join(' ')
      updateSeriesFts.run(labelsFlat, u.id)
    }
    stats.vodDone++
    if (u.oracleStatus === 'resolved') stats.vodResolved++
    else stats.vodNoMatch++
    if (stats.vodDone % 10 === 0) postProgress('series', stats.vodDone, pending.length)
  }
  postProgress('series', stats.vodDone, pending.length)
}

async function lookupVodCandidate(
  providers: VodProviders,
  normalizedTitle: string,
  year: number | null,
  type: 'movie' | 'series'
): Promise<Candidate | null> {
  if (!normalizedTitle) return null

  // L14 routing: Latin → IMDb first, non-Latin → Wikidata first.
  const script = detectScript(normalizedTitle)
  const hints: LookupHints = { year: year ?? undefined, type, languageHint: script === 'latin' ? 'en' : undefined }

  const primary = script === 'latin' ? providers.imdb : providers.wikidata
  const secondary = script === 'latin' ? providers.wikidata : providers.imdb

  const primaryResults = await primary.lookupByTitle(normalizedTitle, hints).catch(() => [])
  const primaryPick = pickBest(primaryResults, year)

  // Happy path: IMDb (or Wikidata in non-Latin) found something. Try to
  // resolve multilingual labels via Wikidata cross-ref on the imdbId.
  if (primaryPick) {
    if (script === 'latin' && primaryPick.externalIds.imdbId) {
      const wdCandidate = await providers.wikidata
        .lookupByExternalId('imdb', primaryPick.externalIds.imdbId)
        .catch(() => null)
      if (wdCandidate) {
        // Merge: keep IMDb's poster, take Wikidata's labels + wikidataQid + tmdbId.
        return {
          ...primaryPick,
          externalIds: { ...primaryPick.externalIds, ...wdCandidate.externalIds },
          multilingualLabels: wdCandidate.multilingualLabels ?? primaryPick.multilingualLabels,
          title: primaryPick.title || wdCandidate.title,
        }
      }
    }
    return primaryPick
  }

  // Fallback: try the secondary provider.
  const secondaryResults = await secondary.lookupByTitle(normalizedTitle, hints).catch(() => [])
  return pickBest(secondaryResults, year)
}

async function enrichLive(
  db: Database.Database,
  provider: ReturnType<typeof createIptvOrgProvider>,
  limit: number,
  stats: { liveDone: number; liveResolved: number; liveNoMatch: number }
): Promise<void> {
  interface Row { id: number; canonical_name: string }
  const pending = db.prepare(
    `SELECT id, canonical_name FROM canonical_live WHERE oracle_status = 'pending' LIMIT ?`
  ).all(limit) as Row[]
  if (!pending.length) return

  // For each canonical_live, try to find the representative tvg_id via a
  // linked stream first (direct match in iptv-org), otherwise fall back to
  // fuzzy name lookup.
  const selectTvgId = db.prepare(
    `SELECT tvg_id FROM streams WHERE canonical_live_id = ? AND tvg_id IS NOT NULL LIMIT 1`
  )
  const updateLive = db.prepare(`
    UPDATE canonical_live SET
      iptv_org_id = ?,
      country = ?,
      languages = ?,
      categories = ?,
      network = ?,
      owners = ?,
      logo_url = ?,
      is_nsfw = ?,
      broadcast_area = ?,
      canonical_name = COALESCE(?, canonical_name),
      oracle_status = ?,
      oracle_version = oracle_version + 1,
      oracle_attempted_at = unixepoch()
    WHERE id = ?
  `)
  const updateLiveFts = db.prepare(`
    UPDATE canonical_live_fts
    SET canonical_name = ?, categories = ?
    WHERE canonical_id = ?
  `)

  for (const row of pending) {
    let candidate: Candidate | null = null

    const tvgRow = selectTvgId.get(row.id) as { tvg_id: string | null } | undefined
    if (tvgRow?.tvg_id) {
      candidate = await provider.lookupByExternalId('iptv-org', tvgRow.tvg_id).catch(() => null)
    }
    if (!candidate) {
      const fuzzy = await provider.lookupByTitle(row.canonical_name, { type: 'live' }).catch(() => [])
      candidate = fuzzy[0] ?? null
    }

    if (candidate?.channelMetadata) {
      const meta = candidate.channelMetadata
      updateLive.run(
        meta.iptvOrgId,
        meta.country,
        JSON.stringify(meta.languages ?? []),
        JSON.stringify(meta.categories ?? []),
        meta.network,
        JSON.stringify(meta.owners ?? []),
        meta.logoUrl,
        meta.isNsfw ? 1 : 0,
        JSON.stringify(meta.broadcastArea ?? []),
        meta.canonicalName,
        'resolved',
        row.id
      )
      updateLiveFts.run(meta.canonicalName, (meta.categories ?? []).join(' '), row.id)
      stats.liveResolved++
    } else {
      db.prepare(`
        UPDATE canonical_live
        SET oracle_status = 'no_match',
            oracle_version = oracle_version + 1,
            oracle_attempted_at = unixepoch()
        WHERE id = ?
      `).run(row.id)
      stats.liveNoMatch++
    }
    stats.liveDone++
    if (stats.liveDone % 50 === 0) postProgress('live', stats.liveDone, pending.length)
  }
  postProgress('live', stats.liveDone, pending.length)
}

// `normalizeTitle` is imported to keep it tree-shaken in; it's currently only
// used indirectly (the sync worker stores pre-normalized titles). Referenced
// here to make the dependency explicit for future search/re-normalize paths.
void normalizeTitle

run()
