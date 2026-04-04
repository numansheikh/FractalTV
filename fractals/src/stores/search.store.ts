import { create } from 'zustand'

export type ContentType = 'all' | 'live' | 'movie' | 'series'

interface SearchState {
  query: string
  type: ContentType
  activeCategory: string | null

  setQuery: (query: string) => void
  setType: (type: ContentType) => void
  setActiveCategory: (category: string | null) => void
  clearScope: () => void
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  type: 'all',
  activeCategory: null,

  setQuery: (query) => set({ query }),
  setType: (type) => set({ type, query: '', activeCategory: null }),
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  clearScope: () => set({ activeCategory: null }),
}))
