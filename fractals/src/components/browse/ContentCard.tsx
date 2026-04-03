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

const TYPE_META: Record<string, { label: string; color: string }> = {
  live: { label: 'Live', color: 'var(--color-live)' },
  movie: { label: 'Film', color: 'var(--color-movie)' },
  series: { label: 'Series', color: 'var(--color-series)' },
}

export function ContentCard({ item, onClick }: Props) {
  const genres = item.genres ? (JSON.parse(item.genres) as string[]).slice(0, 2) : []
  const rating = item.ratingTmdb ?? item.ratingImdb
  const meta = TYPE_META[item.type]
  const sourceCount = item.sourceIds ? item.sourceIds.split(',').length : 1

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onClick={() => onClick(item)}
      className="group flex cursor-pointer items-center gap-3 rounded-lg"
      style={{ padding: '7px 10px', transition: 'background 0.1s' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-card)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Poster */}
      <div
        className="flex shrink-0 items-center justify-center overflow-hidden rounded"
        style={{
          width: '36px',
          height: '50px',
          background: 'var(--color-card)',
          border: '1px solid var(--color-border)',
        }}
      >
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <TypeIcon type={item.type} />
        )}
      </div>

      {/* Main info */}
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium leading-snug"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {item.title}
        </p>

        <div className="mt-0.5 flex items-center gap-2">
          {/* Type badge */}
          <span
            className="text-[10px] font-semibold"
            style={{ color: meta.color, opacity: 0.85 }}
          >
            {meta.label}
          </span>

          {item.year && (
            <>
              <Dot />
              <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {item.year}
              </span>
            </>
          )}

          {rating && (
            <>
              <Dot />
              <span
                className="flex items-center gap-0.5 text-[11px]"
                style={{ color: 'var(--color-warning)' }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                  <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {rating.toFixed(1)}
              </span>
            </>
          )}

          {genres.length > 0 && (
            <>
              <Dot />
              <span className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                {genres.join(', ')}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right side — source count */}
      {sourceCount > 1 && (
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium font-mono"
          style={{
            background: 'var(--color-surface)',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
          }}
        >
          ×{sourceCount}
        </span>
      )}

      {/* Play arrow on hover */}
      <div
        className="shrink-0 transition-opacity opacity-0 group-hover:opacity-100"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </motion.div>
  )
}

function Dot() {
  return (
    <span
      className="rounded-full"
      style={{ width: '2px', height: '2px', background: 'var(--color-text-muted)', flexShrink: 0 }}
    />
  )
}

function TypeIcon({ type }: { type: string }) {
  if (type === 'live') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--color-text-muted)' }}>
        <rect x="2" y="7" width="20" height="15" rx="2" />
        <polyline points="17 2 12 7 7 2" />
      </svg>
    )
  }
  if (type === 'series') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--color-text-muted)' }}>
        <rect x="2" y="2" width="20" height="20" rx="2" />
        <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--color-text-muted)' }}>
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
    </svg>
  )
}
