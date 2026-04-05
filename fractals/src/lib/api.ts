// Typed wrapper around window.api (the contextBridge IPC interface)
// Falls back gracefully when running in browser without Electron

const isElectron = typeof window !== 'undefined' && !!window.api

export const api = {
  sources: {
    list: (): Promise<any[]> =>
      isElectron ? window.api.sources.list() : Promise.resolve([]),

    addXtream: (args: { name: string; serverUrl: string; username: string; password: string }) =>
      isElectron ? window.api.sources.addXtream(args) : Promise.resolve({ success: false, error: 'Not in Electron' }),

    testXtream: (args: { serverUrl: string; username: string; password: string }) =>
      isElectron ? window.api.sources.testXtream(args) : Promise.resolve({ success: false }),

    remove: (sourceId: string) =>
      isElectron ? window.api.sources.remove(sourceId) : Promise.resolve({ success: false }),

    update: (args: { sourceId: string; name?: string; serverUrl?: string; username?: string; password?: string }) =>
      isElectron ? (window.api as any).sources.update(args) : Promise.resolve({ success: false }),

    toggleDisabled: (sourceId: string) =>
      isElectron ? window.api.sources.toggleDisabled(sourceId) : Promise.resolve({ disabled: false }),

    sync: (sourceId: string) =>
      isElectron ? window.api.sources.sync(sourceId) : Promise.resolve({ success: false }),

    accountInfo: (sourceId: string) =>
      isElectron ? window.api.sources.accountInfo(sourceId) : Promise.resolve(null),

    startupCheck: () =>
      isElectron ? window.api.sources.startupCheck() : Promise.resolve(null),

    totalCount: (): Promise<number> =>
      isElectron ? (window.api as any).sources.totalCount() : Promise.resolve(0),
  },

  categories: {
    list: (args: { type?: 'live' | 'movie' | 'series'; sourceIds?: string[] }) =>
      isElectron ? window.api.categories.list(args) : Promise.resolve([]),
  },

  search: {
    query: (args: { query: string; type?: 'live' | 'movie' | 'series'; categoryName?: string; sourceIds?: string[]; limit?: number; offset?: number }) =>
      isElectron ? window.api.search.query(args) : Promise.resolve([]),
  },

  content: {
    get: (contentId: string) =>
      isElectron ? window.api.content.get(contentId) : Promise.resolve(null),

    getStreamUrl: (args: { contentId: string; sourceId?: string }) =>
      isElectron ? window.api.content.getStreamUrl(args) : Promise.resolve({ error: 'Not in Electron' }),

    browse: (args: { type?: 'live' | 'movie' | 'series'; categoryName?: string; sourceIds?: string[]; sortBy?: string; sortDir?: string; limit?: number; offset?: number }) =>
      isElectron ? window.api.content.browse(args) : Promise.resolve({ items: [], total: 0 }),
  },

  user: {
    getData: (contentId: string) =>
      isElectron ? window.api.user.getData(contentId) : Promise.resolve(null),

    setPosition: (contentId: string, position: number) =>
      isElectron ? window.api.user.setPosition(contentId, position) : Promise.resolve(null),

    toggleFavorite: (contentId: string) =>
      isElectron ? window.api.user.toggleFavorite(contentId) : Promise.resolve({ favorite: false }),

    toggleWatchlist: (contentId: string) =>
      isElectron ? window.api.user.toggleWatchlist(contentId) : Promise.resolve({ watchlist: false }),

    favorites: (args?: { type?: 'live' | 'movie' | 'series' }) =>
      isElectron ? (window.api as any).user.favorites(args) : Promise.resolve([]),

    watchlist: (args?: { type?: 'live' | 'movie' | 'series' }) =>
      isElectron ? (window.api as any).user.watchlist(args) : Promise.resolve([]),

    continueWatching: () =>
      isElectron ? (window.api as any).user.continueWatching() : Promise.resolve([]),

    history: (args?: { limit?: number }) =>
      isElectron ? (window.api as any).user.history(args) : Promise.resolve([]),

    bulkGetData: (contentIds: string[]): Promise<Record<string, any>> =>
      isElectron ? (window.api as any).user.bulkGetData(contentIds) : Promise.resolve({}),

    setCompleted: (contentId: string) =>
      isElectron ? (window.api as any).user.setCompleted(contentId) : Promise.resolve({ success: true }),

    setRating: (contentId: string, rating: number | null) =>
      isElectron ? (window.api as any).user.setRating(contentId, rating) : Promise.resolve({ success: true }),
  },

  player: {
    openExternal: (args: { player: 'mpv' | 'vlc'; url: string; title: string; customPath?: string }) =>
      isElectron ? window.api.player.openExternal(args) : Promise.resolve({ success: false }),
    detectExternal: () =>
      isElectron ? window.api.player.detectExternal() : Promise.resolve({ mpv: 'mpv', vlc: 'vlc' }),
  },

  enrichment: {
    setApiKey: (key: string) =>
      isElectron ? window.api.enrichment.setApiKey(key) : Promise.resolve({ success: false }),
    status: () =>
      isElectron ? window.api.enrichment.status() : Promise.resolve({ total: 0, enriched: 0, pending: 0 }),
    start: (apiKey?: string) =>
      isElectron ? window.api.enrichment.start(apiKey) : Promise.resolve({ success: false }),
    enrichSingle: (contentId: string) =>
      isElectron ? (window.api as any).enrichment.enrichSingle(contentId) : Promise.resolve({ success: false }),
    enrichManual: (args: { contentId: string; title: string; year?: number }) =>
      isElectron ? (window.api as any).enrichment.enrichManual(args) : Promise.resolve({ success: false }),
    searchTmdb: (args: { title: string; year?: number; type: 'movie' | 'series' }) =>
      isElectron ? (window.api as any).enrichment.searchTmdb(args) : Promise.resolve({ success: false }),
    enrichById: (args: { contentId: string; tmdbId: number }) =>
      isElectron ? (window.api as any).enrichment.enrichById(args) : Promise.resolve({ success: false }),
  },

  series: {
    getInfo: (contentId: string) =>
      isElectron ? (window.api as any).series.getInfo(contentId) : Promise.resolve({ seasons: {} }),
  },

  settings: {
    get: (key: string): Promise<string | null> =>
      isElectron ? (window.api as any).settings.get(key) : Promise.resolve(null),
  },

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (isElectron) return window.api.on(channel, callback)
    return () => {}
  },
}
