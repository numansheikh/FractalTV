import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api } from '@/lib/api'
import { ContentItem } from '@/components/browse/ContentCard'

interface Props {
  item: ContentItem
  onPlay: (item: ContentItem) => void
  onClose: () => void
}

const TYPE_META: Record<string, { label: string; color: string }> = {
  live:   { label: 'Live TV',  color: 'var(--color-live)'   },
  movie:  { label: 'Movie',    color: 'var(--color-movie)'  },
  series: { label: 'Series',   color: 'var(--color-series)' },
}

export function ContentDetail({ item, onPlay, onClose }: Props) {
  const { data: full } = useQuery({
    queryKey: ['content', item.id],
    queryFn: () => api.content.get(item.id),
  })

  const c = (full as any) ?? item
  const genres: string[] = c.genres ? tryParse(c.genres) : []
  const cast: string[] = c.cast ? tryParse(c.cast) : []
  const rating = c.ratingTmdb ?? c.rating_tmdb ?? c.ratingImdb ?? c.rating_imdb
  const plot = c.plot
  const year = c.year
  const runtime = c.runtime
  const director = c.director
  const meta = TYPE_META[item.type]

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Panel — slides in from right */}
      <motion.div
        initial={{ x: '100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        className="fixed right-0 top-0 z-50 flex h-full flex-col overflow-hidden"
        style={{
          width: '360px',
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border-strong)',
          boxShadow: '-24px 0 48px rgba(0,0,0,0.4)',
        }}
      >
        {/* Backdrop image */}
        {c.backdropUrl || c.backdrop_url ? (
          <div
            className="relative shrink-0 overflow-hidden"
            style={{ height: '180px' }}
          >
            <img
              src={c.backdropUrl ?? c.backdrop_url}
              alt=""
              className="h-full w-full object-cover"
              style={{ opacity: 0.6 }}
            />
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, var(--color-surface) 100%)' }}
            />
          </div>
        ) : (
          <div className="shrink-0" style={{ height: '20px' }} />
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex items-center justify-center rounded-full p-2 transition-colors"
          style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', backdropFilter: 'blur(8px)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.75)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.5)' }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>

        {/* Content */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '0 20px 24px' }}>
          {/* Poster + title row */}
          <div className="flex gap-4 mb-5" style={{ marginTop: (c.backdropUrl || c.backdrop_url) ? '-40px' : '16px', position: 'relative', zIndex: 1 }}>
            {/* Poster */}
            <div
              className="shrink-0 overflow-hidden rounded-xl"
              style={{
                width: '72px', height: '104px',
                background: 'var(--color-card)',
                border: '2px solid var(--color-border-strong)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}
            >
              {(c.posterUrl || c.poster_url) && (
                <img src={c.posterUrl ?? c.poster_url} alt="" className="h-full w-full object-cover" />
              )}
            </div>

            {/* Title */}
            <div className="flex flex-col justify-end pb-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                {year && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{year}</span>}
                {runtime && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{runtime}m</span>}
              </div>
              <h1 className="text-base font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                {c.title}
              </h1>
              {rating && (
                <div className="mt-1 flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--color-warning)">
                    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  <span className="text-xs font-medium" style={{ color: 'var(--color-warning)' }}>
                    {Number(rating).toFixed(1)}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>/10</span>
                </div>
              )}
            </div>
          </div>

          {/* Play button */}
          <button
            onClick={() => onPlay(item)}
            className="mb-5 flex w-full items-center justify-center gap-2.5 rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            {item.type === 'live' ? 'Watch Live' : 'Play'}
          </button>

          {/* Genres */}
          {genres.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {genres.map((g) => (
                <span key={g} className="rounded-lg px-2.5 py-1 text-xs"
                  style={{ background: 'var(--color-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Plot */}
          {plot && (
            <div className="mb-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Overview</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{plot}</p>
            </div>
          )}

          {/* Director */}
          {director && (
            <MetaRow label="Director" value={director} />
          )}

          {/* Cast */}
          {cast.length > 0 && (
            <div className="mb-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Cast</p>
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)', lineHeight: '1.7' }}>
                {cast.slice(0, 8).join(', ')}
                {cast.length > 8 && <span style={{ color: 'var(--color-text-muted)' }}> +{cast.length - 8} more</span>}
              </p>
            </div>
          )}

          {/* No metadata hint */}
          {!plot && !director && cast.length === 0 && genres.length === 0 && (
            <p className="text-xs text-center py-4" style={{ color: 'var(--color-text-muted)', lineHeight: '1.7' }}>
              No metadata yet.{' '}
              <span style={{ color: 'var(--color-accent)' }}>
                Add a TMDB API key in Settings to enrich your library.
              </span>
            </p>
          )}
        </div>
      </motion.div>
    </>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3">
      <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{value}</p>
    </div>
  )
}

function tryParse(s: string): string[] {
  try { return JSON.parse(s) } catch { return [s] }
}
