import { create } from 'zustand'
import { buildColorMapFromSources, type SourceColor } from '@/lib/sourceColors'

export interface Source {
  id: string
  type: 'xtream' | 'm3u'
  name: string
  serverUrl?: string
  username?: string
  password?: string
  status: 'active' | 'error' | 'syncing'
  disabled: boolean
  lastSync?: number
  lastError?: string
  itemCount: number
  // Account info (from Xtream)
  expDate?: string | null        // Unix timestamp string or null
  maxConnections?: number | null
  subscriptionType?: string | null
  // M3U-specific
  m3uUrl?: string
  epgUrl?: string | null
  // UI color — index into the 16-color palette (user-assigned or auto by position)
  colorIndex?: number
  // Manual ingestion pipeline state — gates the Test → Sync → EPG buttons on SourceCard.
  // Forward-only unlock: once a step is reached, all earlier steps stay clickable.
  ingestState: 'added' | 'tested' | 'synced' | 'epg_fetched'
}

export interface SyncProgress {
  phase: string  // xtream: categories|live|movies|series  m3u: fetching|parsing|content  both: done|error|warning|canceled
  current: number
  total: number
  message: string
}

export interface EnrichProgress {
  current: number
  total: number
  message?: string
}

export interface EnrichResult {
  success: boolean
  message: string
}

interface SourcesState {
  sources: Source[]
  /** Derived: source.id → SourceColor. Rebuilt on every `setSources` / `updateSource`. */
  _colorMap: Record<string, SourceColor>
  /** Derived: source.id → source.name. Rebuilt alongside `_colorMap`. */
  _sourceNames: Record<string, string>
  /** Derived: sources.length (quick narrow-selector read for cards). */
  _sourceCount: number
  /** Which source IDs are selected for filtering. Empty = all enabled sources. */
  selectedSourceIds: string[]
  /** Live sync progress per source, keyed by sourceId. Null = not syncing. */
  syncProgress: Record<string, SyncProgress | null>
  /** Live enrichment progress per source. Null = not enriching. */
  enrichProgress: Record<string, EnrichProgress | null>
  /** Last enrichment result per source (persists until next run). */
  enrichResult: Record<string, EnrichResult | null>
  /** Manual EPG sync in-flight, per source. */
  epgSyncing: Record<string, boolean>
  /** Last manual EPG sync result, per source. Survives SourceCard unmount. */
  epgResult: Record<string, { success: boolean; message: string } | null>
  setSources: (sources: Source[]) => void
  updateSource: (id: string, patch: Partial<Source>) => void
  setSyncProgress: (sourceId: string, progress: SyncProgress | null) => void
  setEnrichProgress: (sourceId: string, progress: EnrichProgress | null) => void
  setEnrichResult: (sourceId: string, result: EnrichResult | null) => void
  setEpgSyncing: (sourceId: string, v: boolean) => void
  setEpgResult: (sourceId: string, result: { success: boolean; message: string } | null) => void
  toggleSourceFilter: (id: string) => void
  clearSourceFilter: () => void
}

function deriveFromSources(sources: Source[]): Pick<SourcesState, '_colorMap' | '_sourceNames' | '_sourceCount'> {
  const _sourceNames: Record<string, string> = {}
  for (const s of sources) _sourceNames[s.id] = s.name
  return {
    _colorMap: buildColorMapFromSources(sources),
    _sourceNames,
    _sourceCount: sources.length,
  }
}

export const useSourcesStore = create<SourcesState>((set) => ({
  sources: [],
  _colorMap: {},
  _sourceNames: {},
  _sourceCount: 0,
  selectedSourceIds: [],
  syncProgress: {},
  enrichProgress: {},
  enrichResult: {},
  epgSyncing: {},
  epgResult: {},
  setSources: (sources) => set({ sources, ...deriveFromSources(sources) }),
  updateSource: (id, patch) =>
    set((s) => {
      const sources = s.sources.map((src) => (src.id === id ? { ...src, ...patch } : src))
      return { sources, ...deriveFromSources(sources) }
    }),
  setSyncProgress: (sourceId, progress) =>
    set((s) => ({ syncProgress: { ...s.syncProgress, [sourceId]: progress } })),
  setEnrichProgress: (sourceId, progress) =>
    set((s) => ({ enrichProgress: { ...s.enrichProgress, [sourceId]: progress } })),
  setEnrichResult: (sourceId, result) =>
    set((s) => ({ enrichResult: { ...s.enrichResult, [sourceId]: result } })),
  setEpgSyncing: (sourceId, v) =>
    set((s) => ({ epgSyncing: { ...s.epgSyncing, [sourceId]: v } })),
  setEpgResult: (sourceId, result) =>
    set((s) => ({ epgResult: { ...s.epgResult, [sourceId]: result } })),
  toggleSourceFilter: (id) =>
    set((s) => {
      const has = s.selectedSourceIds.includes(id)
      return { selectedSourceIds: has ? s.selectedSourceIds.filter((x) => x !== id) : [...s.selectedSourceIds, id] }
    }),
  clearSourceFilter: () => set({ selectedSourceIds: [] }),
}))
