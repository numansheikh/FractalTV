import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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

  // Recent searches
  recentSearches: string[]

  // View mode (grid vs list — live TV only)
  viewMode: 'grid' | 'list'

  // Browse page size
  pageSize: number

  // Sort
  sort: string

  // Home screen mode
  homeMode: 'discover' | 'channels'
  hasSeenChannelsModePrompt: boolean

  // Player settings
  minWatchSeconds: number

  // Actions
  setView: (view: ActiveView) => void
  setViewMode: (mode: 'grid' | 'list') => void
  setPageSize: (n: number) => void
  setSort: (s: string) => void
  setSelectedContent: (item: ContentItem | null) => void
  setPlayingContent: (item: ContentItem | null) => void
  setShowSettings: (v: boolean) => void
  setShowSources: (v: boolean) => void
  setTypeFilter: (type: ContentType) => void
  setCategoryFilter: (cat: string | null) => void
  toggleSourceFilter: (id: string) => void
  clearSourceFilter: () => void
  clearFilters: () => void
  addRecentSearch: (q: string) => void
  removeRecentSearch: (q: string) => void
  setHomeMode: (m: 'discover' | 'channels') => void
  setHasSeenChannelsModePrompt: (v: boolean) => void
  setMinWatchSeconds: (n: number) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeView: 'home',
      selectedContent: null,
      playingContent: null,
      showSettings: false,
      showSources: false,
      typeFilter: 'all',
      categoryFilter: '__favorites__',
      selectedSourceIds: [],
      recentSearches: [],
      viewMode: 'grid',
      pageSize: 500,
      sort: 'updated:desc',
      homeMode: 'discover',
      hasSeenChannelsModePrompt: false,
      minWatchSeconds: 5,

      setView: (activeView) => set({ activeView, categoryFilter: '__favorites__' }),
      setViewMode: (viewMode) => set({ viewMode }),
      setPageSize: (pageSize) => set({ pageSize }),
      setSort: (sort) => set({ sort }),
      setSelectedContent: (selectedContent) => set({ selectedContent }),
      setPlayingContent: (playingContent) => set({ playingContent }),
      setShowSettings: (showSettings) => set({ showSettings }),
      setShowSources: (showSources) => set({ showSources }),
      setTypeFilter: (typeFilter) => set({ typeFilter, categoryFilter: '__favorites__' }),
      setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
      toggleSourceFilter: (id) =>
        set((s) => ({
          selectedSourceIds: s.selectedSourceIds.includes(id)
            ? s.selectedSourceIds.filter((x) => x !== id)
            : [...s.selectedSourceIds, id],
        })),
      clearSourceFilter: () => set({ selectedSourceIds: [] }),
      clearFilters: () => set({ typeFilter: 'all', categoryFilter: '__favorites__', selectedSourceIds: [] }),
      addRecentSearch: (q) =>
        set((s) => ({
          recentSearches: [q, ...s.recentSearches.filter((r) => r !== q)].slice(0, 8),
        })),
      removeRecentSearch: (q) =>
        set((s) => ({ recentSearches: s.recentSearches.filter((r) => r !== q) })),
      setHomeMode: (homeMode) => set({ homeMode }),
      setHasSeenChannelsModePrompt: (hasSeenChannelsModePrompt) => set({ hasSeenChannelsModePrompt }),
      setMinWatchSeconds: (minWatchSeconds) => set({ minWatchSeconds }),
    }),
    {
      name: 'fractals-app',
      partialize: (s) => ({
        recentSearches: s.recentSearches,
        viewMode: s.viewMode,
        pageSize: s.pageSize,
        sort: s.sort,
        homeMode: s.homeMode,
        hasSeenChannelsModePrompt: s.hasSeenChannelsModePrompt,
        minWatchSeconds: s.minWatchSeconds,
      }),
    }
  )
)
