import { create } from 'zustand'

export interface Source {
  id: string
  type: 'xtream' | 'm3u'
  name: string
  serverUrl?: string
  status: 'active' | 'error' | 'syncing'
  disabled: boolean
  lastSync?: number
  lastError?: string
  itemCount: number
}

interface SourcesState {
  sources: Source[]
  /** Which source IDs are selected for filtering. Empty = all enabled sources. */
  selectedSourceIds: string[]
  setSources: (sources: Source[]) => void
  updateSource: (id: string, patch: Partial<Source>) => void
  toggleSourceFilter: (id: string) => void
  clearSourceFilter: () => void
}

export const useSourcesStore = create<SourcesState>((set) => ({
  sources: [],
  selectedSourceIds: [],
  setSources: (sources) => set({ sources }),
  updateSource: (id, patch) =>
    set((s) => ({ sources: s.sources.map((src) => (src.id === id ? { ...src, ...patch } : src)) })),
  toggleSourceFilter: (id) =>
    set((s) => {
      const has = s.selectedSourceIds.includes(id)
      return { selectedSourceIds: has ? s.selectedSourceIds.filter((x) => x !== id) : [...s.selectedSourceIds, id] }
    }),
  clearSourceFilter: () => set({ selectedSourceIds: [] }),
}))
