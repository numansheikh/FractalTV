import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '@/lib/api'
import { ContentItem } from './ContentCard'
import { PosterCard } from './PosterCard'
import { ChannelCard } from './ChannelCard'
import { Pagination } from './Pagination'
import { useSearchStore, ContentType } from '@/stores/search.store'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SourceTabBar } from '@/components/settings/SourceTabBar'
import { FractalsIcon } from '@/components/shared/FractalsIcon'
import { PersonalizedRows } from './PersonalizedRows'

const TYPE_TABS: { label: string; value: ContentType }[] = [
  { label: 'All',     value: 'all'    },
  { label: 'Live TV', value: 'live'   },
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

const LEFT_WIDTH = 220

interface Props {
  onAddSource: () => void
  onSyncSource: (id: string) => void
  onRemoveSource: (id: string) => void
  onSelectContent: (item: ContentItem) => void
  sourcesCount: number
}

export function BrowseViewH({ onAddSource, onSyncSource, onRemoveSource, onSelectContent, sourcesCount }: Props) {
  const { query, type, setType, activeCategory, setActiveCategory } = useSearchStore()
  const { sources, selectedSourceIds } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)

  const [categoryFilter, setCategoryFilter] = useState('')
  const [catSort, setCatSort] = useState<'count' | 'name' | 'provider'>('count')
  const [page, setPage] = useState(1)
  const [sortIdx, setSortIdx] = useState(0)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const leftWidth = LEFT_WIDTH

  const isSearching = query.trim().length > 0
  const srcFilter = selectedSourceIds.length > 0 ? selectedSourceIds : undefined
  const browseType = type === 'all' ? undefined : (type as 'live' | 'movie' | 'series')
  const sort = SORT_OPTIONS[sortIdx]

  // Reset page + category filter when context changes
  useEffect(() => {
    setPage(1)
    setCategoryFilter('')
    setCatSort('count')
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

  const filteredCategories = (categories as any[])
    .filter(c => !categoryFilter || c.name.toLowerCase().includes(categoryFilter.toLowerCase()))
    .sort((a, b) =>
      catSort === 'name'     ? a.name.localeCompare(b.name) :
      catSort === 'provider' ? (a.position ?? 0) - (b.position ?? 0) :
      b.item_count - a.item_count
    )

  // ── Per-type search limits (independent so each section can load more) ─────
  const PAGE_SIZE = getPageSize()
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

      {/* ── Horizontal split: left=categories, right=content ───────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>

        {/* ── Left pane: category list ──────────────────────────────────── */}
        <div style={{
          width: leftWidth,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--color-surface)',
          borderRight: 'none',
          transition: 'width 0.2s ease',
        }}>
          {/* Category filter input + sort toggle */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 0 }}>
              <div style={{ position: 'relative', flex: 1 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                placeholder="Filter categories…"
                style={{
                  width: '100%',
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border-strong)',
                  boxShadow: '0 0 0 1px var(--color-border)',
                  borderRadius: 6,
                  padding: '5px 8px 5px 26px',
                  fontSize: 11,
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.15s',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = 'none' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.boxShadow = '0 0 0 1px var(--color-border)' }}
              />
              {categoryFilter && (
                <button
                  onClick={() => setCategoryFilter('')}
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                >
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l10 10M11 1L1 11" /></svg>
                </button>
              )}
              </div>

              {/* Sort segmented control */}
              <div style={{
                flexShrink: 0, display: 'flex',
                border: '1px solid var(--color-border-strong)', borderRadius: 5, overflow: 'hidden',
              }}>
                {([
                  { key: 'count',    label: '#',   title: 'Sort by count' },
                  { key: 'name',     label: 'A–Z', title: 'Sort A–Z' },
                  { key: 'provider', label: '↕',   title: 'Provider order' },
                ] as const).map(({ key, label, title }) => {
                  const active = catSort === key
                  return (
                    <button key={key} onClick={() => setCatSort(key)}
                      title={title}
                      style={{
                        background: active ? 'var(--color-primary)' : 'none',
                        border: 'none', cursor: 'pointer',
                        padding: '4px 7px',
                        color: active ? '#fff' : 'var(--color-text-muted)',
                        fontSize: 9, fontWeight: 600, letterSpacing: '0.04em',
                        transition: 'background 0.1s, color 0.1s',
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--color-text-secondary)' }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--color-text-muted)' }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Category rows */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            {/* "All" row */}
            <CategoryRow
              name="All"
              count={total}
              isActive={activeCategory === null}
              dots={[]}
              onClick={() => setActiveCategory(null)}
              typeColor={TYPE_COLORS[type]}
            />

            {filteredCategories.length === 0 && categoryFilter ? (
              <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                No categories match
              </div>
            ) : (
              filteredCategories.map((cat: any) => {
                const catSourceIds: string[] = cat.source_ids ? cat.source_ids.split(',') : []
                const dots = catSourceIds.filter((sid) => !!colorMap[sid]).map((sid) => colorMap[sid].accent)
                const catTypeColor = type === 'all' ? TYPE_COLORS[cat.type] : TYPE_COLORS[type]
                return (
                  <CategoryRow
                    key={cat.name + cat.type}
                    name={cat.name}
                    count={cat.item_count}
                    isActive={activeCategory === cat.name}
                    dots={dots}
                    onClick={() => setActiveCategory(activeCategory === cat.name ? null : cat.name)}
                    typeColor={catTypeColor}
                  />
                )
              })
            )}
          </div>
        </div>

        {/* ── Divider ───────────────────────────────────────────────────── */}
        <div style={{ width: 1, flexShrink: 0, background: 'var(--color-border)' }} />

        {/* ── Right pane: toolbar + content grid + pagination ───────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* ── Right pane toolbar: count + sort ─────────────────────── */}
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

          {/* ── Content area ─────────────────────────────────────────────── */}
          <div id="browse-scroll-h" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
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

          {/* ── Pagination ───────────────────────────────────────────────── */}
          {!isSearching && total > PAGE_SIZE && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onPage={(p) => { setPage(p); document.getElementById('browse-scroll-h')?.scrollTo(0, 0) }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Category row ────────────────────────────────────────────────────────────

function CategoryRow({ name, count, isActive, dots, onClick, typeColor }: {
  name: string
  count: number
  isActive: boolean
  dots: string[]
  onClick: () => void
  typeColor?: string
}) {
  const tc = typeColor ?? 'var(--color-primary)'
  // Every row gets a type-color tint; active intensifies it
  const restBg   = typeColor ? `color-mix(in srgb, ${tc} 17%, transparent)` : 'transparent'
  const activeBg = `color-mix(in srgb, ${tc} 51%, transparent)`
  const hoverBg  = `color-mix(in srgb, ${tc} 34%, transparent)`

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        padding: '7px 12px',
        border: 'none',
        borderLeft: `3px solid ${isActive ? tc : typeColor ? `color-mix(in srgb, ${tc} 40%, transparent)` : 'transparent'}`,
        borderBottom: `1px solid color-mix(in srgb, ${tc} ${isActive ? 20 : 10}%, transparent)`,
        background: isActive ? activeBg : restBg,
        color: isActive ? tc : 'var(--color-text-secondary)',
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: 12,
        fontWeight: isActive ? 600 : 400,
        transition: 'all 0.12s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = hoverBg
          e.currentTarget.style.color = tc
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = restBg
          e.currentTarget.style.color = 'var(--color-text-secondary)'
        }
      }}
    >
      {/* Source dots */}
      {dots.length > 0 && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {dots.map((color, i) => (
            <span key={i} style={{
              width: 5, height: 5, borderRadius: '50%',
              background: color,
              display: 'inline-block', flexShrink: 0,
            }} />
          ))}
        </span>
      )}

      {/* Category name — truncated */}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
        {name}
      </span>

      {/* Item count */}
      <span style={{
        fontSize: 10,
        color: isActive ? tc : 'var(--color-text-muted)',
        fontFamily: 'monospace', flexShrink: 0, opacity: isActive ? 0.8 : 0.7,
      }}>
        {count > 999 ? (count / 1000).toFixed(1) + 'k' : count}
      </span>
    </button>
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
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>No results for "{query}"</p>
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
  const movieItems = items.filter(i => i.type === 'movie')
  const seriesItems = items.filter(i => i.type === 'series')

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
          {type === 'all' && <SectionLabel>Live TV</SectionLabel>}
          <ChannelGrid items={liveItems} onSelect={onSelect} />
        </div>
      )}

      {movieItems.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {type === 'all' && <SectionLabel>Movies</SectionLabel>}
          <PosterGrid items={movieItems} onSelect={onSelect} />
        </div>
      )}

      {seriesItems.length > 0 && (
        <div>
          {type === 'all' && <SectionLabel>Series</SectionLabel>}
          <PosterGrid items={seriesItems} onSelect={onSelect} />
        </div>
      )}
    </motion.div>
  )
}

// ── Grids ───────────────────────────────────────────────────────────────────

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
