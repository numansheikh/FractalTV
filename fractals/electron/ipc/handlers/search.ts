// ─── Search handlers ──────────────────────────────────────────────────────────
// Covers: search:query

import { ipcMain } from 'electron'
import { getSqlite } from '../../database/connection'
import { parseAdvQuery } from '../../lib/adv-query-parser'
import {
  getEnabledSourceIds,
  g1cAdvSearch,
  g1cSearchChannels,
  g1cSearchMovies,
  g1cSearchSeries,
  runBrowseSearch,
} from './shared'

export function registerSearchHandlers(ipcMain_: typeof ipcMain): void {
  // ── Search ──────────────────────────────────────────────────────────────
  // LIKE `%query%` on `search_title` per content type. Query is normalized
  // through the same any-ascii+lowercase pass as the stored column.
  ipcMain_.handle('search:query', async (_event, args: {
    query: string
    type?: 'live' | 'movie' | 'series'
    categoryName?: string
    sourceIds?: string[]
    limit?: number
    offset?: number
    skipCount?: boolean
  }) => {
    const sqlite = getSqlite()
    const { categoryName, sourceIds, limit = 50, offset = 0, skipCount = false } = args
    const rawQuery = (args.query ?? '').trim()
    const isAdvanced = rawQuery.startsWith('@')
    let searchQuery = isAdvanced ? rawQuery.slice(1).trim() : rawQuery
    // Defense-in-depth: LIKE '%q%' on a 1-char query is a full-table scan. The
    // renderer already enforces this (search.store.ts MIN_SEARCH_CHARS = 2),
    // but a stray IPC caller would still hit the DB hard. Fall through to the
    // browse path for plain queries shorter than 2 chars. Advanced queries are
    // allowed through since their tokens target indexed md_* columns.
    if (!isAdvanced && searchQuery.length > 0 && searchQuery.length < 2) {
      searchQuery = ''
    }

    const enabledSources = getEnabledSourceIds(sqlite)
    const filterIds = sourceIds && sourceIds.length > 0
      ? sourceIds.filter(id => enabledSources.has(id))
      : [...enabledSources]
    if (!filterIds.length) return { items: [], total: 0 }

    const effectiveType = args.type

    // Empty query → browse path.
    if (!searchQuery) {
      return runBrowseSearch(effectiveType, categoryName, filterIds, limit, offset)
    }

    // Advanced search: parse tokens into md_* WHERE clauses + title LIKE fallback
    if (isAdvanced) {
      const advQuery = parseAdvQuery(searchQuery)
      const doAdv = (type: 'live' | 'movie' | 'series', lim: number, off: number, sc: boolean) =>
        g1cAdvSearch(advQuery, type, categoryName, filterIds, lim, off, sc)

      if (effectiveType) return doAdv(effectiveType, limit, offset, skipCount)

      const cap = limit + offset
      const live   = doAdv('live',   cap, 0, skipCount)
      const movies = doAdv('movie',  cap, 0, skipCount)
      const series = doAdv('series', cap, 0, skipCount)
      const merged = [...live.items, ...movies.items, ...series.items]
      return {
        items: merged.slice(offset, offset + limit),
        total: live.total + movies.total + series.total,
      }
    }

    // Plain search: single LIKE on search_title
    if (effectiveType === 'movie') {
      return g1cSearchMovies(searchQuery, categoryName, filterIds, limit, offset, skipCount)
    }
    if (effectiveType === 'live') {
      return g1cSearchChannels(searchQuery, categoryName, filterIds, limit, offset, skipCount)
    }
    if (effectiveType === 'series') {
      return g1cSearchSeries(searchQuery, categoryName, filterIds, limit, offset, skipCount)
    }

    const cap = limit + offset
    const live   = g1cSearchChannels(searchQuery, categoryName, filterIds, cap, 0, skipCount)
    const movies = g1cSearchMovies  (searchQuery, categoryName, filterIds, cap, 0, skipCount)
    const series = g1cSearchSeries  (searchQuery, categoryName, filterIds, cap, 0, skipCount)
    const merged = [...live.items, ...movies.items, ...series.items]
    return {
      items: merged.slice(offset, offset + limit),
      total: live.total + movies.total + series.total,
    }
  })
}
