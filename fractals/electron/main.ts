import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { getDb } from './database/connection'
import { registerHandlers } from './ipc/handlers'
import { createIptvOrgCache } from './services/enrichment/iptv-org-cache'
import { startRefreshScheduler, stopRefreshScheduler } from './services/enrichment/iptv-org-refresh'

const isDev = !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    fullscreenable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // IPTV streams are cross-origin — disable web security so HLS.js can fetch them
      webSecurity: false,
    },
  })

  // Open external links in browser, not in the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'))
  }
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock({ key: isDev ? 'fractals-dev' : 'fractals' })
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) {
      if (wins[0].isMinimized()) wins[0].restore()
      wins[0].focus()
    }
  })

  app.whenReady().then(() => {
    getDb() // Initialize database on startup
    registerHandlers() // Also kicks enrichment worker on startup

    // V3 L10: iptv-org bulk dataset — init cache + weekly refresh scheduler
    const iptvCache = createIptvOrgCache()
    void iptvCache.initCache().catch((err) => {
      console.warn('[main] iptv-org cache init failed:', err)
    })
    startRefreshScheduler(iptvCache)

    createWindow()

    app.on('activate', () => {
      const wins = BrowserWindow.getAllWindows()
      if (wins.length === 0) {
        createWindow()
      } else {
        if (wins[0].isMinimized()) wins[0].restore()
        wins[0].show()
        wins[0].focus()
      }
    })
  })

  app.on('window-all-closed', () => {
    stopRefreshScheduler()
    if (process.platform !== 'darwin') app.quit()
  })

}
