import { create } from 'zustand'

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
  // UI color — index into the 16-color palette (user-assigned or auto by position)
  colorIndex?: number
}

export interface SyncProgress {
  phase: 'categories' | 'live' | 'movies' | 'series' | 'done' | 'indexing-live' | 'indexing-movies' | 'indexing-series' | 'indexing-done' | 'enriching' | 'enriching-done' | 'cancelled' | 'error'
  current: number
  total: number
  message: string
}

interface SourcesState {
  sources: Source[]
  /** Which source IDs are selected for filtering. Empty = all enabled sources. */
  selectedSourceIds: string[]
  /** Live sync progress per source, keyed by sourceId. Null = not syncing. */
  syncProgress: Record<string, SyncProgress | null>
  setSources: (sources: Source[]) => void
  updateSource: (id: string, patch: Partial<Source>) => void
  setSyncProgress: (sourceId: string, progress: SyncProgress | null) => void
  toggleSourceFilter: (id: string) => void
  clearSourceFilter: () => void
}

export const useSourcesStore = create<SourcesState>((set) => ({
  sources: [],
  selectedSourceIds: [],
  syncProgress: {},
  setSources: (sources) => set({ sources }),
  updateSource: (id, patch) =>
    set((s) => ({ sources: s.sources.map((src) => (src.id === id ? { ...src, ...patch } : src)) })),
  setSyncProgress: (sourceId, progress) =>
    set((s) => ({ syncProgress: { ...s.syncProgress, [sourceId]: progress } })),
  toggleSourceFilter: (id) =>
    set((s) => {
      const has = s.selectedSourceIds.includes(id)
      return { selectedSourceIds: has ? s.selectedSourceIds.filter((x) => x !== id) : [...s.selectedSourceIds, id] }
    }),
  clearSourceFilter: () => set({ selectedSourceIds: [] }),
}))
