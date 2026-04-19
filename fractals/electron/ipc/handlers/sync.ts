// ─── Sync handlers ────────────────────────────────────────────────────────────
// Covers: sources:sync:cancel + runPostSyncChain (exported for sources.ts)

import { ipcMain, BrowserWindow } from 'electron'
import { getSqlite } from '../../database/connection'
import { parseTitle } from '../../lib/title-parser'
import { matchChannelsForSource as iptvOrgMatchSource } from '../../services/iptv-org'
import { applyNsfwFlags, activeSyncWorkers } from './shared'

// Tracks running post-sync chains (iptv-org match + populate metadata).
// Deleting a sourceId from this set signals cancellation to the running chain.
export const activePostSyncChains = new Set<string>()

/** Extract populate metadata logic so it can be called from the post-sync chain. */
async function runPopulateMetadata(
  sourceId: string,
  sqlite: ReturnType<typeof getSqlite>,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const BATCH = 1000
  for (const [table, label] of [
    ['movies', 'movies'],
    ['series', 'series'],
    ['channels', 'channels'],
  ] as [string, string][]) {
    const total = (sqlite.prepare(`SELECT COUNT(*) as n FROM ${table} WHERE source_id = ?`).get(sourceId) as { n: number }).n
    let processed = 0
    const updateStmt = sqlite.prepare(
      `UPDATE ${table} SET md_prefix = ?, md_language = ?, md_year = ?, md_quality = ?, is_nsfw = ? WHERE id = ?`
    )
    while (processed < total) {
      const rows = sqlite.prepare(
        `SELECT id, title FROM ${table} WHERE source_id = ? LIMIT ? OFFSET ?`
      ).all(sourceId, BATCH, processed) as { id: string; title: string }[]
      if (!rows.length) break
      sqlite.transaction(() => {
        for (const row of rows) {
          const p = parseTitle(row.title)
          updateStmt.run(p.mdPrefix, p.mdLanguage, p.mdYear, p.mdQuality, p.isNsfw, row.id)
        }
      })()
      processed += rows.length
      onProgress?.(`Populating metadata… ${label} ${processed}/${total}`)
    }
  }
}

/** Run iptv-org match → populate metadata sequentially after sync+EPG complete. */
export async function runPostSyncChain(
  sourceId: string,
  win: BrowserWindow | null,
  sqlite: ReturnType<typeof getSqlite>,
): Promise<void> {
  activePostSyncChains.add(sourceId)
  const send = (message: string) =>
    win?.webContents.send('sync:progress', { sourceId, phase: 'post-sync', current: 0, total: 0, message })
  const cancelled = () => !activePostSyncChains.has(sourceId)

  try {
    if (cancelled()) return
    send('Matching channels…')
    iptvOrgMatchSource(sourceId)
    applyNsfwFlags(sqlite)

    if (cancelled()) return
    await runPopulateMetadata(sourceId, sqlite, send)

    if (!cancelled()) {
      win?.webContents.send('sync:progress', { sourceId, phase: 'done', current: 0, total: 0, message: 'Ready' })
    }
  } finally {
    activePostSyncChains.delete(sourceId)
  }
}

export function registerSyncHandlers(ipcMain_: typeof ipcMain): void {
  // ── Sync cancel ─────────────────────────────────────────────────────────
  ipcMain_.handle('sources:sync:cancel', async (event, sourceId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const worker = activeSyncWorkers.get(sourceId)
    if (worker) {
      activeSyncWorkers.delete(sourceId)
      worker.terminate()
      getSqlite().prepare('UPDATE sources SET status = ? WHERE id = ?').run('active', sourceId)
      win?.webContents.send('sync:progress', { sourceId, phase: 'canceled', current: 0, total: 0, message: '' })
    }
    return { ok: true }
  })
}
