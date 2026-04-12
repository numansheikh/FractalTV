import { create } from 'zustand'
import { useAppStore } from '@/stores/app.store'

export type ContentType = 'all' | 'live' | 'movie' | 'series'

const DEBOUNCE_MS = 250
const MIN_SEARCH_CHARS = 2

interface SearchState {
  queries: Record<string, string>
  debouncedQueries: Record<string, string>
  lastQueries: Record<string, string>
  type: ContentType
  activeCategory: string | null

  setQuery: (query: string) => void
  seedQuery: (view: string, query: string) => void
  setType: (type: ContentType) => void
  setActiveCategory: (category: string | null) => void
  clearScope: () => void
}

const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}

export const useSearchStore = create<SearchState>((set) => ({
  queries: {},
  debouncedQueries: {},
  lastQueries: {},
  type: 'all',
  activeCategory: null,

  setQuery: (query) => {
    const view = useAppStore.getState().activeView
    set((s) => ({
      queries: { ...s.queries, [view]: query },
      lastQueries: query ? { ...s.lastQueries, [view]: query } : s.lastQueries,
    }))
    // Debounce the effective search query
    clearTimeout(debounceTimers[view])
    const effective = query.trim().length >= MIN_SEARCH_CHARS ? query : ''
    if (!effective) {
      // Clear immediately (no delay on empty/short)
      set((s) => ({ debouncedQueries: { ...s.debouncedQueries, [view]: '' } }))
    } else {
      debounceTimers[view] = setTimeout(() => {
        set((s) => ({ debouncedQueries: { ...s.debouncedQueries, [view]: effective } }))
      }, DEBOUNCE_MS)
    }
  },
  seedQuery: (view, query) => {
    // seedQuery is used for programmatic navigation — no debounce
    set((s) => ({
      queries: { ...s.queries, [view]: query },
      debouncedQueries: { ...s.debouncedQueries, [view]: query.trim().length >= MIN_SEARCH_CHARS ? query : '' },
      lastQueries: query ? { ...s.lastQueries, [view]: query } : s.lastQueries,
    }))
  },
  setType: (type) => {
    const view = useAppStore.getState().activeView
    set((s) => ({
      queries: { ...s.queries, [view]: '' },
      debouncedQueries: { ...s.debouncedQueries, [view]: '' },
      type,
      activeCategory: null,
    }))
  },
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  clearScope: () => set({ activeCategory: null }),
}))
