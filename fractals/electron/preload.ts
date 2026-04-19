import { contextBridge, ipcRenderer } from 'electron'

export const api = {
  // Health
  ping: () => ipcRenderer.invoke('ping'),

  // Sources
  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
    addXtream: (args: { name: string; serverUrl: string; username: string; password: string }) =>
      ipcRenderer.invoke('sources:add-xtream', args),
    testXtream: (args: { serverUrl: string; username: string; password: string }) =>
      ipcRenderer.invoke('sources:test-xtream', args),
    test: (sourceId: string) => ipcRenderer.invoke('sources:test', sourceId),
    addM3u: (args: { name: string; m3uUrl: string }) =>
      ipcRenderer.invoke('sources:add-m3u', args),
    testM3u: (args: { m3uUrl: string }) =>
      ipcRenderer.invoke('sources:test-m3u', args),
    remove: (sourceId: string) => ipcRenderer.invoke('sources:remove', sourceId),
    update: (args: { sourceId: string; name?: string; serverUrl?: string; username?: string; password?: string; m3uUrl?: string }) =>
      ipcRenderer.invoke('sources:update', args),
    toggleDisabled: (sourceId: string) => ipcRenderer.invoke('sources:toggle-disabled', sourceId),
    setColor: (sourceId: string, colorIndex: number) => ipcRenderer.invoke('sources:set-color', sourceId, colorIndex),
    sync: (sourceId: string) => ipcRenderer.invoke('sources:sync', sourceId),
    syncEpg: (sourceId: string) => ipcRenderer.invoke('sources:sync-epg', sourceId),
    cancelSync: (sourceId: string) => ipcRenderer.invoke('sources:sync:cancel', sourceId),
    accountInfo: (sourceId: string) => ipcRenderer.invoke('sources:account-info', sourceId),
    startupCheck: () => ipcRenderer.invoke('sources:startup-check'),
    totalCount: () => ipcRenderer.invoke('sources:total-count'),
    exportBackup: (opts?: { includeUserData?: boolean }) => ipcRenderer.invoke('sources:export', opts),
    import: (filePath: string) => ipcRenderer.invoke('sources:import', filePath),
    factoryReset: () => ipcRenderer.invoke('sources:factory-reset'),
  },

  // Categories
  categories: {
    list: (args: { type?: 'live' | 'movie' | 'series'; sourceIds?: string[] }) =>
      ipcRenderer.invoke('categories:list', args),
    setNsfw: (id: string, value: 0 | 1) =>
      ipcRenderer.invoke('categories:set-nsfw', id, value),
  },

  // Search
  search: {
    query: (args: { query: string; type?: 'live' | 'movie' | 'series'; sourceIds?: string[]; limit?: number; offset?: number }) =>
      ipcRenderer.invoke('search:query', args),
  },

  // Content
  content: {
    get: (contentId: string) => ipcRenderer.invoke('content:get', contentId),
    getStreamUrl: (args: { contentId: string; sourceId?: string }) =>
      ipcRenderer.invoke('content:get-stream-url', args),
    getCatchupUrl: (args: { contentId: string; startTime: number; duration: number }) =>
      ipcRenderer.invoke('content:get-catchup-url', args),
    browse: (args: { type?: 'live' | 'movie' | 'series'; categoryName?: string; sourceIds?: string[]; sortBy?: string; sortDir?: string; limit?: number; offset?: number }) =>
      ipcRenderer.invoke('content:browse', args),
    getVodInfo: (args: { contentId: string }) =>
      ipcRenderer.invoke('content:get-vod-info', args),
  },

  // Series
  series: {
    getInfo: (contentId: string) => ipcRenderer.invoke('series:get-info', { contentId }),
  },

  // User data
  user: {
    getData: (contentId: string) => ipcRenderer.invoke('user:get-data', contentId),
    setPosition: (contentId: string, position: number) =>
      ipcRenderer.invoke('user:set-position', { contentId, position }),
    toggleFavorite: (contentId: string) => ipcRenderer.invoke('user:toggle-favorite', contentId),
    toggleWatchlist: (contentId: string) => ipcRenderer.invoke('user:toggle-watchlist', contentId),
    favorites: (args?: { type?: 'live' | 'movie' | 'series' }) =>
      ipcRenderer.invoke('user:favorites', args),
    watchlist: (args?: { type?: 'live' | 'movie' | 'series' }) =>
      ipcRenderer.invoke('user:watchlist', args),
    continueWatching: (args?: { type?: 'movie' | 'series' }) => ipcRenderer.invoke('user:continue-watching', args),
    history: (args?: { limit?: number }) => ipcRenderer.invoke('user:history', args),
    bulkGetData: (contentIds: string[]) => ipcRenderer.invoke('user:bulk-get-data', contentIds),
    setCompleted: (contentId: string) => ipcRenderer.invoke('user:set-completed', contentId),
    setRating: (contentId: string, rating: number | null) =>
      ipcRenderer.invoke('user:set-rating', { contentId, rating }),
    clearContinue: (contentId: string) =>
      ipcRenderer.invoke('user:clear-continue', contentId),
    clearItemHistory: (contentId: string) =>
      ipcRenderer.invoke('user:clear-item-history', contentId),
    clearHistory: () => ipcRenderer.invoke('user:clear-history'),
    clearFavorites: () => ipcRenderer.invoke('user:clear-favorites'),
    clearAllData: () => ipcRenderer.invoke('user:clear-all-data'),
    reorderFavorites: (order: { contentId: string; sortOrder: number }[]) =>
      ipcRenderer.invoke('user:reorder-favorites', order),
  },

  // Channels (new schema — Phase A)
  channels: {
    favorites: (args?: { profileId?: string }) =>
      ipcRenderer.invoke('channels:favorites', args),
    toggleFavorite: (canonicalId: string) =>
      ipcRenderer.invoke('channels:toggle-favorite', canonicalId),
    reorderFavorites: (order: { canonicalId: string; sortOrder: number }[]) =>
      ipcRenderer.invoke('channels:reorder-favorites', order),
    getData: (canonicalId: string) =>
      ipcRenderer.invoke('channels:get-data', canonicalId),
    siblings: (channelId: string) =>
      ipcRenderer.invoke('channels:siblings', channelId),
  },

  // External player
  player: {
    openExternal: (args: { player: 'mpv' | 'vlc'; url: string; title: string; customPath?: string; headers?: Record<string, string> }) =>
      ipcRenderer.invoke('player:open-external', args),
    detectExternal: () => ipcRenderer.invoke('player:detect-external'),
  },

  // EPG
  epg: {
    nowNext: (contentId: string) => ipcRenderer.invoke('epg:now-next', contentId),
    guide: (args: { contentIds: string[]; startTime?: number; endTime?: number }) =>
      ipcRenderer.invoke('epg:guide', args),
    fetchShort: (contentId: string) => ipcRenderer.invoke('epg:fetch-short', contentId),
  },

  // Dialog
  dialog: {
    openFile: (args?: { filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('dialog:open-file', args),
    saveFile: (args?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('dialog:save-file', args),
  },

  // Export playlist
  export: {
    buildTree: () => ipcRenderer.invoke('export:build-tree'),
    pickFile: () => ipcRenderer.invoke('export:pick-file'),
    run: (args: {
      selection: {
        favoritesChannels: boolean
        favoritesMovies: boolean
        favoritesSeries: boolean
        channelCategoryIds: Array<{ sourceId: string; categoryId: string }>
        movieCategoryIds: Array<{ sourceId: string; categoryId: string }>
        seriesCategoryIds: Array<{ sourceId: string; categoryId: string }>
      }
      outputPath: string
    }) => ipcRenderer.invoke('export:run', args),
    reveal: (filePath: string) => ipcRenderer.invoke('export:reveal', filePath),
    onProgress: (cb: (progress: { phase: string; current: number; total: number; message: string }) => void) => {
      const handler = (_e: unknown, progress: any) => cb(progress)
      ipcRenderer.on('export:progress', handler)
      return () => ipcRenderer.removeListener('export:progress', handler)
    },
  },

  // Window
  window: {
    toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
    isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),
  },

  // Debug
  debug: {
    categoryItems: (search: string) => ipcRenderer.invoke('debug:category-items', search),
  },

  // Settings (key-value store)
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  },

  // iptv-org reference database (independent module)
  iptvOrg: {
    pull: () => ipcRenderer.invoke('iptvOrg:pull'),
    status: () => ipcRenderer.invoke('iptvOrg:status'),
  },

  // VoD enrichment (g2 — keyless)
  vodEnrich: {
    status: () => ipcRenderer.invoke('vodEnrich:status'),
    enrich: (sourceId: string, force?: boolean) => ipcRenderer.invoke('vodEnrich:enrich', sourceId, force ?? false),
    getForContent: (contentId: string) => ipcRenderer.invoke('vodEnrich:getForContent', contentId),
    enrichSingle: (contentId: string, force?: boolean) => ipcRenderer.invoke('vodEnrich:enrichSingle', contentId, force ?? false),
    prefetchVisible: (contentIds: string[]) => ipcRenderer.invoke('vodEnrich:prefetchVisible', contentIds),
    cancelPrefetch: () => ipcRenderer.invoke('vodEnrich:cancelPrefetch'),
    pickCandidate: (contentId: string, enrichmentId: number) => ipcRenderer.invoke('vodEnrich:pickCandidate', contentId, enrichmentId),
    disable: (contentId: string) => ipcRenderer.invoke('vodEnrich:disable', contentId),
    reset: (contentId: string) => ipcRenderer.invoke('vodEnrich:reset', contentId),
  },

  // Events from main process
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const wrapper = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, wrapper)
    return () => { ipcRenderer.removeListener(channel, wrapper) }
  },
}

contextBridge.exposeInMainWorld('api', api)

// DevTools toggle (dev convenience)
contextBridge.exposeInMainWorld('electronDevTools', () => {
  ipcRenderer.invoke('devtools:toggle')
})

declare global {
  interface Window {
    api: typeof api & { settings: { get: (key: string) => Promise<string | null>; set: (key: string, value: string) => Promise<{ ok: boolean }> } }
    electronDevTools: () => void
  }
}
