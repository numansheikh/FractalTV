// ─── Settings handlers ────────────────────────────────────────────────────────
// Covers: settings:get/set, debug:category-items, window:toggle-fullscreen,
//         window:is-fullscreen, player:open-external, player:detect-external,
//         export:build-tree, export:pick-file, export:run, export:reveal

import { ipcMain, BrowserWindow, app, dialog } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { getSqlite, getSetting, setSetting } from '../../database/connection'
import { CountRow, dbPath, findMpv, findVlc } from './shared'

export function registerSettingsHandlers(ipcMain_: typeof ipcMain): void {
  // ── Diagnostic ────────────────────────────────────────────────────────
  ipcMain_.handle('debug:category-items', async (_event, categoryNameSearch: string) => {
    const sqlite = getSqlite()
    const results: any[] = []

    const categoryTables = [
      { table: 'channel_categories', contentTable: 'channels', type: 'live' },
      { table: 'movie_categories',   contentTable: 'movies',   type: 'movie' },
      { table: 'series_categories',  contentTable: 'series',   type: 'series' },
    ]

    for (const { table, contentTable, type } of categoryTables) {
      const cats = sqlite.prepare(`
        SELECT cat.*, s.name as source_name
        FROM ${table} cat
        JOIN sources s ON s.id = cat.source_id
        WHERE cat.name LIKE ?
        ORDER BY cat.name
      `).all(`%${categoryNameSearch}%`) as any[]

      for (const cat of cats) {
        const items = sqlite.prepare(`
          SELECT x.id, x.title, x.external_id AS external_id, '${type}' AS type, x.source_id AS primary_source_id
          FROM ${contentTable} x
          WHERE x.category_id = ?
        `).all(cat.id) as any[]
        results.push({
          categoryName: cat.name,
          categoryExternalId: cat.external_id,
          sourceId: cat.source_id,
          sourceName: cat.source_name,
          type,
          actualItems: items.length,
          items: items.map((i: any) => ({ id: i.id, title: i.title, externalId: i.external_id })),
        })
      }
    }

    return results
  })

  // ── Settings (key-value) ─────────────────────────────────────────────
  ipcMain_.handle('settings:get', (_event, key: string) => getSetting(key))
  ipcMain_.handle('settings:set', (_event, key: string, value: string) => {
    setSetting(key, value)
    // Clear the TMDB-invalid-key flag whenever the user edits the key, so the
    // next enrichment attempt can retry with the new key.
    if (key === 'tmdb_api_key') setSetting('tmdb_key_invalid', '0')
    return { ok: true }
  })

  // ── External player ───────────────────────────────────────────────────
  ipcMain_.handle('player:open-external', async (_event, args: {
    player: 'mpv' | 'vlc'; url: string; title: string; customPath?: string
    headers?: Record<string, string>
  }) => {
    const { player, url, title, customPath, headers } = args
    const execPath = customPath || (player === 'mpv' ? findMpv() : findVlc())

    const spawnArgs: string[] = []
    if (player === 'mpv') {
      spawnArgs.push(`--force-media-title=${title}`)
      // mpv: --http-header-fields="User-Agent: ...,Referer: ..."
      if (headers && Object.keys(headers).length > 0) {
        const fields = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join(',')
        spawnArgs.push(`--http-header-fields=${fields}`)
      }
      spawnArgs.push(url)
    } else {
      spawnArgs.push(url, `:meta-title=${title}`)
      // VLC: :http-user-agent=... :http-referrer=...
      if (headers) {
        if (headers['User-Agent']) spawnArgs.push(`:http-user-agent=${headers['User-Agent']}`)
        if (headers['Referer']) spawnArgs.push(`:http-referrer=${headers['Referer']}`)
      }
    }

    try {
      const proc = spawn(execPath, spawnArgs, { detached: true, stdio: 'ignore' })
      proc.unref()
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain_.handle('player:detect-external', () => ({ mpv: findMpv(), vlc: findVlc() }))

  // ── Export playlist ─────────────────────────────────────────────────────
  ipcMain_.handle('export:build-tree', () => {
    const sqlite = getSqlite()
    const profileId = 'default'

    const sourceRows = sqlite.prepare(
      `SELECT id, type, name FROM sources WHERE disabled = 0 ORDER BY created_at ASC, name ASC`
    ).all() as Array<{ id: string; type: 'xtream' | 'm3u'; name: string }>

    const channelCats = sqlite.prepare(`
      SELECT cc.id, cc.name, cc.source_id, COUNT(c.id) AS n
      FROM channel_categories cc
      LEFT JOIN channels c ON c.category_id = cc.id
      WHERE cc.source_id = ?
      GROUP BY cc.id, cc.name, cc.source_id
      HAVING n > 0
      ORDER BY cc.position ASC, cc.name ASC
    `)
    const movieCats = sqlite.prepare(`
      SELECT mc.id, mc.name, mc.source_id, COUNT(m.id) AS n
      FROM movie_categories mc
      LEFT JOIN movies m ON m.category_id = mc.id
      WHERE mc.source_id = ?
      GROUP BY mc.id, mc.name, mc.source_id
      HAVING n > 0
      ORDER BY mc.position ASC, mc.name ASC
    `)
    const seriesCats = sqlite.prepare(`
      SELECT sc.id, sc.name, sc.source_id, COUNT(s.id) AS n
      FROM series_categories sc
      LEFT JOIN series s ON s.category_id = sc.id
      WHERE sc.source_id = ?
      GROUP BY sc.id, sc.name, sc.source_id
      HAVING n > 0
      ORDER BY sc.position ASC, sc.name ASC
    `)

    const favCh = (sqlite.prepare(
      `SELECT COUNT(*) AS n FROM channel_user_data WHERE profile_id = ? AND is_favorite = 1`
    ).get(profileId) as CountRow).n
    const favMv = (sqlite.prepare(
      `SELECT COUNT(*) AS n FROM movie_user_data WHERE profile_id = ? AND is_favorite = 1`
    ).get(profileId) as CountRow).n
    const favSr = (sqlite.prepare(
      `SELECT COUNT(*) AS n FROM series_user_data WHERE profile_id = ? AND is_favorite = 1`
    ).get(profileId) as CountRow).n

    return {
      favorites: { channels: favCh, movies: favMv, series: favSr },
      sources: sourceRows.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        channels: (channelCats.all(s.id) as any[]).map((r) => ({ id: r.id, name: r.name, count: r.n })),
        movies: (movieCats.all(s.id) as any[]).map((r) => ({ id: r.id, name: r.name, count: r.n })),
        series: (seriesCats.all(s.id) as any[]).map((r) => ({ id: r.id, name: r.name, count: r.n })),
      })),
    }
  })

  ipcMain_.handle('export:pick-file', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const today = new Date().toISOString().slice(0, 10)
    const defaultPath = join(app.getPath('documents'), `fractals-playlist-${today}.m3u`)
    const result = win
      ? await dialog.showSaveDialog(win, {
          title: 'Export Playlist',
          defaultPath,
          filters: [{ name: 'M3U Playlist', extensions: ['m3u', 'm3u8'] }],
        })
      : await dialog.showSaveDialog({ title: 'Export Playlist', defaultPath })
    if (result.canceled || !result.filePath) return { canceled: true }
    return { canceled: false, filePath: result.filePath }
  })

  ipcMain_.handle('export:run', async (event, args: {
    selection: {
      favoritesChannels: boolean
      favoritesMovies: boolean
      favoritesSeries: boolean
      channelCategoryIds: Array<{ sourceId: string; categoryId: string }>
      movieCategoryIds: Array<{ sourceId: string; categoryId: string }>
      seriesCategoryIds: Array<{ sourceId: string; categoryId: string }>
    }
    outputPath: string
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const workerPath = join(__dirname, '..', 'export.worker.js')
    return new Promise((resolve) => {
      const worker = new Worker(workerPath, {
        workerData: {
          dbPath: dbPath(),
          selection: args.selection,
          outputPath: args.outputPath,
          profileId: 'default',
        },
      })
      worker.on('message', (msg: any) => {
        if (msg.type === 'progress') {
          win?.webContents.send('export:progress', { phase: msg.phase, current: msg.current, total: msg.total, message: msg.message })
        } else if (msg.type === 'done') {
          win?.webContents.send('export:progress', { phase: 'done', current: msg.entryCount, total: msg.entryCount, message: `Exported ${msg.entryCount} entries` })
          resolve({ success: true, filePath: msg.filePath, entryCount: msg.entryCount })
        } else if (msg.type === 'error') {
          win?.webContents.send('export:progress', { phase: 'error', current: 0, total: 0, message: msg.message })
          resolve({ success: false, error: msg.message })
        }
      })
      worker.on('error', (err) => {
        resolve({ success: false, error: String(err) })
      })
      worker.on('exit', (code) => {
        if (code !== 0) resolve({ success: false, error: `Export worker exited with code ${code}` })
      })
    })
  })

  ipcMain_.handle('export:reveal', (_event, filePath: string) => {
    const { shell } = require('electron')
    shell.showItemInFolder(filePath)
  })

  // ── Window ────────────────────────────────────────────────────────────
  ipcMain_.handle('window:toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setFullScreen(!win.isFullScreen())
  })

  ipcMain_.handle('window:is-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFullScreen() ?? false
  })
}
