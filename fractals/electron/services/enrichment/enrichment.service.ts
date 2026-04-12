/**
 * Enrichment service — V3 Phase D2 (main-process variant).
 *
 * Drains `oracle_status='pending'` canonicals through the keyless metadata
 * provider chain, but runs **in the main process** using the same sqlite
 * connection that handles user actions. That eliminates the multi-writer race
 * the old worker-based enrichment had with the UI — a `user:clear-history`
 * delete and an enrichment UPDATE go through the same prepared-statement
 * queue, so they serialize automatically with zero lock contention.
 *
 * Network fetches are async and yield the event loop naturally during
 * `await`. The only synchronous work on the main thread per canonical is a
 * sub-millisecond prepared-statement `.run()`, which is invisible to the UI.
 *
 * Per-source lifecycle:
 *   - `startEnrichment(sourceId)`    — begin (or reuse) a drain loop
 *   - `cancelEnrichment(sourceId)`   — abort in-flight fetch + stop loop
 *   - `isEnriching(sourceId)`        — guard concurrency in IPC handlers
 *
 * Progress is emitted on the existing `sync:progress` IPC channel with
 * `phase: 'enriching' | 'enriching-done'` so the renderer is unchanged.
 */

import { BrowserWindow, app } from 'electron'
import { getSqlite } from '../../database/connection'
import {
  RateLimiter,
  IMDB_RATE_LIMIT,
  WIKIDATA_RATE_LIMIT,
} from './rate-limiter'
import { ImdbSuggestProvider } from './providers/imdb-suggest.provider'
import { WikidataProvider } from './providers/wikidata.provider'
import { createIptvOrgProvider } from './providers/iptv-org.provider'
import { createIptvOrgCache } from './iptv-org-cache'
import type { Candidate, LookupHints } from './provider'

// ─── Singleton providers (shared across all per-source drains) ───────────

const rateLimiter = new RateLimiter()
rateLimiter.configure('imdb-suggest', IMDB_RATE_LIMIT)
rateLimiter.configure('wikidata', WIKIDATA_RATE_LIMIT)

const imdbProvider = new ImdbSuggestProvider(rateLimiter)
const wikidataProvider = new WikidataProvider(rateLimiter)

let _iptvProvider: ReturnType<typeof createIptvOrgProvider> | null = null
function iptvOrg() {
  if (!_iptvProvider) {
    const cache = createIptvOrgCache(app.getPath('userData'))
    _iptvProvider = createIptvOrgProvider(cache)
  }
  return _iptvProvider
}

// ─── Per-source drain state ──────────────────────────────────────────────

interface DrainState {
  abort: AbortController
}

const activeDrains = new Map<string, DrainState>()

export function isEnriching(sourceId: string): boolean {
  return activeDrains.has(sourceId)
}

export function startEnrichment(sourceId: string): void {
  if (activeDrains.has(sourceId)) return
  const abort = new AbortController()
  activeDrains.set(sourceId, { abort })
  // Fire-and-forget. The drain cleans up its own state in finally.
  void drainSource(sourceId, abort.signal)
    .catch((err) => console.warn(`[enrichment:${sourceId}] drain error:`, err))
    .finally(() => {
      activeDrains.delete(sourceId)
      sendDone(sourceId)
    })
}

export function cancelEnrichment(sourceId: string): void {
  const state = activeDrains.get(sourceId)
  if (!state) return
  state.abort.abort()
  // The drain loop checks `signal.aborted` between rows and exits; the
  // finally handler above removes the map entry + emits enriching-done.
}

export function cancelAllEnrichment(): void {
  for (const [id] of activeDrains) cancelEnrichment(id)
}

// ─── Progress emitter ────────────────────────────────────────────────────

function currentWin(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows()
  return wins[0] ?? null
}

function sendProgress(sourceId: string, current: number, total: number, message: string) {
  const win = currentWin()
  if (!win || win.isDestroyed()) return
  win.webContents.send('sync:progress', {
    sourceId,
    phase: 'enriching',
    current,
    total,
    message,
  })
}

function sendDone(sourceId: string) {
  const win = currentWin()
  if (!win || win.isDestroyed()) return
  win.webContents.send('sync:progress', {
    sourceId,
    phase: 'enriching-done',
    current: 0,
    total: 0,
    message: 'Enrichment complete',
  })
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
  return nonLatin > latin ? 'non-latin' : 'latin'
}

// ─── Candidate → update shape ────────────────────────────────────────────

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
      imdbId: null, tmdbId: null, wikidataQid: null,
      multilingualLabels: null,
      posterUrl: null, thumbnailUrl: null,
      posterW: null, posterH: null,
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

// ─── Drain loop per source ───────────────────────────────────────────────

async function drainSource(sourceId: string, signal: AbortSignal): Promise<void> {
  const db = getSqlite()

  const vodTotal = (db.prepare(`
    SELECT COUNT(DISTINCT cv.id) AS n
    FROM canonical_vod cv
    JOIN streams s ON s.canonical_vod_id = cv.id
    WHERE s.source_id = ? AND cv.oracle_status = 'pending'
  `).get(sourceId) as { n: number }).n
  const seriesTotal = (db.prepare(`
    SELECT COUNT(DISTINCT cs.id) AS n
    FROM canonical_series cs
    JOIN series_sources ss ON ss.canonical_series_id = cs.id
    WHERE ss.source_id = ? AND cs.oracle_status = 'pending'
  `).get(sourceId) as { n: number }).n
  const liveTotal = (db.prepare(`
    SELECT COUNT(DISTINCT cl.id) AS n
    FROM canonical_live cl
    JOIN streams s ON s.canonical_live_id = cl.id
    WHERE s.source_id = ? AND cl.oracle_status = 'pending'
  `).get(sourceId) as { n: number }).n

  const total = vodTotal + seriesTotal + liveTotal
  if (total === 0) return

  sendProgress(sourceId, 0, total, `Enriching library: 0 / ${total.toLocaleString()}`)

  const stats = { done: 0, resolved: 0, noMatch: 0 }
  const tick = () => {
    if (stats.done % 5 === 0 || stats.done === total) {
      sendProgress(sourceId, stats.done, total, `Enriching library: ${stats.done.toLocaleString()} / ${total.toLocaleString()}`)
    }
  }

  await enrichVod(db, sourceId, signal, stats, tick)
  if (signal.aborted) return

  await enrichSeries(db, sourceId, signal, stats, tick)
  if (signal.aborted) return

  await enrichLive(db, sourceId, signal, stats, tick)

  sendProgress(sourceId, stats.done, total, `Enriching library: ${stats.done.toLocaleString()} / ${total.toLocaleString()}`)
}

// ─── VOD pass ────────────────────────────────────────────────────────────

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

async function lookupVodCandidate(
  normalizedTitle: string,
  year: number | null,
  type: 'movie' | 'series',
): Promise<Candidate | null> {
  if (!normalizedTitle) return null
  const script = detectScript(normalizedTitle)
  const hints: LookupHints = { year: year ?? undefined, type, languageHint: script === 'latin' ? 'en' : undefined }
  const primary = script === 'latin' ? imdbProvider : wikidataProvider
  const secondary = script === 'latin' ? wikidataProvider : imdbProvider

  const primaryResults = await primary.lookupByTitle(normalizedTitle, hints).catch(() => [])
  const primaryPick = pickBest(primaryResults, year)

  if (primaryPick) {
    if (script === 'latin' && primaryPick.externalIds.imdbId) {
      const wdCandidate = await wikidataProvider
        .lookupByExternalId('imdb', primaryPick.externalIds.imdbId)
        .catch(() => null)
      if (wdCandidate) {
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

  const secondaryResults = await secondary.lookupByTitle(normalizedTitle, hints).catch(() => [])
  return pickBest(secondaryResults, year)
}

async function enrichVod(
  db: ReturnType<typeof getSqlite>,
  sourceId: string,
  signal: AbortSignal,
  stats: { done: number; resolved: number; noMatch: number },
  tick: () => void,
): Promise<void> {
  interface Row { id: number; normalized_title: string; year: number | null }
  const pending = db.prepare(`
    SELECT DISTINCT cv.id, cv.normalized_title, cv.year
    FROM canonical_vod cv
    JOIN streams s ON s.canonical_vod_id = cv.id
    WHERE s.source_id = ? AND cv.oracle_status = 'pending'
  `).all(sourceId) as Row[]
  if (!pending.length) return

  const updateVod = db.prepare(`
    UPDATE canonical_vod SET
      imdb_id = ?, tmdb_id = ?, wikidata_qid = ?, multilingual_labels = ?,
      poster_url = ?, thumbnail_url = ?, poster_w = ?, poster_h = ?,
      oracle_status = ?,
      oracle_version = oracle_version + 1,
      oracle_attempted_at = unixepoch()
    WHERE id = ?
  `)
  const updateVodFts = db.prepare(`
    UPDATE canonical_vod_fts SET multilingual_labels = ? WHERE canonical_id = ?
  `)

  for (const row of pending) {
    if (signal.aborted) return
    const candidate = await lookupVodCandidate(row.normalized_title, row.year, 'movie')
    if (signal.aborted) return
    const u = candidateToVodUpdate(row.id, candidate)
    updateVod.run(
      u.imdbId, u.tmdbId, u.wikidataQid, u.multilingualLabels,
      u.posterUrl, u.thumbnailUrl, u.posterW, u.posterH,
      u.oracleStatus, u.id,
    )
    if (u.multilingualLabels) {
      const labelsFlat = Object.values(JSON.parse(u.multilingualLabels) as Record<string, string>).join(' ')
      updateVodFts.run(labelsFlat, u.id)
    }
    stats.done++
    if (u.oracleStatus === 'resolved') stats.resolved++
    else stats.noMatch++
    tick()
  }
}

async function enrichSeries(
  db: ReturnType<typeof getSqlite>,
  sourceId: string,
  signal: AbortSignal,
  stats: { done: number; resolved: number; noMatch: number },
  tick: () => void,
): Promise<void> {
  interface Row { id: number; normalized_title: string; year: number | null }
  const pending = db.prepare(`
    SELECT DISTINCT cs.id, cs.normalized_title, cs.year
    FROM canonical_series cs
    JOIN series_sources ss ON ss.canonical_series_id = cs.id
    WHERE ss.source_id = ? AND cs.oracle_status = 'pending'
  `).all(sourceId) as Row[]
  if (!pending.length) return

  const updateSeries = db.prepare(`
    UPDATE canonical_series SET
      imdb_id = ?, tmdb_id = ?, wikidata_qid = ?, multilingual_labels = ?,
      poster_url = ?, thumbnail_url = ?, poster_w = ?, poster_h = ?,
      oracle_status = ?,
      oracle_version = oracle_version + 1,
      oracle_attempted_at = unixepoch()
    WHERE id = ?
  `)
  const updateSeriesFts = db.prepare(`
    UPDATE canonical_series_fts SET multilingual_labels = ? WHERE canonical_id = ?
  `)

  for (const row of pending) {
    if (signal.aborted) return
    const candidate = await lookupVodCandidate(row.normalized_title, row.year, 'series')
    if (signal.aborted) return
    const u = candidateToVodUpdate(row.id, candidate)
    updateSeries.run(
      u.imdbId, u.tmdbId, u.wikidataQid, u.multilingualLabels,
      u.posterUrl, u.thumbnailUrl, u.posterW, u.posterH,
      u.oracleStatus, u.id,
    )
    if (u.multilingualLabels) {
      const labelsFlat = Object.values(JSON.parse(u.multilingualLabels) as Record<string, string>).join(' ')
      updateSeriesFts.run(labelsFlat, u.id)
    }
    stats.done++
    if (u.oracleStatus === 'resolved') stats.resolved++
    else stats.noMatch++
    tick()
  }
}

// ─── Live pass ───────────────────────────────────────────────────────────

async function enrichLive(
  db: ReturnType<typeof getSqlite>,
  sourceId: string,
  signal: AbortSignal,
  stats: { done: number; resolved: number; noMatch: number },
  tick: () => void,
): Promise<void> {
  interface Row { id: number; canonical_name: string }
  const pending = db.prepare(`
    SELECT DISTINCT cl.id, cl.canonical_name
    FROM canonical_live cl
    JOIN streams s ON s.canonical_live_id = cl.id
    WHERE s.source_id = ? AND cl.oracle_status = 'pending'
  `).all(sourceId) as Row[]
  if (!pending.length) return

  const provider = iptvOrg()
  const selectTvgId = db.prepare(
    `SELECT tvg_id FROM streams WHERE canonical_live_id = ? AND tvg_id IS NOT NULL LIMIT 1`,
  )
  const updateLive = db.prepare(`
    UPDATE canonical_live SET
      iptv_org_id = ?, country = ?, languages = ?, categories = ?,
      network = ?, owners = ?, logo_url = ?, is_nsfw = ?, broadcast_area = ?,
      canonical_name = COALESCE(?, canonical_name),
      oracle_status = ?,
      oracle_version = oracle_version + 1,
      oracle_attempted_at = unixepoch()
    WHERE id = ?
  `)
  const updateLiveFts = db.prepare(`
    UPDATE canonical_live_fts SET canonical_name = ?, categories = ? WHERE canonical_id = ?
  `)
  const markNoMatch = db.prepare(`
    UPDATE canonical_live
    SET oracle_status = 'no_match',
        oracle_version = oracle_version + 1,
        oracle_attempted_at = unixepoch()
    WHERE id = ?
  `)

  for (const row of pending) {
    if (signal.aborted) return
    let candidate: Candidate | null = null
    const tvgRow = selectTvgId.get(row.id) as { tvg_id: string | null } | undefined
    if (tvgRow?.tvg_id) {
      candidate = await provider.lookupByExternalId('iptv-org', tvgRow.tvg_id).catch(() => null)
    }
    if (!candidate) {
      const fuzzy = await provider.lookupByTitle(row.canonical_name, { type: 'live' }).catch(() => [])
      candidate = fuzzy[0] ?? null
    }
    if (signal.aborted) return

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
        row.id,
      )
      updateLiveFts.run(meta.canonicalName, (meta.categories ?? []).join(' '), row.id)
      stats.resolved++
    } else {
      markNoMatch.run(row.id)
      stats.noMatch++
    }
    stats.done++
    tick()
  }
}
