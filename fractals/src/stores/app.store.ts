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

  // Live TV — split view + channel surf context
  splitViewChannel: ContentItem | null
  channelSurfList: ContentItem[]
  channelSurfIndex: number

  // Filters (persisted across navigation)
  typeFilter: ContentType
  categoryFilter: string | null
  selectedSourceIds: string[]

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
  controlsMode: 'never' | 'auto-2' | 'auto-3' | 'auto-5' | 'always'

  // Actions
  setView: (view: ActiveView) => void
  setViewMode: (mode: 'grid' | 'list') => void
  setPageSize: (n: number) => void
  setSort: (s: string) => void
  setSelectedContent: (item: ContentItem | null) => void
  setPlayingContent: (item: ContentItem | null) => void
  setShowSettings: (v: boolean) => void
  setSplitViewChannel: (item: ContentItem | null) => void
  setChannelSurfContext: (list: ContentItem[], index: number) => void
  surfChannel: (dir: 1 | -1) => ContentItem | null
  setShowSources: (v: boolean) => void
  setTypeFilter: (type: ContentType) => void
  setCategoryFilter: (cat: string | null) => void
  toggleSourceFilter: (id: string) => void
  clearSourceFilter: () => void
  clearFilters: () => void
  setHomeMode: (m: 'discover' | 'channels') => void
  setHasSeenChannelsModePrompt: (v: boolean) => void
  setMinWatchSeconds: (n: number) => void
  setControlsMode: (m: 'never' | 'auto-2' | 'auto-3' | 'auto-5' | 'always') => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeView: 'home',
      selectedContent: null,
      playingContent: null,
      showSettings: false,
      showSources: false,
      splitViewChannel: null,
      channelSurfList: [],
      channelSurfIndex: -1,
      typeFilter: 'all',
      categoryFilter: null,
      selectedSourceIds: [],
      viewMode: 'grid',
      pageSize: 500,
      sort: 'updated:desc',
      homeMode: 'discover',
      hasSeenChannelsModePrompt: false,
      minWatchSeconds: 5,
      controlsMode: 'auto-3',

      setView: (activeView) => set({ activeView, categoryFilter: null }),
      setViewMode: (viewMode) => set({ viewMode }),
      setPageSize: (pageSize) => set({ pageSize }),
      setSort: (sort) => set({ sort }),
      setSelectedContent: (selectedContent) => set({ selectedContent }),
      setPlayingContent: (playingContent) => set({ playingContent }),
      setShowSettings: (showSettings) => set({ showSettings }),
      setSplitViewChannel: (splitViewChannel) => set({ splitViewChannel }),
      setChannelSurfContext: (channelSurfList, channelSurfIndex) => set({ channelSurfList, channelSurfIndex }),
      surfChannel: (dir) => {
        const { channelSurfList, channelSurfIndex, splitViewChannel, playingContent } = useAppStore.getState()
        if (channelSurfList.length === 0) return null
        const currentId = (playingContent ?? splitViewChannel)?.id
        let idx = channelSurfList.findIndex((c) => c.id === currentId)
        if (idx === -1) idx = channelSurfIndex
        const next = (idx + dir + channelSurfList.length) % channelSurfList.length
        const nextChannel = channelSurfList[next]
        set({ channelSurfIndex: next })
        return nextChannel
      },
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
      setHomeMode: (homeMode) => set({ homeMode }),
      setHasSeenChannelsModePrompt: (hasSeenChannelsModePrompt) => set({ hasSeenChannelsModePrompt }),
      setMinWatchSeconds: (minWatchSeconds) => set({ minWatchSeconds }),
      setControlsMode: (controlsMode) => set({ controlsMode }),
    }),
    {
      name: 'fractals-app',
      partialize: (s) => ({
        activeView: s.activeView,
        categoryFilter: s.categoryFilter,
        viewMode: s.viewMode,
        pageSize: s.pageSize,
        sort: s.sort,
        homeMode: s.homeMode,
        hasSeenChannelsModePrompt: s.hasSeenChannelsModePrompt,
        minWatchSeconds: s.minWatchSeconds,
        controlsMode: s.controlsMode,
      }),
    }
  )
)
