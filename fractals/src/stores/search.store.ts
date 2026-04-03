import { create } from 'zustand'

export type ContentType = 'all' | 'live' | 'movie' | 'series'

interface SearchState {
  query: string
  type: ContentType
  setQuery: (query: string) => void
  setType: (type: ContentType) => void
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  type: 'all',
  setQuery: (query) => set({ query }),
  setType: (type) => set({ type }),
}))
