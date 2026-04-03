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

  const searchType = type === 'all' ? undefined : type as 'live' | 'movie' | 'series'

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['search', query, type],
    queryFn: () => api.search.query({ query, type: searchType, limit: 100 }),
    placeholderData: (prev) => prev,
  })

  // Empty state — no sources added yet
  if (sourcesCount === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
        <FractalsIcon size={56} />
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
            No sources yet
          </h2>
          <p className="text-sm max-w-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Add an Xtream Codes account to start browsing your channels, movies, and series.
          </p>
        </div>
        <button
          onClick={onAddSource}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          + Add Xtream Source
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Results count */}
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {isFetching ? 'Searching...' : query ? `${results.length} results for "${query}"` : `${results.length} items`}
        </span>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <AnimatePresence mode="popLayout">
          {results.length === 0 && !isFetching ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-3 py-16">
              <span className="text-3xl">🔍</span>
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {query ? `No results for "${query}"` : 'Nothing here yet — try syncing your sources'}
              </p>
            </motion.div>
          ) : (
            <div className="flex flex-col gap-1">
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
