import { create } from 'zustand'

export interface Source {
  id: string
  type: 'xtream' | 'm3u'
  name: string
  serverUrl?: string
  status: 'active' | 'error' | 'syncing'
  lastSync?: number
  lastError?: string
  itemCount: number
}

interface SourcesState {
  sources: Source[]
  setSources: (sources: Source[]) => void
  updateSource: (id: string, patch: Partial<Source>) => void
}

export const useSourcesStore = create<SourcesState>((set) => ({
  sources: [],
  setSources: (sources) => set({ sources }),
  updateSource: (id, patch) =>
    set((s) => ({ sources: s.sources.map((src) => (src.id === id ? { ...src, ...patch } : src)) })),
}))
