import { contextBridge, ipcRenderer } from 'electron'

// Type-safe API exposed to the renderer process
// This will grow as we add IPC handlers

export const api = {
  // Placeholder — real methods added in Phase 2+
  ping: () => ipcRenderer.invoke('ping'),
}

contextBridge.exposeInMainWorld('api', api)

// Type declaration for renderer use
declare global {
  interface Window {
    api: typeof api
  }
}
