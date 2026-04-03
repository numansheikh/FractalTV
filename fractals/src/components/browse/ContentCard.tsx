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

const TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  live:   { label: 'Live',   color: 'var(--color-live)',   bg: 'rgba(251,113,133,0.1)' },
  movie:  { label: 'Film',   color: 'var(--color-movie)',  bg: 'rgba(96,165,250,0.1)'  },
  series: { label: 'Series', color: 'var(--color-series)', bg: 'rgba(134,239,172,0.1)' },
}

export function ContentCard({ item, onClick }: Props) {
  const genres = item.genres ? tryParseGenres(item.genres).slice(0, 2) : []
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
      className="group flex cursor-pointer items-center gap-3 rounded-xl mx-2"
      style={{ padding: '10px 12px', transition: 'background 0.1s' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-card)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Poster thumbnail */}
      <div
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg"
        style={{
          width: '40px',
          height: '54px',
          background: 'var(--color-card)',
          border: '1px solid var(--color-border)',
        }}
      >
        {item.posterUrl ? (
          <img src={item.posterUrl} alt="" className="h-full w-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }} />
        ) : (
          <TypeIcon type={item.type} />
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" style={{ color: 'var(--color-text-primary)', lineHeight: '1.4' }}>
          {item.title}
        </p>

        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {/* Type badge */}
          <span
            className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ color: meta.color, background: meta.bg }}
          >
            {meta.label}
          </span>

          {item.year && (
            <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              {item.year}
            </span>
          )}

          {rating && (
            <span className="flex items-center gap-0.5 text-[11px]" style={{ color: 'var(--color-warning)' }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              {rating.toFixed(1)}
            </span>
          )}

          {genres.length > 0 && (
            <span className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>
              {genres.join(' · ')}
            </span>
          )}
        </div>
      </div>

      {/* Source count badge */}
      {sourceCount > 1 && (
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-mono"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
        >
          ×{sourceCount}
        </span>
      )}

      {/* Play chevron */}
      <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: 'var(--color-text-muted)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </motion.div>
  )
}

function tryParseGenres(genres: string): string[] {
  try { return JSON.parse(genres) as string[] }
  catch { return [genres] }
}

function TypeIcon({ type }: { type: string }) {
  const color = 'var(--color-text-muted)'
  if (type === 'live') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      <rect x="2" y="7" width="20" height="15" rx="2" /><polyline points="17 2 12 7 7 2" />
    </svg>
  )
  if (type === 'series') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <path d="M7 2v20M17 2v20M2 12h20" />
    </svg>
  )
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <polygon points="10 8 16 12 10 16 10 8" fill={color} stroke="none" />
    </svg>
  )
}
