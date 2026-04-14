/**
 * Delete worker — removes a source and all its content off the main thread.
 * ON DELETE CASCADE on source_id takes care of the per-type content tables:
 *   channels, movies, series, episodes (via series), and their user_data.
 * Per-type category tables and EPG are explicitly deleted here.
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'

const { sourceId, dbPath } = workerData as { sourceId: string; dbPath: string }

try {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = normal')
  db.pragma('foreign_keys = ON')

  db.transaction(() => {
    // CASCADE on source_id handles content rows + their user_data.
    db.prepare(`DELETE FROM channels WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM movies   WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM series   WHERE source_id = ?`).run(sourceId) // episodes CASCADE
    db.prepare(`DELETE FROM channel_categories WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM movie_categories   WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM series_categories  WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM epg WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId)
  })()

  db.close()
  parentPort?.postMessage({ success: true })
} catch (err) {
  parentPort?.postMessage({ success: false, error: String(err) })
}
