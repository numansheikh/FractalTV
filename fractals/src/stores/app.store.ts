import { create } from 'zustand'
import { ContentItem, ActiveView, ContentType } from '@/lib/types'

interface AppState {
  // Navigation
  activeView: ActiveView

  // Panel stack — topmost is active
  selectedContent: ContentItem | null
  playingContent: ContentItem | null
  showSettings: boolean
  showSources: boolean

  // Filters (persisted across navigation)
  typeFilter: ContentType
  categoryFilter: string | null
  selectedSourceIds: string[]

  // Actions
  setView: (view: ActiveView) => void
  setSelectedContent: (item: ContentItem | null) => void
  setPlayingContent: (item: ContentItem | null) => void
  setShowSettings: (v: boolean) => void
  setShowSources: (v: boolean) => void
  setTypeFilter: (type: ContentType) => void
  setCategoryFilter: (cat: string | null) => void
  toggleSourceFilter: (id: string) => void
  clearSourceFilter: () => void
  clearFilters: () => void
}

export const useAppStore = create<AppState>((set) => ({
  activeView: 'home',
  selectedContent: null,
  playingContent: null,
  showSettings: false,
  showSources: false,
  typeFilter: 'all',
  categoryFilter: null,
  selectedSourceIds: [],

  setView: (activeView) => set({ activeView, categoryFilter: null }),
  setSelectedContent: (selectedContent) => set({ selectedContent }),
  setPlayingContent: (playingContent) => set({ playingContent }),
  setShowSettings: (showSettings) => set({ showSettings }),
  setShowSources: (showSources) => set({ showSources }),
  setTypeFilter: (typeFilter) => set({ typeFilter, categoryFilter: null }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  toggleSourceFilter: (id) =>
    set((s) => ({
      selectedSourceIds: s.selectedSourceIds.includes(id)
        ? s.selectedSourceIds.filter((x) => x !== id)
        : [...s.selectedSourceIds, id],
    })),
  clearSourceFilter: () => set({ selectedSourceIds: [] }),
  clearFilters: () => set({ typeFilter: 'all', categoryFilter: null, selectedSourceIds: [] }),
}))
