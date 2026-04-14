import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '@/lib/api'
import { ContentItem } from './ContentCard'
import { PosterCard } from './PosterCard'
import { ChannelCard } from '@/components/cards/ChannelCard'
import { Pagination } from './Pagination'
import { useSearchStore, ContentType } from '@/stores/search.store'
import { useAppStore } from '@/stores/app.store'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SourceTabBar } from '@/components/settings/SourceTabBar'
import { FractalsIcon } from '@/components/shared/FractalsIcon'
import { PersonalizedRows } from './PersonalizedRows'

const TYPE_TABS: { label: string; value: ContentType }[] = [
  { label: 'All',     value: 'all'    },
  { label: 'Channels', value: 'live'   },
  { label: 'Movies',  value: 'movie'  },
  { label: 'Series',  value: 'series' },
]

const TYPE_COLORS: Record<string, string> = {
  all:    'var(--color-src-1)',  // amber — guaranteed distinct from live/movie/series in all themes
  live:   'var(--color-live)',
  movie:  'var(--color-movie)',
  series: 'var(--color-series)',
}

function getPageSize() { return Number(localStorage.getItem('fractals-browse-page-size')) || 60 }
function getSearchLimit(type: 'live' | 'movie' | 'series') {
  const key = `fractals-search-${type}-limit`
  return Number(localStorage.getItem(key)) || (type === 'live' ? 20 : type === 'movie' ? 45 : 35)
}

type SortBy = 'updated' | 'title' | 'year' | 'rating'
type SortDir = 'asc' | 'desc'

const SORT_OPTIONS: { label: string; value: SortBy; dir: SortDir }[] = [
  { label: 'Latest',     value: 'updated', dir: 'desc' },
  { label: 'Title A–Z',  value: 'title',   dir: 'asc'  },
  { label: 'Title Z–A',  value: 'title',   dir: 'desc' },
  { label: 'Year ↓',     value: 'year',    dir: 'desc' },
  { label: 'Year ↑',     value: 'year',    dir: 'asc'  },
  { label: 'Top Rated',  value: 'rating',  dir: 'desc' },
]

interface Props {
  onAddSource: () => void
  onSyncSource: (id: string) => void
  onRemoveSource: (id: string) => void
  onSelectContent: (item: ContentItem) => void
  sourcesCount: number
}

export function BrowseView({ onAddSource, onSyncSource, onRemoveSource, onSelectContent, sourcesCount }: Props) {
  const { debouncedQueries, type, setType, activeCategory, setActiveCategory } = useSearchStore()
  const { activeView } = useAppStore()
  const query = debouncedQueries[activeView] ?? ''
  const { sources, selectedSourceIds } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)

  const [categoryFilter, setCategoryFilter] = useState('')
  const [page, setPage] = useState(1)
  const [sortIdx, setSortIdx] = useState(0)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [catSize, setCatSize] = useState<0 | 1 | 2>(0) // 0=3 rows, 1=6 rows, 2=10 rows
  const CAT_HEIGHTS = [88, 168, 274] as const

  const isSearching = query.trim().length > 0
  const srcFilter = selectedSourceIds.length > 0 ? selectedSourceIds : undefined
  const browseType = type === 'all' ? undefined : (type as 'live' | 'movie' | 'series')
  const sort = SORT_OPTIONS[sortIdx]

  // Reset page + category filter when context changes
  useEffect(() => {
    setPage(1)
    setCategoryFilter('')
  }, [type, selectedSourceIds.join(',')])

  useEffect(() => { setPage(1) }, [activeCategory, sortIdx])

  // Close sort menu on outside click
  useEffect(() => {
    if (!showSortMenu) return
    const handler = () => setShowSortMenu(false)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [showSortMenu])

  // ── Categories ──────────────────────────────────────────────────────────
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', type, selectedSourceIds],
    queryFn: () => api.categories.list({ type: browseType, sourceIds: srcFilter }),
    enabled: !isSearching && sourcesCount > 0,
    staleTime: 60_000,
  })

  const filteredCategories = (categories as any[]).filter(c =>
    !categoryFilter || c.name.toLowerCase().includes(categoryFilter.toLowerCase())
  )

  const PAGE_SIZE = getPageSize()

  // ── Per-type search limits (independent so each section can load more) ─────
  const defaultLive = getSearchLimit('live'), defaultMovie = getSearchLimit('movie'), defaultSeries = getSearchLimit('series')
  const [liveLimit,   setLiveLimit]   = useState(defaultLive)
  const [movieLimit,  setMovieLimit]  = useState(defaultMovie)
  const [seriesLimit, setSeriesLimit] = useState(defaultSeries)
  useEffect(() => { setLiveLimit(defaultLive); setMovieLimit(defaultMovie); setSeriesLimit(defaultSeries) }, [query])

  const { data: liveSearchResults   = [], isFetching: liveFetching   } = useQuery({
    queryKey: ['search', query, 'live',   activeCategory, selectedSourceIds, liveLimit],
    queryFn: () => api.search.query({ query, type: 'live',   categoryName: activeCategory ?? undefined, sourceIds: srcFilter, limit: liveLimit }),
    enabled: isSearching && (type === 'all' || type === 'live'),
    placeholderData: (prev) => prev,
  })
  const { data: movieSearchResults  = [], isFetching: movieFetching  } = useQuery({
    queryKey: ['search', query, 'movie',  activeCategory, selectedSourceIds, movieLimit],
    queryFn: () => api.search.query({ query, type: 'movie',  categoryName: activeCategory ?? undefined, sourceIds: srcFilter, limit: movieLimit }),
    enabled: isSearching && (type === 'all' || type === 'movie'),
    placeholderData: (prev) => prev,
  })
  const { data: seriesSearchResults = [], isFetching: seriesFetching } = useQuery({
    queryKey: ['search', query, 'series', activeCategory, selectedSourceIds, seriesLimit],
    queryFn: () => api.search.query({ query, type: 'series', categoryName: activeCategory ?? undefined, sourceIds: srcFilter, limit: seriesLimit }),
    enabled: isSearching && (type === 'all' || type === 'series'),
    placeholderData: (prev) => prev,
  })

  // ── Browse content (paginated) ──────────────────────────────────────────
  const { data: browseData, isFetching: browseFetching } = useQuery({
    queryKey: ['browse', type, activeCategory, selectedSourceIds, page, sortIdx],
    queryFn: async () => {
      const res = await api.content.browse({
        type: browseType,
        categoryName: activeCategory ?? undefined,
        sourceIds: srcFilter,
        sortBy: sort.value,
        sortDir: sort.dir,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      return res as { items: ContentItem[]; total: number }
    },
    enabled: !isSearching && sourcesCount > 0,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })

  const items = browseData?.items ?? []
  const total = browseData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Bulk-load user data for visible items (card indicators)
  const loadBulk = useUserStore((s) => s.loadBulk)
  const allVisibleIds = isSearching
    ? [...(liveSearchResults as any[]), ...(movieSearchResults as any[]), ...(seriesSearchResults as any[])].map((i: any) => i.id)
    : items.map((i: any) => i.id)
  useEffect(() => {
    if (allVisibleIds.length > 0) loadBulk(allVisibleIds)
  }, [allVisibleIds.join(',')])

  // ── Empty state ─────────────────────────────────────────────────────────
  if (sourcesCount === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32 }}>
        <div style={{ opacity: 0.4 }}><FractalsIcon size={44} /></div>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 8 }}>No sources yet</h2>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', maxWidth: 240, lineHeight: 1.7 }}>
            Add an Xtream Codes account to start browsing.
          </p>
        </div>
        <button onClick={onAddSource} style={{ borderRadius: 8, padding: '7px 20px', fontSize: 12, fontWeight: 600, background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}>
          Add source
        </button>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Type tabs + Source tabs (unified row) ──────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px 0 8px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', flexShrink: 0, minHeight: 44, overflow: 'hidden' }}>
        {TYPE_TABS.map((t) => {
          const active = type === t.value
          const color = TYPE_COLORS[t.value]
          return (
            <button key={t.value} onClick={() => setType(t.value)} style={{
              padding: '0 14px',
              fontSize: 12, fontWeight: 600,
              height: 30,
              borderRadius: active ? 7 : 0,
              color: active ? '#fff' : color,
              background: active ? color : 'transparent',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              borderBottom: active ? 'none' : `2.5px solid ${color}`,
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'all 0.12s',
              opacity: active ? 1 : 0.65,
            }}
              onMouseEnter={(e) => { if (!active) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = `color-mix(in srgb, ${color} 12%, transparent)` } }}
              onMouseLeave={(e) => { if (!active) { e.currentTarget.style.opacity = '0.65'; e.currentTarget.style.background = 'transparent' } }}
            >
              {t.label}
            </button>
          )
        })}

        {/* Divider */}
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--color-border)', flexShrink: 0, margin: '6px 4px' }} />

        {/* Spacer pushes sources to the right */}
        <div style={{ flex: 1 }} />

        {/* Source tabs — inline, right-aligned */}
        <SourceTabBar
          inline
          sources={sources}
          onAddSource={onAddSource}
          onSyncSource={onSyncSource}
          onRemoveSource={onRemoveSource}
        />
      </div>

      {/* ── Category bar ───────────────────────────────────────────────── */}
      {categories.length > 0 && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '7px 12px 7px 12px', background: 'var(--color-bg)', flexShrink: 0 }}>
            {/* Pill area — filter input inline as first item, then category pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, flex: 1, maxHeight: CAT_HEIGHTS[catSize], overflowY: 'auto', overflowX: 'hidden', transition: 'max-height 0.2s ease' }}>
              {/* Inline category filter */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }}>
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                <input value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} placeholder="Filter…"
                  style={{ width: 90, background: 'var(--color-bg)', border: '1px solid var(--color-border-strong)', borderRadius: 16, padding: '4px 22px 4px 22px', fontSize: 11, color: 'var(--color-text-primary)', outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s, width 0.15s' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.width = '130px' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; if (!categoryFilter) e.currentTarget.style.width = '90px' }}
                />
                {categoryFilter && (
                  <button onClick={() => setCategoryFilter('')}
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}>
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l10 10M11 1L1 11" /></svg>
                  </button>
                )}
              </div>
              {filteredCategories.length === 0 ? (
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '3px 4px' }}>No categories match</span>
              ) : (
                filteredCategories.map((cat: any) => {
                  const isActive = activeCategory === cat.name
                  const catSourceIds: string[] = cat.source_ids ? cat.source_ids.split(',') : []
                  const typeColor = TYPE_COLORS[cat.type] ?? 'var(--color-text-muted)'
                  return (
                    <button key={cat.name + cat.type} onClick={() => setActiveCategory(isActive ? null : cat.name)}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 20, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', border: `1px solid ${isActive ? 'color-mix(in srgb, var(--color-primary) 35%, transparent)' : 'transparent'}`, background: isActive ? 'var(--color-primary-dim)' : 'transparent', color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)', transition: 'all 0.12s' }}
                      onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = 'var(--color-card)'; e.currentTarget.style.color = 'var(--color-text-primary)' } }}
                      onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)' } }}
                    >
                      {type === 'all' && (
                        <span style={{ width: 7, height: 7, borderRadius: 2, background: typeColor, display: 'inline-block', flexShrink: 0, opacity: 0.9 }} />
                      )}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        {catSourceIds.map((sid) => colorMap[sid] && (
                          <span key={sid} style={{ width: 5, height: 5, borderRadius: '50%', background: colorMap[sid].accent, display: 'inline-block', flexShrink: 0 }} />
                        ))}
                      </span>
                      {cat.name}
                      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                        {cat.item_count > 999 ? (cat.item_count / 1000).toFixed(1) + 'k' : cat.item_count}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Divider + size toggle button */}
          <div style={{ position: 'relative', height: 0, borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
            <button
              onClick={() => setCatSize(s => ((s + 1) % 3) as 0 | 1 | 2)}
              title={['3 rows → 6 rows', '6 rows → 10 rows', '10 rows → 3 rows'][catSize]}
              style={{
                position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                width: 22, height: 22, borderRadius: '50%', zIndex: 5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--color-surface)', border: '1px solid var(--color-border-strong)',
                color: 'var(--color-text-muted)', cursor: 'pointer', transition: 'all 0.1s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.color = 'var(--color-primary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
            >
              {catSize === 2
                ? <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
                : <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
              }
            </button>
          </div>
        </div>
      )}

      {/* ── Toolbar: count + inline search + sort ──────────────────────── */}
      {!isSearching && total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', flexShrink: 0, minHeight: 36 }}>
          {/* Item count */}
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>
            {total.toLocaleString()} {total === 1 ? 'item' : 'items'}
            {activeCategory && <span style={{ marginLeft: 4 }}>in <span style={{ color: 'var(--color-text-secondary)' }}>{activeCategory}</span></span>}
          </span>

          {browseFetching && (
            <span style={{ fontSize: 10, color: 'var(--color-accent)', opacity: 0.7 }}>Loading…</span>
          )}

          <div style={{ flex: 1 }} />

          {/* Future filter placeholders */}
          <DisabledBtn label="Genre" title="Genre filter — coming soon" />
          <DisabledBtn label="Year" title="Year filter — coming soon" />

          {/* Sort dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowSortMenu(v => !v) }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 6, border: '1px solid var(--color-border-strong)', background: showSortMenu ? 'var(--color-card)' : 'transparent', color: 'var(--color-text-secondary)', fontSize: 11, cursor: 'pointer', transition: 'all 0.1s', whiteSpace: 'nowrap' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-card)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
              onMouseLeave={(e) => { if (!showSortMenu) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)' } }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M7 12h10M11 18h2" /></svg>
              {sort.label}
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
            </button>

            {showSortMenu && (
              <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: 8, padding: '4px', zIndex: 50, minWidth: 130, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                {SORT_OPTIONS.map((opt, i) => (
                  <button key={i} onClick={() => { setSortIdx(i); setShowSortMenu(false) }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', borderRadius: 5, border: 'none', background: i === sortIdx ? 'var(--color-primary-dim)' : 'transparent', color: i === sortIdx ? 'var(--color-primary)' : 'var(--color-text-secondary)', fontSize: 11, cursor: 'pointer', fontWeight: i === sortIdx ? 500 : 400 }}
                    onMouseEnter={(e) => { if (i !== sortIdx) { e.currentTarget.style.background = 'var(--color-card-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)' } }}
                    onMouseLeave={(e) => { if (i !== sortIdx) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)' } }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div id="browse-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <AnimatePresence mode="wait">
          {isSearching ? (
            <SearchPane key="search" query={query}
              live={{   results: liveSearchResults   as ContentItem[], fetching: liveFetching,   limit: liveLimit,   onLoadMore: () => setLiveLimit(l => l + defaultLive)   }}
              movies={{  results: movieSearchResults  as ContentItem[], fetching: movieFetching,  limit: movieLimit,  onLoadMore: () => setMovieLimit(l => l + defaultMovie)  }}
              series={{  results: seriesSearchResults as ContentItem[], fetching: seriesFetching, limit: seriesLimit, onLoadMore: () => setSeriesLimit(l => l + defaultSeries) }}
              onSelect={onSelectContent} scopedTo={activeCategory}
            />
          ) : (
            <BrowsePane key={`browse-${type}-${activeCategory ?? ''}`} items={items} fetching={browseFetching} onSelect={onSelectContent} type={type} hasCategory={!!activeCategory} />
          )}
        </AnimatePresence>
      </div>

      {/* ── Pagination ─────────────────────────────────────────────────── */}
      {!isSearching && total > PAGE_SIZE && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPage={(p) => { setPage(p); document.getElementById('browse-scroll')?.scrollTo(0, 0) }}
        />
      )}
    </div>
  )
}

// ── Search results pane ─────────────────────────────────────────────────────

interface TypeBucket { results: ContentItem[]; fetching: boolean; limit: number; onLoadMore: () => void }

function SearchPane({ query, live, movies, series, onSelect, scopedTo }: {
  query: string
  live: TypeBucket; movies: TypeBucket; series: TypeBucket
  onSelect: (item: ContentItem) => void; scopedTo?: string | null
}) {
  const liveAtLimit   = live.results.length   >= live.limit
  const movieAtLimit  = movies.results.length >= movies.limit
  const seriesAtLimit = series.results.length >= series.limit
  const anyFetching   = live.fetching || movies.fetching || series.fetching
  const total = live.results.length + movies.results.length + series.results.length
  const anyAtLimit = liveAtLimit || movieAtLimit || seriesAtLimit
  const countLabel = anyAtLimit ? `${total}+` : String(total)

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}
      style={{ padding: '10px 16px 16px' }}>
      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 14 }}>
        {anyFetching && total === 0
          ? <span style={{ color: 'var(--color-accent)', opacity: 0.7 }}>Searching…</span>
          : <>
              <span style={{ color: 'var(--color-text-secondary)' }}>{countLabel}</span>
              {' results for '}
              <span style={{ color: 'var(--color-text-primary)' }}>"{query}"</span>
              {scopedTo && <span style={{ color: 'var(--color-text-muted)' }}> in <span style={{ color: 'var(--color-text-secondary)' }}>{scopedTo}</span></span>}
            </>
        }
      </p>

      {total === 0 && !anyFetching && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 60 }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--color-text-muted)' }}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>No results for "{query.startsWith('@') ? query.slice(1).trim() : query}"</p>
        </div>
      )}

      {live.results.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Live Channels <span style={{ fontWeight: 400, opacity: 0.6 }}>({liveAtLimit ? `${live.results.length}+` : live.results.length})</span></SectionLabel>
          <ChannelGrid items={live.results} onSelect={onSelect} />
          {liveAtLimit && !live.fetching && <LoadMoreBtn onClick={live.onLoadMore} />}
        </div>
      )}

      {movies.results.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Movies <span style={{ fontWeight: 400, opacity: 0.6 }}>({movieAtLimit ? `${movies.results.length}+` : movies.results.length})</span></SectionLabel>
          <PosterGrid items={movies.results} onSelect={onSelect} />
          {movieAtLimit && !movies.fetching && <LoadMoreBtn onClick={movies.onLoadMore} />}
        </div>
      )}

      {series.results.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Series <span style={{ fontWeight: 400, opacity: 0.6 }}>({seriesAtLimit ? `${series.results.length}+` : series.results.length})</span></SectionLabel>
          <PosterGrid items={series.results} onSelect={onSelect} />
          {seriesAtLimit && !series.fetching && <LoadMoreBtn onClick={series.onLoadMore} />}
        </div>
      )}
    </motion.div>
  )
}

function LoadMoreBtn({ onClick }: { onClick: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
      <button onClick={onClick} style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border-strong)',
        borderRadius: 6, color: 'var(--color-text-secondary)', cursor: 'pointer',
        fontSize: 11, padding: '5px 18px', transition: 'all 0.1s',
      }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.color = 'var(--color-primary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}
      >
        Load more
      </button>
    </div>
  )
}

// ── Browse pane ─────────────────────────────────────────────────────────────

function BrowsePane({ items, fetching, onSelect, type, hasCategory }: {
  items: ContentItem[]; fetching: boolean; onSelect: (item: ContentItem) => void; type: ContentType; hasCategory: boolean
}) {
  const liveItems = items.filter(i => i.type === 'live')
  const mediaItems = items.filter(i => i.type !== 'live')

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}
      style={{ padding: '14px 16px 20px' }}>

      {/* Personalized rows — only on default browse, no category filter */}
      {!hasCategory && <PersonalizedRows onSelect={onSelect} type={type} />}

      {items.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {fetching ? 'Loading…' : 'No content found'}
          </p>
        </div>
      )}

      {liveItems.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {type === 'all' && <SectionLabel>Channels</SectionLabel>}
          <ChannelGrid items={liveItems} onSelect={onSelect} />
        </div>
      )}

      {mediaItems.length > 0 && (
        <div>
          {type === 'all' && liveItems.length > 0 && <SectionLabel>Movies &amp; Series</SectionLabel>}
          <PosterGrid items={mediaItems} onSelect={onSelect} />
        </div>
      )}
    </motion.div>
  )
}

// ── Poster grid — no per-card animations (performance) ──────────────────────

function ChannelGrid({ items, onSelect }: { items: ContentItem[]; onSelect: (item: ContentItem) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(158px, 1fr))', gap: 10 }}>
      {items.map(item => <ChannelCard key={item.id} item={item} onClick={onSelect} />)}
    </div>
  )
}

function PosterGrid({ items, onSelect }: { items: ContentItem[]; onSelect: (item: ContentItem) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(154px, 1fr))', gap: 12 }}>
      {items.map(item => <PosterCard key={item.id} item={item} onClick={onSelect} />)}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 10 }}>
      {children}
    </p>
  )
}

// Placeholder button for future filters
function DisabledBtn({ label, title }: { label: string; title: string }) {
  return (
    <button title={title} disabled style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 11, cursor: 'not-allowed', opacity: 0.4 }}>
      {label}
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
    </button>
  )
}
