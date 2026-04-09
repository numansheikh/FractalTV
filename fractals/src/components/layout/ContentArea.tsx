import React, { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/stores/app.store'
import { useSearchStore } from '@/stores/search.store'
import { useUserStore } from '@/stores/user.store'
import { useSourcesStore } from '@/stores/sources.store'
import { api } from '@/lib/api'
import { ContentItem, ActiveView } from '@/lib/types'
import { FilterBar } from './FilterBar'
import { EmptyState } from '@/components/shared/EmptyState'
import { HomeView } from '@/components/home/HomeView'
import { BrowseSidebar } from '@/components/browse/BrowseSidebar'

// Lazy imports — will be provided by agents
let VirtualGrid: any = null
let SearchResults: any = null
let LibraryView: any = null

async function loadComponents() {
  try {
    const [g, s, l] = await Promise.all([
      import('@/components/grids/VirtualGrid').catch(() => null),
      import('@/components/search/SearchResults').catch(() => null),
      import('@/components/library/LibraryView').catch(() => null),
    ])
    if (g) VirtualGrid = g.VirtualGrid
    if (s) SearchResults = s.SearchResults
    if (l) LibraryView = l.LibraryView
  } catch {}
}
loadComponents()

const VIEW_TYPE: Record<ActiveView, 'live' | 'movie' | 'series' | undefined> = {
  home: undefined,
  live: 'live',
  films: 'movie',
  series: 'series',
  library: undefined,
}

const BROWSE_VIEWS: ActiveView[] = ['live', 'films', 'series']

const SEARCH_INIT = 21   // N+1: fetch one extra to detect "has more"
const SEARCH_INITIAL_CAP = 20 // max displayed before "Show all"

interface Props {
  sort: string
  onSelectContent: (item: ContentItem) => void
  onAddSource: () => void
}


function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 26, height: 26,
    borderRadius: 5,
    background: 'var(--bg-3)',
    border: '1px solid var(--border-default)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer',
    color: disabled ? 'var(--text-3)' : 'var(--text-1)',
    flexShrink: 0,
    padding: 0,
    opacity: disabled ? 0.4 : 1,
  }
}

export function ContentArea({ sort, onSelectContent, onAddSource }: Props) {
  const { activeView, typeFilter, categoryFilter, selectedSourceIds, viewMode, pageSize, setChannelSurfContext } = useAppStore()
  const { query } = useSearchStore()
  const { loadBulk } = useUserStore()
  const { sources } = useSourcesStore()
  const [ready, setReady] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => {
    loadComponents().then(() => setReady(true))
  }, [])

  // Reset to page 1 when filters/view/sort change
  useEffect(() => {
    setPage(1)
  }, [activeView, categoryFilter, selectedSourceIds, sort, query])

  const contentType = VIEW_TYPE[activeView] ?? (typeFilter !== 'all' ? (typeFilter === 'movie' ? 'movie' : typeFilter) as any : undefined)
  const [sortBy, sortDir] = sort.split(':') as [string, 'asc' | 'desc']

  const isBrowseView = BROWSE_VIEWS.includes(activeView)
  const showSidebar = isBrowseView
  const isFavoritesFilter = categoryFilter === '__favorites__'

  // Favourites query — used when __favorites__ sentinel is active
  // Source filtering applied client-side (favorites API doesn't accept sourceIds)
  const { data: allFavData = [], isLoading: favLoading } = useQuery<ContentItem[]>({
    queryKey: ['browse-favorites', contentType],
    queryFn: () => api.user.favorites({ type: contentType as 'live' | 'movie' | 'series' | undefined }),
    staleTime: 30_000,
    enabled: !query && isFavoritesFilter && activeView !== 'library' && activeView !== 'home',
  })
  const favData = selectedSourceIds.length > 0
    ? allFavData.filter((item) => {
        const srcId = (item as any).primarySourceId ?? (item as any).primary_source_id ?? (item as any).source_ids ?? (item as any).id?.split(':')[0]
        return srcId ? selectedSourceIds.includes(srcId) : true
      })
    : allFavData

  // Browse query — page-based offset
  const { data: browseData, isLoading: browseLoading } = useQuery({
    queryKey: ['browse', contentType, categoryFilter, selectedSourceIds, sortBy, sortDir, page, pageSize],
    queryFn: () => api.content.browse({
      type: contentType,
      categoryName: categoryFilter && categoryFilter !== '__favorites__' ? categoryFilter : undefined,
      sourceIds: selectedSourceIds.length ? selectedSourceIds : undefined,
      sortBy, sortDir,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    staleTime: 30_000,
    enabled: !query && !isFavoritesFilter && activeView !== 'library' && activeView !== 'home',
  })

  const isLoading = isFavoritesFilter ? favLoading : browseLoading

  // Per-type search limits — initial N+1 to detect "has more"
  const [liveSearchLimit,   setLiveSearchLimit]   = useState(SEARCH_INIT)
  const [movieSearchLimit,  setMovieSearchLimit]  = useState(SEARCH_INIT)
  const [seriesSearchLimit, setSeriesSearchLimit] = useState(SEARCH_INIT)
  useEffect(() => {
    setLiveSearchLimit(SEARCH_INIT)
    setMovieSearchLimit(SEARCH_INIT)
    setSeriesSearchLimit(SEARCH_INIT)
  }, [query])

  // Navigation callbacks for "Show all" — navigate to view + clear search
  const { setView } = useAppStore()
  const handleShowAllLive = useCallback(() => {
    setView('live')
  }, [setView])
  const handleShowAllMovies = useCallback(() => {
    setView('films')
  }, [setView])
  const handleShowAllSeries = useCallback(() => {
    setView('series')
  }, [setView])

  const searchBase = {
    query,
    categoryName: categoryFilter && categoryFilter !== '__favorites__' ? categoryFilter : undefined,
    sourceIds: selectedSourceIds.length ? selectedSourceIds : undefined,
  }
  const { data: liveSearchResults   = [] } = useQuery({
    queryKey: ['search', query, 'live',   categoryFilter, selectedSourceIds, liveSearchLimit],
    queryFn: () => api.search.query({ ...searchBase, type: 'live',   limit: liveSearchLimit }),
    enabled: !!query && (!contentType || contentType === 'live'),
    staleTime: 10_000,
  })
  const { data: movieSearchResults  = [] } = useQuery({
    queryKey: ['search', query, 'movie',  categoryFilter, selectedSourceIds, movieSearchLimit],
    queryFn: () => api.search.query({ ...searchBase, type: 'movie',  limit: movieSearchLimit }),
    enabled: !!query && (!contentType || contentType === 'movie'),
    staleTime: 10_000,
  })
  const { data: seriesSearchResults = [] } = useQuery({
    queryKey: ['search', query, 'series', categoryFilter, selectedSourceIds, seriesSearchLimit],
    queryFn: () => api.search.query({ ...searchBase, type: 'series', limit: seriesSearchLimit }),
    enabled: !!query && (!contentType || contentType === 'series'),
    staleTime: 10_000,
  })
  const allSearchResults = query
    ? ([...liveSearchResults, ...movieSearchResults, ...seriesSearchResults] as ContentItem[])
    : []

  const items: ContentItem[] = query
    ? allSearchResults
    : isFavoritesFilter
      ? favData
      : ((browseData?.items ?? []) as ContentItem[])
  const total: number = query ? items.length : isFavoritesFilter ? favData.length : (browseData?.total ?? 0)

  useEffect(() => {
    if (items.length > 0) loadBulk(items.map((i) => i.id))
  }, [items, loadBulk])

  const isEmpty = !isLoading && items.length === 0

  // Wrap select — live items set surf context from whatever list is currently displayed
  const handleSelect = useCallback((item: ContentItem) => {
    if (item.type === 'live') {
      if (query) {
        // Search mode: use capped search results
        const liveForSurf = (liveSearchResults as ContentItem[]).slice(
          0, liveSearchLimit > SEARCH_INIT ? liveSearchResults.length : SEARCH_INITIAL_CAP
        )
        const idx = liveForSurf.findIndex((i: ContentItem) => i.id === item.id)
        setChannelSurfContext(liveForSurf, idx, null)
      } else {
        // Browse/favorites mode: use current displayed items as surf list
        const currentItems = isFavoritesFilter
          ? (favData as ContentItem[])
          : ((browseData?.items ?? []) as ContentItem[])
        const liveItems = currentItems.filter((i) => i.type === 'live')
        const idx = liveItems.findIndex((i: ContentItem) => i.id === item.id)
        setChannelSurfContext(liveItems, idx >= 0 ? idx : 0, isFavoritesFilter ? 'browse-favorites' : null)
      }
    }
    onSelectContent(item)
  }, [query, liveSearchResults, liveSearchLimit, isFavoritesFilter, favData, browseData, onSelectContent, setChannelSurfContext])

  // Library view
  if (activeView === 'library') {
    return (
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <FilterBar itemCount={undefined} />
        {ready && LibraryView
          ? <LibraryView onSelectContent={onSelectContent} />
          : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)', fontSize: 13 }}>Loading library…</div>
        }
      </div>
    )
  }

  // Home view — always render HomeView; it handles search inline so the bottom bar never unmounts
  if (activeView === 'home') {
    return <HomeView onSelectContent={onSelectContent} />
  }

  // Search results (from non-home views)
  if (query) {
    return (
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <FilterBar itemCount={total > 0 ? total : undefined} />
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {ready && SearchResults
            ? <SearchResults
                live={{   results: liveSearchResults   as ContentItem[], onShowAll: handleShowAllLive   }}
                movies={{  results: movieSearchResults  as ContentItem[], onShowAll: handleShowAllMovies  }}
                series={{  results: seriesSearchResults as ContentItem[], onShowAll: handleShowAllSeries }}
                onSelect={handleSelect}
              />
            : <FallbackGrid items={items} onSelect={handleSelect} />
          }
        </div>
      </div>
    )
  }

  // Browse views (live / films / series)
  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <FilterBar itemCount={total > 0 ? total : undefined} />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Sidebar — Option 3 */}
        {showSidebar && <BrowseSidebar />}

        {/* Content grid */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {isLoading && isEmpty && (
            <div style={{ flex: 1, padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {Array.from({ length: 24 }).map((_, i) => (
                <BrowseSkeleton key={i} type={contentType === 'live' ? 'live' : 'poster'} />
              ))}
            </div>
          )}
          {isEmpty && !isLoading && (() => {
            const hasSources = sources.filter((s) => !s.disabled).length > 0
            if (!hasSources) {
              return (
                <EmptyState
                  icon={<PlayIcon />}
                  title="Add your first source"
                  description="Connect an Xtream Codes account to start browsing your content."
                  action={{ label: 'Add source', onClick: onAddSource }}
                  hint="⌘, to open settings"
                />
              )
            }
            if (isFavoritesFilter) {
              const typeLabel = activeView === 'live' ? 'channels' : activeView === 'films' ? 'movies' : activeView === 'series' ? 'series' : 'items'
              return (
                <EmptyState
                  icon={<HeartIcon />}
                  title="No favorites yet"
                  description={`Heart any ${typeLabel} to see them here.`}
                />
              )
            }
            return (
              <EmptyState
                icon={<PlayIcon />}
                title="Nothing in this category"
                description="Try a different category or check back after syncing."
              />
            )
          })()}
          {!isEmpty && (
            <>
              <div style={{ flex: 1, minHeight: 0 }}>
                {ready && VirtualGrid
                  ? <VirtualGrid items={items} onSelect={handleSelect} viewMode={activeView === 'live' ? viewMode : 'grid'} />
                  : <FallbackGrid items={items} onSelect={handleSelect} />
                }
              </div>
              {/* Pagination bar — only when total exceeds threshold */}
              {total > pageSize && (() => {
                const totalPages = Math.ceil(total / pageSize)
                return (
                  <div style={{
                    padding: '8px 16px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    borderTop: '1px solid var(--border-subtle)',
                    background: 'var(--bg-1)',
                  }}>
                    {/* Prev */}
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1 || isLoading}
                      style={navBtnStyle(page === 1 || isLoading)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>

                    {/* Slider */}
                    <input
                      type="range"
                      min={1}
                      max={totalPages}
                      value={page}
                      onChange={(e) => setPage(Number(e.target.value))}
                      style={{ flex: 1, accentColor: 'var(--accent-interactive)', cursor: 'pointer', height: 4 }}
                    />

                    {/* Next */}
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages || isLoading}
                      style={navBtnStyle(page === totalPages || isLoading)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>

                    {/* Page label */}
                    <span style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap', minWidth: 80, textAlign: 'right' }}>
                      {isLoading ? 'Loading…' : `${((page - 1) * pageSize + 1).toLocaleString()}–${Math.min(page * pageSize, total).toLocaleString()} of ${total.toLocaleString()}`}
                    </span>
                  </div>
                )
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function FallbackGrid({ items, onSelect }: { items: ContentItem[]; onSelect: (i: ContentItem) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, padding: 16 }}>
      {items.map((item) => (
        <div key={item.id} onClick={() => onSelect(item)} style={{ borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border-subtle)', cursor: 'pointer', overflow: 'hidden' }}>
          <div style={{ aspectRatio: '2/3', background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {(item.posterUrl || item.poster_url) && (
              <img src={item.posterUrl ?? item.poster_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
            )}
          </div>
          <div style={{ padding: '6px 8px' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-0)', margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.title}</p>
            <p style={{ fontSize: 10, color: 'var(--text-2)', margin: '2px 0 0' }}>{item.year}{item.ratingTmdb ? ` · ★${item.ratingTmdb.toFixed(1)}` : ''}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function BrowseSkeleton({ type }: { type: 'live' | 'poster' }) {
  const aspect = type === 'live' ? '16/9' : '2/3'
  return (
    <div style={{ borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
      <div style={{ aspectRatio: aspect, background: 'linear-gradient(90deg, var(--bg-2) 25%, var(--bg-3) 50%, var(--bg-2) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
      <div style={{ padding: '6px 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ height: 10, borderRadius: 3, background: 'var(--bg-3)', width: '70%' }} />
        {type === 'poster' && <div style={{ height: 8, borderRadius: 3, background: 'var(--bg-3)', width: '45%' }} />}
      </div>
    </div>
  )
}

function PlayIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" opacity="0.5"/>
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  )
}
