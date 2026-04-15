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

    test: (sourceId: string): Promise<any> =>
      isElectron ? (window.api as any).sources.test(sourceId) : Promise.resolve({ success: false, error: 'Not in Electron' }),

    addM3u: (args: { name: string; m3uUrl: string }): Promise<{ id: string; error?: string }> =>
      isElectron ? (window.api as any).sources.addM3u(args) : Promise.resolve({ id: '', error: 'Not in Electron' }),

    testM3u: (args: { m3uUrl: string }): Promise<{ count: number; error?: string }> =>
      isElectron ? (window.api as any).sources.testM3u(args) : Promise.resolve({ count: 0, error: 'Not in Electron' }),

    remove: (sourceId: string) =>
      isElectron ? window.api.sources.remove(sourceId) : Promise.resolve({ success: false }),

    update: (args: { sourceId: string; name?: string; serverUrl?: string; username?: string; password?: string; m3uUrl?: string }) =>
      isElectron ? (window.api as any).sources.update(args) : Promise.resolve({ success: false }),

    toggleDisabled: (sourceId: string) =>
      isElectron ? window.api.sources.toggleDisabled(sourceId) : Promise.resolve({ disabled: false }),

    setColor: (sourceId: string, colorIndex: number) =>
      isElectron ? (window.api as any).sources.setColor(sourceId, colorIndex) : Promise.resolve({ ok: true }),

    sync: (sourceId: string) =>
      isElectron ? window.api.sources.sync(sourceId) : Promise.resolve({ success: false }),

    syncEpg: (sourceId: string): Promise<{ success: boolean; inserted?: number; error?: string }> =>
      isElectron ? (window.api as any).sources.syncEpg(sourceId) : Promise.resolve({ success: false, error: 'Not in Electron' }),

    cancelSync: (sourceId: string) =>
      isElectron ? (window.api as any).sources.cancelSync(sourceId) : Promise.resolve({ ok: true }),

    accountInfo: (sourceId: string) =>
      isElectron ? window.api.sources.accountInfo(sourceId) : Promise.resolve(null),

    startupCheck: () =>
      isElectron ? window.api.sources.startupCheck() : Promise.resolve(null),

    totalCount: (): Promise<number> =>
      isElectron ? (window.api as any).sources.totalCount() : Promise.resolve(0),

    exportBackup: (opts?: { includeUserData?: boolean }): Promise<{ canceled: boolean; count?: number }> =>
      isElectron ? (window.api as any).sources.exportBackup(opts) : Promise.resolve({ canceled: true }),

    import: (filePath: string): Promise<{ ok?: boolean; count?: number; error?: string }> =>
      isElectron ? (window.api as any).sources.import(filePath) : Promise.resolve({ error: 'Not in Electron' }),

    factoryReset: (): Promise<{ ok: boolean }> =>
      isElectron ? (window.api as any).sources.factoryReset() : Promise.resolve({ ok: false }),
  },

  categories: {
    list: (args: { type?: 'live' | 'movie' | 'series'; sourceIds?: string[] }) =>
      isElectron ? window.api.categories.list(args) : Promise.resolve([]),
    setNsfw: (id: string, value: 0 | 1): Promise<{ ok: boolean }> =>
      isElectron ? (window.api as any).categories.setNsfw(id, value) : Promise.resolve({ ok: false }),
  },

  search: {
    query: (args: { query: string; type?: 'live' | 'movie' | 'series'; categoryName?: string; sourceIds?: string[]; limit?: number; offset?: number; skipCount?: boolean }): Promise<{ items: any[], total: number }> =>
      isElectron ? window.api.search.query(args) : Promise.resolve({ items: [], total: 0 }),
  },

  content: {
    get: (contentId: string) =>
      isElectron ? window.api.content.get(contentId) : Promise.resolve(null),

    getStreamUrl: (args: { contentId: string; sourceId?: string }) =>
      isElectron ? window.api.content.getStreamUrl(args) : Promise.resolve({ error: 'Not in Electron' }),

    getCatchupUrl: (args: { contentId: string; startTime: number; duration: number }): Promise<{ url?: string; error?: string }> =>
      isElectron ? (window.api as any).content.getCatchupUrl(args) : Promise.resolve({ error: 'Not in Electron' }),

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

    continueWatching: (args?: { type?: 'movie' | 'series' }) =>
      isElectron ? (window.api as any).user.continueWatching(args) : Promise.resolve([]),

    history: (args?: { limit?: number }) =>
      isElectron ? (window.api as any).user.history(args) : Promise.resolve([]),

    bulkGetData: (contentIds: string[]): Promise<Record<string, any>> =>
      isElectron ? (window.api as any).user.bulkGetData(contentIds) : Promise.resolve({}),

    setCompleted: (contentId: string) =>
      isElectron ? (window.api as any).user.setCompleted(contentId) : Promise.resolve({ success: true }),

    setRating: (contentId: string, rating: number | null) =>
      isElectron ? (window.api as any).user.setRating(contentId, rating) : Promise.resolve({ success: true }),
    clearContinue: (contentId: string) =>
      isElectron ? (window.api as any).user.clearContinue(contentId) : Promise.resolve({ success: true }),
    clearItemHistory: (contentId: string) =>
      isElectron ? (window.api as any).user.clearItemHistory(contentId) : Promise.resolve({ success: true }),
    clearHistory: () =>
      isElectron ? (window.api as any).user.clearHistory() : Promise.resolve({ success: true }),
    clearFavorites: () =>
      isElectron ? (window.api as any).user.clearFavorites() : Promise.resolve({ success: true }),
    clearAllData: () =>
      isElectron ? (window.api as any).user.clearAllData() : Promise.resolve({ success: true }),

    reorderFavorites: (order: { contentId: string; sortOrder: number }[]) =>
      isElectron ? (window.api as any).user.reorderFavorites(order) : Promise.resolve({ ok: true }),
  },

  channels: {
    favorites: (args?: { profileId?: string }): Promise<any[]> =>
      isElectron ? (window.api as any).channels.favorites(args) : Promise.resolve([]),
    toggleFavorite: (canonicalId: string): Promise<{ favorite: boolean }> =>
      isElectron ? (window.api as any).channels.toggleFavorite(canonicalId) : Promise.resolve({ favorite: false }),
    reorderFavorites: (order: { canonicalId: string; sortOrder: number }[]): Promise<{ ok: boolean }> =>
      isElectron ? (window.api as any).channels.reorderFavorites(order) : Promise.resolve({ ok: false }),
    getData: (canonicalId: string) =>
      isElectron ? (window.api as any).channels.getData(canonicalId) : Promise.resolve({ favorite: false, watchlisted: false, rating: null, position: 0, completed: false }),
    siblings: (channelId: string): Promise<{ id: string; title: string; source_id: string }[]> =>
      isElectron ? (window.api as any).channels.siblings(channelId) : Promise.resolve([]),
  },

  player: {
    openExternal: (args: { player: 'mpv' | 'vlc'; url: string; title: string; customPath?: string }) =>
      isElectron ? window.api.player.openExternal(args) : Promise.resolve({ success: false }),
    detectExternal: () =>
      isElectron ? window.api.player.detectExternal() : Promise.resolve({ mpv: 'mpv', vlc: 'vlc' }),
  },

  enrichment: {
    status: () =>
      isElectron ? window.api.enrichment.status() : Promise.resolve({ total: 0, enriched: 0, pending: 0 }),
    start: () =>
      isElectron ? window.api.enrichment.start() : Promise.resolve({ success: false }),
  },

  epg: {
    nowNext: (contentId: string): Promise<{ now: any; next: any }> =>
      isElectron ? (window.api as any).epg.nowNext(contentId) : Promise.resolve({ now: null, next: null }),
    guide: (args: { contentIds: string[]; startTime?: number; endTime?: number }): Promise<{
      channels: { contentId: string; title: string; posterUrl?: string; sourceId: string; catchupSupported: boolean; catchupDays: number; externalId: string }[]
      programmes: Record<string, { id: string; title: string; description?: string; startTime: number; endTime: number; category?: string }[]>
      windowStart: number
      windowEnd: number
    }> =>
      isElectron ? (window.api as any).epg.guide(args) : Promise.resolve({ channels: [], programmes: {}, windowStart: 0, windowEnd: 0 }),
  },

  series: {
    getInfo: (contentId: string) =>
      isElectron ? (window.api as any).series.getInfo(contentId) : Promise.resolve({ seasons: {} }),
  },

  settings: {
    get: (key: string): Promise<string | null> =>
      isElectron ? (window.api as any).settings.get(key) : Promise.resolve(null),
    set: (key: string, value: string): Promise<{ ok: boolean }> =>
      isElectron ? (window.api as any).settings.set(key, value) : Promise.resolve({ ok: false }),
  },

  iptvOrg: {
    pull: (): Promise<{ ok: boolean; count?: number; error?: string }> =>
      isElectron ? (window.api as any).iptvOrg.pull() : Promise.resolve({ ok: false, error: 'Not in Electron' }),
    status: (): Promise<{ count: number; lastRefreshedAt: number | null }> =>
      isElectron ? (window.api as any).iptvOrg.status() : Promise.resolve({ count: 0, lastRefreshedAt: null }),
    matchSource: (sourceId: string): Promise<{ ok: boolean; considered?: number; matched?: number; error?: string }> =>
      isElectron ? (window.api as any).iptvOrg.matchSource(sourceId) : Promise.resolve({ ok: false, error: 'Not in Electron' }),
  },

  dialog: {
    openFile: (args?: { filters?: { name: string; extensions: string[] }[] }): Promise<{ canceled: boolean; filePath?: string }> =>
      isElectron ? (window.api as any).dialog.openFile(args) : Promise.resolve({ canceled: true }),
  },

  window: {
    toggleFullscreen: (): Promise<void> =>
      isElectron ? (window.api as any).window.toggleFullscreen() : Promise.resolve(),
    isFullscreen: (): Promise<boolean> =>
      isElectron ? (window.api as any).window.isFullscreen() : Promise.resolve(false),
  },

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (isElectron) return window.api.on(channel, callback)
    return () => {}
  },
}
