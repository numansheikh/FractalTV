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

  const searchType = type === 'all' ? undefined : (type as 'live' | 'movie' | 'series')

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['search', query, type],
    queryFn: () => api.search.query({ query, type: searchType, limit: 200 }),
    placeholderData: (prev) => prev,
  })

  // Empty state — no sources added yet
  if (sourcesCount === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <div style={{ opacity: 0.6 }}>
          <FractalsIcon size={40} />
        </div>
        <div className="text-center">
          <h2
            className="mb-1 text-sm font-semibold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            No sources yet
          </h2>
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)', maxWidth: '220px', lineHeight: '1.6' }}>
            Add an Xtream Codes account to start browsing channels, movies, and series.
          </p>
        </div>
        <button
          onClick={onAddSource}
          className="rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          Add source
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Status bar */}
      <div
        className="flex items-center justify-between"
        style={{ padding: '4px 12px 4px', borderBottom: '1px solid var(--color-border)' }}
      >
        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {isFetching ? (
            <span style={{ color: 'var(--color-primary)', opacity: 0.7 }}>Searching…</span>
          ) : query ? (
            <>
              <span style={{ color: 'var(--color-text-secondary)' }}>{results.length}</span>
              {' results for '}
              <span style={{ color: 'var(--color-text-primary)' }}>"{query}"</span>
            </>
          ) : (
            <span style={{ color: 'var(--color-text-muted)' }}>
              {results.length > 0 ? `${results.length.toLocaleString()} items` : ''}
            </span>
          )}
        </span>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '4px 4px' }}>
        <AnimatePresence mode="popLayout">
          {results.length === 0 && !isFetching ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-2 py-12"
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {query ? `No results for "${query}"` : 'Sync a source to see content'}
              </p>
            </motion.div>
          ) : (
            <div>
              {results.map((item: ContentItem) => (
                <ContentCard key={item.id} item={item} onClick={onSelectContent} />
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
