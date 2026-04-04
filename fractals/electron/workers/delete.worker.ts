/**
 * Delete worker — removes a source and all its content off the main thread.
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
    db.prepare(`DELETE FROM content_fts WHERE content_id IN (SELECT id FROM content WHERE primary_source_id = ?)`).run(sourceId)
    db.prepare(`DELETE FROM content_categories WHERE content_id IN (SELECT id FROM content WHERE primary_source_id = ?)`).run(sourceId)
    db.prepare(`DELETE FROM user_data WHERE content_id IN (SELECT id FROM content WHERE primary_source_id = ?)`).run(sourceId)
    db.prepare(`DELETE FROM embeddings WHERE content_id IN (SELECT id FROM content WHERE primary_source_id = ?)`).run(sourceId)
    db.prepare(`DELETE FROM content_sources WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM content WHERE primary_source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM categories WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM epg WHERE source_id = ?`).run(sourceId)
    db.prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId)
  })()

  db.close()
  parentPort?.postMessage({ success: true })
} catch (err) {
  parentPort?.postMessage({ success: false, error: String(err) })
}
