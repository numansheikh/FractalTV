import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ContentItem, ActiveView, ContentType } from '@/lib/types'

interface AppState {
  // Navigation
  activeView: ActiveView
  previousView: ActiveView | null

  // Panel stack — topmost is active
  selectedContent: ContentItem | null
  playingContent: ContentItem | null
  showSettings: boolean
  showSources: boolean

  // Live TV — split view + channel surf context
  splitViewChannel: ContentItem | null
  channelSurfList: ContentItem[]
  channelSurfIndex: number
  surfSearchQuery: string | null

  // Filters (persisted per-view)
  typeFilter: ContentType
  categoryFilters: Record<string, string | null>
  selectedSourceIds: string[]

  // View mode (grid vs list — live TV only)
  liveViewMode: 'grid' | 'list'

  // Browse page size
  pageSize: number

  // Sort
  sort: string

  // Home screen mode
  homeMode: 'discover' | 'channels'
  hasSeenChannelsModePrompt: boolean
  homeStripSize: number

  // Player settings
  minWatchSeconds: number
  controlsMode: 'never' | 'auto-2' | 'auto-3' | 'auto-5' | 'always'

  // Player mode (persistent mount — controlled separately from playingContent)
  playerMode: 'hidden' | 'fullscreen' | 'mini'

  // Actions
  setView: (view: ActiveView) => void
  goBack: () => void
  setViewMode: (mode: 'grid' | 'list') => void
  setPageSize: (n: number) => void
  setSort: (s: string) => void
  setSelectedContent: (item: ContentItem | null) => void
  setPlayingContent: (item: ContentItem | null) => void
  setShowSettings: (v: boolean) => void
  setSplitViewChannel: (item: ContentItem | null) => void
  surfContextAction: 'home-discover' | 'home-channels' | 'browse-favorites' | 'search' | null
  setChannelSurfContext: (list: ContentItem[], index: number, action?: 'home-discover' | 'home-channels' | 'browse-favorites' | 'search' | null, searchQuery?: string | null) => void
  surfChannel: (dir: 1 | -1) => ContentItem | null
  setShowSources: (v: boolean) => void
  setTypeFilter: (type: ContentType) => void
  setCategoryFilter: (cat: string | null) => void
  toggleSourceFilter: (id: string) => void
  clearSourceFilter: () => void
  clearFilters: () => void
  setHomeMode: (m: 'discover' | 'channels') => void
  setHomeStripSize: (n: number) => void
  setHasSeenChannelsModePrompt: (v: boolean) => void
  setMinWatchSeconds: (n: number) => void
  setControlsMode: (m: 'never' | 'auto-2' | 'auto-3' | 'auto-5' | 'always') => void
  setPlayerMode: (m: 'hidden' | 'fullscreen' | 'mini') => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeView: 'home',
      previousView: null,
      selectedContent: null,
      playingContent: null,
      showSettings: false,
      showSources: false,
      splitViewChannel: null,
      channelSurfList: [],
      channelSurfIndex: -1,
      surfContextAction: null,
      surfSearchQuery: null,
      typeFilter: 'all',
      categoryFilters: {},
      selectedSourceIds: [],
      liveViewMode: 'grid',
      pageSize: 60,
      sort: 'updated:desc',
      homeMode: 'discover',
      hasSeenChannelsModePrompt: false,
      homeStripSize: 10,
      minWatchSeconds: 5,
      controlsMode: 'auto-3',
      playerMode: 'hidden',

      setView: (activeView) => set((s) => ({ activeView, previousView: s.activeView })),
      goBack: () => set((s) => ({ activeView: s.previousView ?? 'home', previousView: null })),
      setViewMode: (liveViewMode) => set({ liveViewMode }),
      setPageSize: (pageSize) => set({ pageSize }),
      setSort: (sort) => set({ sort }),
      setSelectedContent: (selectedContent) => set({ selectedContent }),
      setPlayingContent: (playingContent) => set({ playingContent }),
      setShowSettings: (showSettings) => set({ showSettings }),
      setSplitViewChannel: (splitViewChannel) => set({ splitViewChannel }),
      setChannelSurfContext: (channelSurfList, channelSurfIndex, action, searchQuery) => set({ channelSurfList, channelSurfIndex, surfContextAction: action ?? null, surfSearchQuery: searchQuery ?? null }),
      surfChannel: (dir) => {
        let result: ContentItem | null = null
        set((s) => {
          if (s.channelSurfList.length === 0) return s
          const currentId = (s.playingContent ?? s.splitViewChannel)?.id
          let idx = s.channelSurfList.findIndex((c) => c.id === currentId)
          if (idx === -1) idx = s.channelSurfIndex
          const next = (idx + dir + s.channelSurfList.length) % s.channelSurfList.length
          result = s.channelSurfList[next]
          return { channelSurfIndex: next }
        })
        return result
      },
      setShowSources: (showSources) => set({ showSources }),
      setTypeFilter: (typeFilter) => set({ typeFilter }),
      setCategoryFilter: (cat) => set((s) => ({ categoryFilters: { ...s.categoryFilters, [s.activeView]: cat } })),
      toggleSourceFilter: (id) =>
        set((s) => ({
          selectedSourceIds: s.selectedSourceIds.includes(id)
            ? s.selectedSourceIds.filter((x) => x !== id)
            : [...s.selectedSourceIds, id],
        })),
      clearSourceFilter: () => set({ selectedSourceIds: [] }),
      clearFilters: () => set({ typeFilter: 'all', categoryFilters: {}, selectedSourceIds: [] }),
      setHomeMode: (homeMode) => set({ homeMode }),
      setHomeStripSize: (homeStripSize) => set({ homeStripSize }),
      setHasSeenChannelsModePrompt: (hasSeenChannelsModePrompt) => set({ hasSeenChannelsModePrompt }),
      setMinWatchSeconds: (minWatchSeconds) => set({ minWatchSeconds }),
      setControlsMode: (controlsMode) => set({ controlsMode }),
      setPlayerMode: (playerMode) => set({ playerMode }),
    }),
    {
      name: 'fractals-app',
      partialize: (s) => ({
        categoryFilters: s.categoryFilters,
        liveViewMode: s.liveViewMode,
        pageSize: s.pageSize,
        sort: s.sort,
        homeMode: s.homeMode,
        hasSeenChannelsModePrompt: s.hasSeenChannelsModePrompt,
        homeStripSize: s.homeStripSize,
        minWatchSeconds: s.minWatchSeconds,
        controlsMode: s.controlsMode,
      }),
    }
  )
)
