/**
 * Indexing service — Option 2 (compute-worker / main-writer split).
 *
 * Spawns `indexing-compute.worker.js` per source. The worker reads streams
 * (read-only handle), runs the L14 normalizer + content-hash, and posts
 * batches of pre-computed payloads back here. This receiver runs short
 * write transactions on the shared `getSqlite()` connection — the same
 * connection user-data IPC handlers use, so writes are naturally serialized
 * and `SQLITE_BUSY` is mechanically impossible.
 *
 * Why this shape (vs. the previous main-only or worker-only variants):
 *   - Worker-only had a separate writer connection → SQLITE_BUSY races with
 *     user-data writes (clear-history, toggle-favorite) during indexing.
 *   - Main-only had no race but burned the main thread for ~20–30s of pure
 *     CPU work (normalize + hash + insert), freezing the UI.
 *   - This split: compute (CPU-heavy) goes off main; writes (lock-bound) go
 *     through the single main connection. Main-thread freezes drop to
 *     ~20–50ms per batch (just the write transaction).
 *
 * Per-source lifecycle:
 *   - `startIndexing(sourceId)` spawns the worker, returns a Promise that
 *     resolves with 'completed' | 'cancelled' | 'error'.
 *   - `cancelIndexing(sourceId)` posts {type:'cancel'} to the worker; the
 *     worker exits at the next batch boundary, the receiver emits 'cancelled'.
 *   - `isIndexing(sourceId)` for IPC concurrency guards.
 */

import { BrowserWindow } from 'electron'
import { Worker } from 'worker_threads'
import { join } from 'path'
import { app } from 'electron'
import { getSqlite } from '../../database/connection'

// ─── Per-source state ────────────────────────────────────────────────────

export type IndexResult = 'completed' | 'cancelled' | 'error'

interface IndexState {
  worker: Worker
  promise: Promise<IndexResult>
}

const activeIndexing = new Map<string, IndexState>()

export function isIndexing(sourceId: string): boolean {
  return activeIndexing.has(sourceId)
}

export function startIndexing(sourceId: string): Promise<IndexResult> {
  const existing = activeIndexing.get(sourceId)
  if (existing) return existing.promise

  const workerPath = join(__dirname, 'indexing-compute.worker.js')
  const worker = new Worker(workerPath, {
    workerData: {
      sourceId,
      dbPath: dbPath(),
      batchSize: BATCH_SIZE,
    },
  })

  const promise = runReceiver(sourceId, worker)
    .finally(() => {
      activeIndexing.delete(sourceId)
      try { worker.terminate() } catch { /* already exited */ }
    })

  activeIndexing.set(sourceId, { worker, promise })
  return promise
}

export function cancelIndexing(sourceId: string): void {
  const state = activeIndexing.get(sourceId)
  if (!state) return
  try { state.worker.postMessage({ type: 'cancel' }) } catch { /* ignore */ }
}

export function cancelAllIndexing(): void {
  for (const [id] of activeIndexing) cancelIndexing(id)
}

// ─── Progress emitters ───────────────────────────────────────────────────

function currentWin(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows()
  return wins[0] ?? null
}

function sendProgress(sourceId: string, phase: string, current: number, total: number, message: string) {
  const win = currentWin()
  if (!win || win.isDestroyed()) return
  win.webContents.send('sync:progress', { sourceId, phase, current, total, message })
}

function sendDone(sourceId: string, message: string) {
  sendProgress(sourceId, 'indexing-done', 0, 0, message)
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const yieldEventLoop = () => new Promise<void>((r) => setImmediate(r))

const BATCH_SIZE = 100

function dbPath(): string {
  return join(
    app.getPath('userData'),
    'data',
    process.env.FRACTALS_DB ? `fractals-${process.env.FRACTALS_DB}.db` : 'fractaltv.db'
  )
}

// ─── Payload types (match indexing-compute.worker.ts) ────────────────────

interface LivePayload  { streamId: string; canonicalName: string; hash: string }
interface VodPayload   { streamId: string; normalizedTitle: string; year: number | null; hash: string }
interface SeriesFtsPayload { canonicalId: number; normalizedTitle: string }

// ─── Receiver loop ───────────────────────────────────────────────────────

async function runReceiver(sourceId: string, worker: Worker): Promise<IndexResult> {
  const db = getSqlite()

  // Prepare statements once per run.

  const insertLiveCanonical = db.prepare(`
    INSERT INTO canonical_live (canonical_name, content_hash)
    VALUES (?, ?)
    ON CONFLICT(content_hash) DO UPDATE SET canonical_name = excluded.canonical_name
    RETURNING id
  `)
  const selectLiveByHash = db.prepare(`SELECT id FROM canonical_live WHERE content_hash = ?`)
  const selectLiveFts = db.prepare(`SELECT 1 FROM canonical_live_fts WHERE canonical_id = ?`)
  const insertLiveFts = db.prepare(`INSERT INTO canonical_live_fts (canonical_id, canonical_name, categories) VALUES (?, ?, '')`)
  const updateLiveCanonical = db.prepare(`UPDATE streams SET canonical_live_id = ? WHERE id = ?`)

  const insertVodCanonical = db.prepare(`
    INSERT INTO canonical_vod (normalized_title, year, content_hash)
    VALUES (?, ?, ?)
    ON CONFLICT(content_hash) DO UPDATE SET normalized_title = excluded.normalized_title
    RETURNING id
  `)
  const selectVodByHash = db.prepare(`SELECT id FROM canonical_vod WHERE content_hash = ?`)
  const selectVodFts = db.prepare(`SELECT 1 FROM canonical_vod_fts WHERE canonical_id = ?`)
  const insertVodFts = db.prepare(`INSERT INTO canonical_vod_fts (canonical_id, normalized_title, multilingual_labels) VALUES (?, ?, '')`)
  const updateVodCanonical = db.prepare(`UPDATE streams SET canonical_vod_id = ? WHERE id = ?`)

  const selectSeriesFts = db.prepare(`SELECT 1 FROM canonical_series_fts WHERE canonical_id = ?`)
  const insertSeriesFts = db.prepare(`INSERT INTO canonical_series_fts (canonical_id, normalized_title, multilingual_labels) VALUES (?, ?, '')`)

  // Batch transactions — short, prepared, write-only. ~20–50ms per call.

  const writeLiveBatch = db.transaction((items: LivePayload[]) => {
    for (const it of items) {
      let canonicalId: number
      try {
        const row = insertLiveCanonical.get(it.canonicalName, it.hash) as { id: number } | undefined
        canonicalId = row!.id
      } catch {
        const existing = selectLiveByHash.get(it.hash) as { id: number } | undefined
        canonicalId = existing!.id
      }
      if (!selectLiveFts.get(canonicalId)) insertLiveFts.run(canonicalId, it.canonicalName)
      updateLiveCanonical.run(canonicalId, it.streamId)
    }
  })

  const writeVodBatch = db.transaction((items: VodPayload[]) => {
    for (const it of items) {
      let canonicalId: number
      try {
        const row = insertVodCanonical.get(it.normalizedTitle, it.year, it.hash) as { id: number } | undefined
        canonicalId = row!.id
      } catch {
        const existing = selectVodByHash.get(it.hash) as { id: number } | undefined
        canonicalId = existing!.id
      }
      if (!selectVodFts.get(canonicalId)) insertVodFts.run(canonicalId, it.normalizedTitle)
      updateVodCanonical.run(canonicalId, it.streamId)
    }
  })

  const writeSeriesBatch = db.transaction((items: SeriesFtsPayload[]) => {
    for (const it of items) {
      if (!selectSeriesFts.get(it.canonicalId)) insertSeriesFts.run(it.canonicalId, it.normalizedTitle)
    }
  })

  // ─── Async message pump ────────────────────────────────────────────────
  // We can't process worker messages straight from the 'message' listener
  // because we need a top-level Promise to await per batch (so we can yield
  // setImmediate after each one). Instead we buffer messages and pull them
  // off in an async loop.

  type Msg =
    | { type: 'phase'; phase: 'live' | 'movie' | 'series'; total: number }
    | { type: 'live-batch'; items: LivePayload[]; processed: number; total: number }
    | { type: 'movie-batch'; items: VodPayload[]; processed: number; total: number }
    | { type: 'series-batch'; items: SeriesFtsPayload[]; processed: number; total: number }
    | { type: 'cancelled' }
    | { type: 'done' }
    | { type: 'error'; message: string }

  const queue: Msg[] = []
  let resolveWait: (() => void) | null = null
  let workerExited = false
  let workerErrored: Error | null = null

  worker.on('message', (msg: Msg) => {
    queue.push(msg)
    if (resolveWait) { const r = resolveWait; resolveWait = null; r() }
  })
  worker.on('error', (err) => {
    workerErrored = err
    if (resolveWait) { const r = resolveWait; resolveWait = null; r() }
  })
  worker.on('exit', () => {
    workerExited = true
    if (resolveWait) { const r = resolveWait; resolveWait = null; r() }
  })

  function next(): Promise<Msg | null> {
    if (queue.length > 0) return Promise.resolve(queue.shift()!)
    if (workerExited || workerErrored) return Promise.resolve(null)
    return new Promise<Msg | null>((resolve) => {
      resolveWait = () => {
        if (queue.length > 0) resolve(queue.shift()!)
        else resolve(null)
      }
    })
  }

  let result: IndexResult = 'completed'

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const msg = await next()
      if (!msg) break

      if (msg.type === 'phase') {
        const label =
          msg.phase === 'live'   ? `Indexing ${msg.total.toLocaleString()} channels…` :
          msg.phase === 'movie'  ? `Indexing ${msg.total.toLocaleString()} movies…` :
                                   `Indexing ${msg.total.toLocaleString()} series…`
        sendProgress(sourceId, `indexing-${msg.phase === 'movie' ? 'movies' : msg.phase}`, 0, msg.total, label)
      }
      else if (msg.type === 'live-batch') {
        writeLiveBatch(msg.items)
        sendProgress(sourceId, 'indexing-live', msg.processed, msg.total,
          `Indexing channels: ${msg.processed.toLocaleString()} / ${msg.total.toLocaleString()}`)
        await yieldEventLoop()
      }
      else if (msg.type === 'movie-batch') {
        writeVodBatch(msg.items)
        sendProgress(sourceId, 'indexing-movies', msg.processed, msg.total,
          `Indexing movies: ${msg.processed.toLocaleString()} / ${msg.total.toLocaleString()}`)
        await yieldEventLoop()
      }
      else if (msg.type === 'series-batch') {
        writeSeriesBatch(msg.items)
        sendProgress(sourceId, 'indexing-series', msg.processed, msg.total,
          `Indexing series: ${msg.processed.toLocaleString()} / ${msg.total.toLocaleString()}`)
        await yieldEventLoop()
      }
      else if (msg.type === 'cancelled') {
        result = 'cancelled'
        break
      }
      else if (msg.type === 'done') {
        // Orphan sweep — cheap, do it on completion only (skip on cancel).
        try {
          db.prepare(`DELETE FROM canonical_vod WHERE id NOT IN (SELECT canonical_vod_id FROM streams WHERE canonical_vod_id IS NOT NULL)`).run()
          db.prepare(`DELETE FROM canonical_live WHERE id NOT IN (SELECT canonical_live_id FROM streams WHERE canonical_live_id IS NOT NULL)`).run()
        } catch (err) {
          console.warn(`[indexing:${sourceId}] orphan sweep failed:`, err)
        }
        break
      }
      else if (msg.type === 'error') {
        console.warn(`[indexing:${sourceId}] worker error:`, msg.message)
        result = 'error'
        break
      }
    }
  } catch (err) {
    console.warn(`[indexing:${sourceId}] receiver error:`, err)
    result = 'error'
  }

  if (workerErrored) {
    console.warn(`[indexing:${sourceId}] worker thread error:`, workerErrored)
    if (result === 'completed') result = 'error'
  }

  sendDone(sourceId, result === 'cancelled' ? 'Cancelled' : 'Search ready')
  return result
}
