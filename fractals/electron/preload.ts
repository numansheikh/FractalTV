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
    remove: (sourceId: string) => ipcRenderer.invoke('sources:remove', sourceId),
    toggleDisabled: (sourceId: string) => ipcRenderer.invoke('sources:toggle-disabled', sourceId),
    sync: (sourceId: string) => ipcRenderer.invoke('sources:sync', sourceId),
  },

  // Search
  search: {
    query: (args: { query: string; type?: 'live' | 'movie' | 'series'; limit?: number; offset?: number }) =>
      ipcRenderer.invoke('search:query', args),
  },

  // Content
  content: {
    get: (contentId: string) => ipcRenderer.invoke('content:get', contentId),
    getStreamUrl: (args: { contentId: string; sourceId?: string }) =>
      ipcRenderer.invoke('content:get-stream-url', args),
  },

  // User data
  user: {
    getData: (contentId: string) => ipcRenderer.invoke('user:get-data', contentId),
    setPosition: (contentId: string, position: number) =>
      ipcRenderer.invoke('user:set-position', { contentId, position }),
    toggleFavorite: (contentId: string) => ipcRenderer.invoke('user:toggle-favorite', contentId),
    toggleWatchlist: (contentId: string) => ipcRenderer.invoke('user:toggle-watchlist', contentId),
  },

  // TMDB enrichment
  enrichment: {
    setApiKey: (key: string) => ipcRenderer.invoke('enrichment:set-api-key', key),
    status: () => ipcRenderer.invoke('enrichment:status'),
    start: (apiKey?: string) => ipcRenderer.invoke('enrichment:start', apiKey),
  },

  // Events from main process
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    return () => ipcRenderer.removeAllListeners(channel)
  },
}

contextBridge.exposeInMainWorld('api', api)

// DevTools toggle (dev convenience)
contextBridge.exposeInMainWorld('electronDevTools', () => {
  ipcRenderer.invoke('devtools:toggle')
})

declare global {
  interface Window {
    api: typeof api
  }
}
