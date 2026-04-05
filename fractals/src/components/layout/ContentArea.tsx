import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/stores/app.store'
import { useSearchStore } from '@/stores/search.store'
import { useUserStore } from '@/stores/user.store'
import { api } from '@/lib/api'
import { ContentItem, ActiveView } from '@/lib/types'
import { FilterBar } from './FilterBar'
import { EmptyState } from '@/components/shared/EmptyState'

// Lazy imports — will be provided by agents
let VirtualGrid: any = null
let PersonalizedSection: any = null
let SearchResults: any = null
let LibraryView: any = null

// We load them dynamically to allow agents to write them independently
async function loadComponents() {
  try {
    const [g, p, s, l] = await Promise.all([
      import('@/components/grids/VirtualGrid').catch(() => null),
      import('@/components/grids/PersonalizedSection').catch(() => null),
      import('@/components/search/SearchResults').catch(() => null),
      import('@/components/library/LibraryView').catch(() => null),
    ])
    if (g) VirtualGrid = g.VirtualGrid
    if (p) PersonalizedSection = p.PersonalizedSection
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

interface Props {
  sort: string
  onSelectContent: (item: ContentItem) => void
  onAddSource: () => void
}

export function ContentArea({ sort, onSelectContent, onAddSource }: Props) {
  const { activeView, typeFilter, categoryFilter, selectedSourceIds } = useAppStore()
  const { query } = useSearchStore()
  const { loadBulk } = useUserStore()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    loadComponents().then(() => setReady(true))
  }, [])

  const contentType = VIEW_TYPE[activeView] ?? (typeFilter !== 'all' ? (typeFilter === 'movie' ? 'movie' : typeFilter) as any : undefined)
  const [sortBy, sortDir] = sort.split(':') as [string, 'asc' | 'desc']

  // Browse query for grid
  const { data: browseData, isLoading } = useQuery({
    queryKey: ['browse', contentType, categoryFilter, selectedSourceIds, sortBy, sortDir],
    queryFn: () => api.content.browse({
      type: contentType,
      categoryName: categoryFilter ?? undefined,
      sourceIds: selectedSourceIds.length ? selectedSourceIds : undefined,
      sortBy,
      sortDir,
      limit: 500,
      offset: 0,
    }),
    staleTime: 30_000,
    enabled: !query && activeView !== 'library',
  })

  // Search query
  const { data: searchResults } = useQuery({
    queryKey: ['search', query, contentType, categoryFilter, selectedSourceIds],
    queryFn: () => api.search.query({
      query,
      type: contentType,
      categoryName: categoryFilter ?? undefined,
      sourceIds: selectedSourceIds.length ? selectedSourceIds : undefined,
      limit: 60,
    }),
    staleTime: 10_000,
    enabled: !!query,
  })

  const items: ContentItem[] = ((query ? searchResults : browseData?.items) ?? []) as ContentItem[]
  const total: number = query ? items.length : (browseData?.total ?? 0)

  // Bulk-load user data for visible items
  useEffect(() => {
    if (items.length > 0) {
      loadBulk(items.map((i) => i.id))
    }
  }, [items, loadBulk])

  const isEmpty = !isLoading && items.length === 0

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

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <FilterBar itemCount={total > 0 ? total : undefined} />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Search results */}
        {query && (
          ready && SearchResults
            ? <SearchResults items={items} onSelect={onSelectContent} />
            : <FallbackGrid items={items} onSelect={onSelectContent} />
        )}

        {/* Browse mode */}
        {!query && (
          <>
            {/* Personalized rows (home only, no category filter) */}
            {activeView === 'home' && !categoryFilter && ready && PersonalizedSection && (
              <PersonalizedSection onSelect={onSelectContent} />
            )}

            {/* No sources empty state */}
            {isEmpty && !isLoading && (
              <EmptyState
                icon={<PlayIcon />}
                title="Add your first source"
                description="Connect an Xtream Codes account to start browsing your content."
                action={{ label: 'Add source', onClick: onAddSource }}
                hint="⌘, to open settings"
              />
            )}

            {/* Content grid */}
            {!isEmpty && (
              ready && VirtualGrid
                ? <VirtualGrid items={items} onSelect={onSelectContent} />
                : <FallbackGrid items={items} onSelect={onSelectContent} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Fallback non-virtualized grid while VirtualGrid loads
function FallbackGrid({ items, onSelect }: { items: ContentItem[]; onSelect: (i: ContentItem) => void }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
      gap: 8,
      padding: 16,
    }}>
      {items.map((item) => (
        <div
          key={item.id}
          onClick={() => onSelect(item)}
          style={{
            borderRadius: 6,
            background: 'var(--bg-2)',
            border: '1px solid var(--border-subtle)',
            cursor: 'pointer',
            overflow: 'hidden',
          }}
        >
          <div style={{ aspectRatio: '2/3', background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {(item.posterUrl || item.poster_url) && (
              <img src={item.posterUrl ?? item.poster_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => { e.currentTarget.style.display = 'none' }} />
            )}
          </div>
          <div style={{ padding: '6px 8px' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-0)', margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {item.title}
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-2)', margin: '2px 0 0' }}>
              {item.year}{item.ratingTmdb ? ` · ★${item.ratingTmdb.toFixed(1)}` : ''}
            </p>
          </div>
        </div>
      ))}
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
