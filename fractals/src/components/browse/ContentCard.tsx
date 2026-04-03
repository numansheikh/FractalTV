import { motion } from 'framer-motion'

export interface ContentItem {
  id: string
  type: 'live' | 'movie' | 'series'
  title: string
  year?: number
  plot?: string
  posterUrl?: string
  ratingTmdb?: number
  ratingImdb?: number
  genres?: string
  sourceIds?: string
}

interface Props {
  item: ContentItem
  onClick: (item: ContentItem) => void
}

const TYPE_COLORS = {
  live: '#ef5350',
  movie: '#42a5f5',
  series: '#66bb6a',
}

const TYPE_LABELS = {
  live: 'LIVE',
  movie: 'MOVIE',
  series: 'SERIES',
}

export function ContentCard({ item, onClick }: Props) {
  const genres = item.genres ? (JSON.parse(item.genres) as string[]).slice(0, 2) : []
  const rating = item.ratingTmdb ?? item.ratingImdb

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.15 }}
      onClick={() => onClick(item)}
      className="flex cursor-pointer items-center gap-3 rounded-lg p-2.5 transition-colors"
      style={{ background: 'var(--color-card)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-card-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-card)' }}
    >
      {/* Poster / Thumbnail */}
      <div
        className="flex h-14 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded"
        style={{ background: 'var(--color-surface)' }}
      >
        {item.posterUrl ? (
          <img src={item.posterUrl} alt={item.title} className="h-full w-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }} />
        ) : (
          <span className="text-lg">{item.type === 'live' ? '📺' : item.type === 'series' ? '📽' : '🎬'}</span>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className="rounded px-1 py-0.5 text-[10px] font-bold tracking-wide"
            style={{ background: `${TYPE_COLORS[item.type]}22`, color: TYPE_COLORS[item.type] }}
          >
            {TYPE_LABELS[item.type]}
          </span>
          {item.year && (
            <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{item.year}</span>
          )}
          {rating && (
            <span className="text-[11px]" style={{ color: 'var(--color-warning)' }}>★ {rating.toFixed(1)}</span>
          )}
        </div>

        <p className="truncate text-sm font-medium leading-snug" style={{ color: 'var(--color-text-primary)' }}>
          {item.title}
        </p>

        {genres.length > 0 && (
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {genres.join(' · ')}
          </p>
        )}
      </div>

      {/* Source count */}
      {item.sourceIds && item.sourceIds.split(',').length > 1 && (
        <span className="text-[10px] rounded px-1.5 py-0.5 flex-shrink-0"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}>
          {item.sourceIds.split(',').length} sources
        </span>
      )}
    </motion.div>
  )
}
