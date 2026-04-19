// ─── IPC handler orchestrator ─────────────────────────────────────────────────
// This file is intentionally thin — it delegates to domain-specific files.
// All business logic lives in `./handlers/`.

import { ipcMain } from 'electron'
import { registerSourceHandlers } from './handlers/sources'
import { registerSyncHandlers } from './handlers/sync'
import { registerEpgHandlers } from './handlers/epg'
import { registerSearchHandlers } from './handlers/search'
import { registerContentHandlers } from './handlers/content'
import { registerEnrichmentHandlers } from './handlers/enrichment'
import { registerSettingsHandlers } from './handlers/settings'

export function registerHandlers() {
  registerSourceHandlers(ipcMain)
  registerSyncHandlers(ipcMain)
  registerEpgHandlers(ipcMain)
  registerSearchHandlers(ipcMain)
  registerContentHandlers(ipcMain)
  registerEnrichmentHandlers(ipcMain)
  registerSettingsHandlers(ipcMain)
}
