/**
 * Delete worker — removes a source and all its content off the main thread.
 * Deletes streams (cascades stream_categories), categories, epg, and the source row.
 * Canonical + user_data rows survive (source-independent).
 */

import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'

const { sourceId, dbPath } = workerData as { sourceId: string; dbPath: string }

try {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = normal')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 30000')

  db.transaction(() => {
    // stream_categories cascade from streams via FK ON DELETE CASCADE
    db.prepare(`DELETE FROM streams WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM categories WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM epg WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId)
  })()

  db.close()
  parentPort?.postMessage({ success: true })
} catch (err) {
  parentPort?.postMessage({ success: false, error: String(err) })
}
