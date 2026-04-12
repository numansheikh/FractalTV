/**
 * Indexing compute worker — Option 2 of the indexing rewrite.
 *
 * Reads streams from its own read-only `better-sqlite3` connection, runs the
 * L14 title normalizer + content-hash computation, and posts batches of
 * pre-computed payloads back to the main process. The main process is the
 * only writer — see `indexing.service.ts`.
 *
 * Why a separate worker:
 *   - Normalize + hash + regex = pure CPU. Doing it on main blocks the
 *     event loop and freezes the UI for ~20–30 seconds on a 100k source.
 *   - SQLite locks are file-level, so any *writer* in a worker thread
 *     would race the main connection's user-data writes (the original
 *     SQLITE_BUSY problem). This worker only *reads* (`query_only=ON`),
 *     which never takes a lock. All writes go through the main connection.
 *
 * Lifecycle:
 *   - Spawned per-source by `indexing.service.ts#startIndexing`.
 *   - Iterates `streams` rows in batches via `.iterate()` (avoids loading
 *     100k rows into memory).
 *   - Posts `{type: 'live'|'movie'|'series', items: [...]}` batches.
 *   - On `{type: 'cancel'}` from main, sets `cancelled` and exits the loop
 *     at the next iterator tick. The receiver will see the worker exit and
 *     emit a `cancelled` progress event.
 *   - On completion, posts `{type: 'done'}` and exits cleanly.
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { normalize as normalizeTitle } from '../title-normalizer'

interface WorkerData {
  sourceId: string
  dbPath: string
  /**
   * Batch size for postMessage payloads. Small enough that the main-side
   * write transaction is fast (~20–50ms per batch) and the UI sees frequent
   * yields, large enough that postMessage overhead doesn't dominate.
   */
  batchSize: number
}

const { sourceId, dbPath, batchSize } = workerData as WorkerData

let cancelled = false
parentPort?.on('message', (msg: { type?: string }) => {
  if (msg?.type === 'cancel') cancelled = true
})

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex')
}

function vodContentHash(normalized: string, year: number | null, type: 'movie' | 'series'): string {
  return sha1(`${type}|${normalized}|${year ?? ''}`)
}

function liveContentHash(tvgId: string | null, normalizedName: string): string {
  if (tvgId && tvgId.trim()) return sha1(`live|tvg|${tvgId.trim().toLowerCase()}`)
  return sha1(`live|name|${normalizedName}`)
}

// ─── Payload shapes (mirrored on the receiver side) ──────────────────────

export interface LivePayload {
  streamId: string
  canonicalName: string
  hash: string
}

export interface VodPayload {
  streamId: string
  normalizedTitle: string
  year: number | null
  hash: string
}

export interface SeriesFtsPayload {
  canonicalId: number
  normalizedTitle: string
}

interface LiveRow { id: string; title: string; tvg_id: string | null }
interface MovieRow { id: string; title: string; year_hint: number | null }
interface SeriesCanonRow { id: number; normalized_title: string }

async function run(): Promise<void> {
  const db = new Database(dbPath, { readonly: true })
  db.pragma('query_only = ON')
  db.pragma('busy_timeout = 5000')

  try {
    // ── Phase A: Live channels ─────────────────────────────────────────────
    {
      const total = (db.prepare(
        `SELECT COUNT(*) AS n FROM streams WHERE source_id = ? AND type = 'live' AND canonical_live_id IS NULL`
      ).get(sourceId) as { n: number }).n
      parentPort?.postMessage({ type: 'phase', phase: 'live', total })

      const iter = db.prepare(
        `SELECT id, title, tvg_id FROM streams WHERE source_id = ? AND type = 'live' AND canonical_live_id IS NULL`
      ).iterate(sourceId) as IterableIterator<LiveRow>

      let batch: LivePayload[] = []
      let processed = 0
      for (const row of iter) {
        if (cancelled) { parentPort?.postMessage({ type: 'cancelled' }); return }
        const normalized = normalizeTitle(row.title)
        const canonicalName = normalized.normalizedTitle || row.title.toLowerCase()
        batch.push({
          streamId: row.id,
          canonicalName,
          hash: liveContentHash(row.tvg_id, canonicalName),
        })
        processed++
        if (batch.length >= batchSize) {
          parentPort?.postMessage({ type: 'live-batch', items: batch, processed, total })
          batch = []
        }
      }
      if (batch.length > 0) {
        parentPort?.postMessage({ type: 'live-batch', items: batch, processed, total })
      }
    }

    // ── Phase B: Movies ────────────────────────────────────────────────────
    {
      const total = (db.prepare(
        `SELECT COUNT(*) AS n FROM streams WHERE source_id = ? AND type = 'movie' AND canonical_vod_id IS NULL`
      ).get(sourceId) as { n: number }).n
      parentPort?.postMessage({ type: 'phase', phase: 'movie', total })

      const iter = db.prepare(
        `SELECT id, title, year_hint FROM streams WHERE source_id = ? AND type = 'movie' AND canonical_vod_id IS NULL`
      ).iterate(sourceId) as IterableIterator<MovieRow>

      let batch: VodPayload[] = []
      let processed = 0
      for (const row of iter) {
        if (cancelled) { parentPort?.postMessage({ type: 'cancelled' }); return }
        const normalized = normalizeTitle(row.title)
        const normalizedTitle = normalized.normalizedTitle || row.title.toLowerCase()
        const year = normalized.year ?? row.year_hint ?? null
        batch.push({
          streamId: row.id,
          normalizedTitle,
          year,
          hash: vodContentHash(normalizedTitle, year, 'movie'),
        })
        processed++
        if (batch.length >= batchSize) {
          parentPort?.postMessage({ type: 'movie-batch', items: batch, processed, total })
          batch = []
        }
      }
      if (batch.length > 0) {
        parentPort?.postMessage({ type: 'movie-batch', items: batch, processed, total })
      }
    }

    // ── Phase C: Series FTS (canonicals already exist from sync.worker) ────
    {
      const rows = db.prepare(`
        SELECT cs.id, cs.normalized_title
        FROM canonical_series cs
        JOIN series_sources ss ON ss.canonical_series_id = cs.id AND ss.source_id = ?
        WHERE NOT EXISTS (SELECT 1 FROM canonical_series_fts WHERE canonical_id = cs.id)
      `).all(sourceId) as SeriesCanonRow[]

      parentPort?.postMessage({ type: 'phase', phase: 'series', total: rows.length })

      let batch: SeriesFtsPayload[] = []
      let processed = 0
      for (const row of rows) {
        if (cancelled) { parentPort?.postMessage({ type: 'cancelled' }); return }
        batch.push({ canonicalId: row.id, normalizedTitle: row.normalized_title })
        processed++
        if (batch.length >= batchSize) {
          parentPort?.postMessage({ type: 'series-batch', items: batch, processed, total: rows.length })
          batch = []
        }
      }
      if (batch.length > 0) {
        parentPort?.postMessage({ type: 'series-batch', items: batch, processed, total: rows.length })
      }
    }

    parentPort?.postMessage({ type: 'done' })
  } catch (err) {
    parentPort?.postMessage({ type: 'error', message: String(err) })
  } finally {
    db.close()
  }
}

run()
