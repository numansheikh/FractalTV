import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '@/lib/api'
import { ContentCard, ContentItem } from './ContentCard'
import { useSearchStore } from '@/stores/search.store'
import { FractalsIcon } from '@/components/shared/FractalsIcon'

interface Props {
  onAddSource: () => void
  onSelectContent: (item: ContentItem) => void
  sourcesCount: number
}

export function BrowseView({ onAddSource, onSelectContent, sourcesCount }: Props) {
  const { query, type } = useSearchStore()
  const isSearching = query.trim().length > 0

  const searchType = type === 'all' ? undefined : (type as 'live' | 'movie' | 'series')

  // When searching — unified results
  const { data: searchResults = [], isFetching: searchFetching } = useQuery({
    queryKey: ['search', query, type],
    queryFn: () => api.search.query({ query: query.trim(), type: searchType, limit: 100 }),
    enabled: isSearching,
    placeholderData: (prev) => prev,
  })

  // Browse mode — fetch each type separately
  const { data: liveItems = [] } = useQuery({
    queryKey: ['browse', 'live'],
    queryFn: () => api.search.query({ query: '', type: 'live', limit: 50 }),
    enabled: !isSearching && (type === 'all' || type === 'live') && sourcesCount > 0,
    staleTime: 60_000,
  })
  const { data: movieItems = [] } = useQuery({
    queryKey: ['browse', 'movie'],
    queryFn: () => api.search.query({ query: '', type: 'movie', limit: 50 }),
    enabled: !isSearching && (type === 'all' || type === 'movie') && sourcesCount > 0,
    staleTime: 60_000,
  })
  const { data: seriesItems = [] } = useQuery({
    queryKey: ['browse', 'series'],
    queryFn: () => api.search.query({ query: '', type: 'series', limit: 50 }),
    enabled: !isSearching && (type === 'all' || type === 'series') && sourcesCount > 0,
    staleTime: 60_000,
  })

  if (sourcesCount === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8">
        <div style={{ opacity: 0.5 }}><FractalsIcon size={42} /></div>
        <div className="text-center">
          <h2 className="mb-1.5 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            No sources yet
          </h2>
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)', maxWidth: '220px', lineHeight: '1.7' }}>
            Add an Xtream Codes account to start browsing channels, movies, and series.
          </p>
        </div>
        <button
          onClick={onAddSource}
          className="rounded-lg px-5 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          Add source
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {isSearching ? (
        // ── Search results ──────────────────────────────────────────────────
        <div className="flex flex-1 flex-col overflow-hidden">
          <div style={{ padding: '8px 16px 4px' }}>
            <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              {searchFetching ? (
                <span style={{ color: 'var(--color-accent)', opacity: 0.7 }}>Searching…</span>
              ) : (
                <>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{searchResults.length}</span>
                  {' results for '}
                  <span style={{ color: 'var(--color-text-primary)' }}>"{query}"</span>
                </>
              )}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ padding: '4px 0 12px' }}>
            <AnimatePresence mode="popLayout">
              {searchResults.length === 0 && !searchFetching ? (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex flex-col items-center gap-3 py-16">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                    style={{ color: 'var(--color-text-muted)' }}>
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    No results for "{query}"
                  </p>
                </motion.div>
              ) : (
                <div>
                  {searchResults.map((item: ContentItem) => (
                    <ContentCard key={item.id} item={item} onClick={onSelectContent} />
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      ) : (
        // ── Browse mode — sectioned ─────────────────────────────────────────
        <div className="flex-1 overflow-y-auto" style={{ padding: '6px 0 16px' }}>
          {(type === 'all' || type === 'live') && liveItems.length > 0 && (
            <Section title="Live TV" count={liveItems.length} items={liveItems as ContentItem[]} onSelect={onSelectContent} />
          )}
          {(type === 'all' || type === 'movie') && movieItems.length > 0 && (
            <Section title="Movies" count={movieItems.length} items={movieItems as ContentItem[]} onSelect={onSelectContent} />
          )}
          {(type === 'all' || type === 'series') && seriesItems.length > 0 && (
            <Section title="Series" count={seriesItems.length} items={seriesItems as ContentItem[]} onSelect={onSelectContent} />
          )}
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  count,
  items,
  onSelect,
}: {
  title: string
  count: number
  items: ContentItem[]
  onSelect: (item: ContentItem) => void
}) {
  return (
    <div className="mb-2">
      {/* Section header */}
      <div
        className="flex items-center gap-2 mb-1"
        style={{ padding: '6px 18px 4px' }}
      >
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {title}
        </span>
        <span className="text-[11px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
          {count.toLocaleString()}
        </span>
      </div>

      {items.map((item) => (
        <ContentCard key={item.id} item={item} onClick={onSelect} />
      ))}
    </div>
  )
}
