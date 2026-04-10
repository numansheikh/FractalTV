import { create } from 'zustand'
import { useAppStore } from '@/stores/app.store'

export type ContentType = 'all' | 'live' | 'movie' | 'series'

interface SearchState {
  queries: Record<string, string>
  lastQueries: Record<string, string>
  type: ContentType
  activeCategory: string | null

  setQuery: (query: string) => void
  seedQuery: (view: string, query: string) => void
  setType: (type: ContentType) => void
  setActiveCategory: (category: string | null) => void
  clearScope: () => void
}

export const useSearchStore = create<SearchState>((set) => ({
  queries: {},
  lastQueries: {},
  type: 'all',
  activeCategory: null,

  setQuery: (query) => {
    const view = useAppStore.getState().activeView
    set((s) => ({
      queries: { ...s.queries, [view]: query },
      lastQueries: query ? { ...s.lastQueries, [view]: query } : s.lastQueries,
    }))
  },
  seedQuery: (view, query) => {
    set((s) => ({
      queries: { ...s.queries, [view]: query },
      lastQueries: query ? { ...s.lastQueries, [view]: query } : s.lastQueries,
    }))
  },
  setType: (type) => {
    const view = useAppStore.getState().activeView
    set((s) => ({ queries: { ...s.queries, [view]: '' }, type, activeCategory: null }))
  },
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  clearScope: () => set({ activeCategory: null }),
}))
