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

    sync: (sourceId: string) =>
      isElectron ? window.api.sources.sync(sourceId) : Promise.resolve({ success: false }),
  },

  search: {
    query: (args: { query: string; type?: 'live' | 'movie' | 'series'; limit?: number; offset?: number }) =>
      isElectron ? window.api.search.query(args) : Promise.resolve([]),
  },

  content: {
    get: (contentId: string) =>
      isElectron ? window.api.content.get(contentId) : Promise.resolve(null),

    getStreamUrl: (args: { contentId: string; sourceId?: string }) =>
      isElectron ? window.api.content.getStreamUrl(args) : Promise.resolve({ error: 'Not in Electron' }),
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
  },

  enrichment: {
    setApiKey: (key: string) =>
      isElectron ? window.api.enrichment.setApiKey(key) : Promise.resolve({ success: false }),
    status: () =>
      isElectron ? window.api.enrichment.status() : Promise.resolve({ total: 0, enriched: 0, pending: 0 }),
    start: (apiKey?: string) =>
      isElectron ? window.api.enrichment.start(apiKey) : Promise.resolve({ success: false }),
  },

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (isElectron) return window.api.on(channel, callback)
    return () => {}
  },
}
