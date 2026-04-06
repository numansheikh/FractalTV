import { useState } from 'react'
import { ContentItem } from '@/lib/types'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { buildColorMap } from '@/lib/sourceColors'
import { PosterPlaceholder } from './PosterPlaceholder'
import { CardActions } from './CardActions'

interface Props {
  item: ContentItem
  onClick: (item: ContentItem) => void
}

export function PosterCard({ item, onClick }: Props) {
  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)

  const sources = useSourcesStore((s) => s.sources)
  const colorMap = buildColorMap(sources.map((s) => s.id))
  const userData = useUserStore((s) => s.data[item.id])

  const poster = item.posterUrl ?? item.poster_url
  const hasPoster = poster && !imgError
  const rating = item.ratingTmdb ?? item.rating_tmdb ?? item.ratingImdb ?? item.rating_imdb
  const primarySourceId = item.primarySourceId ?? item.primary_source_id
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const sourceName = primarySourceId ? sources.find((s) => s.id === primarySourceId)?.name : undefined
  const showSourceBadge = sources.length > 1 && sourceName

  const isFavorite = userData?.favorite === 1
  const isCompleted = userData?.completed === 1
  const progressPct =
    userData?.last_position && item.runtime && !isCompleted
      ? Math.min(100, (userData.last_position / (item.runtime * 60)) * 100)
      : 0

  return (
    <div
      onClick={() => onClick(item)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--bg-2)',
        borderRadius: 6,
        border: `1px solid ${hovered ? 'var(--border-default)' : 'var(--border-subtle)'}`,
        borderLeft: showSourceBadge && sourceColor ? `3px solid ${sourceColor.accent}` : undefined,
        overflow: 'hidden',
        cursor: 'pointer',
        position: 'relative',
        transition: 'border-color 0.12s',
        userSelect: 'none',
      }}
    >
      {/* Poster area — 2:3 aspect ratio */}
      <div style={{ aspectRatio: '2/3', position: 'relative', overflow: 'hidden' }}>
        {hasPoster ? (
          <img
            src={poster}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={() => setImgError(true)}
          />
        ) : (
          <PosterPlaceholder id={item.id} title={item.title} style={{ position: 'absolute', inset: 0 }} />
        )}

        {/* Series type badge — top left */}
        {item.type === 'series' && (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            padding: '2px 5px',
            borderRadius: 3,
            background: 'rgba(16,185,129,0.18)',
            border: '1px solid rgba(16,185,129,0.35)',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.07em',
            color: 'var(--accent-series)',
            lineHeight: 1,
            zIndex: 1,
          }}>
            S
          </div>
        )}

        {/* Persistent favorite heart — top left (when not hovered) */}
        {isFavorite && !hovered && (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            padding: '2px 5px',
            borderRadius: 10,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center',
            zIndex: 1,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#f43f5e" stroke="none">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </div>
        )}

        {/* Source name badge — top left, only when multiple sources */}
        {showSourceBadge && (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            padding: '2px 5px', borderRadius: 3,
            background: 'rgba(0,0,0,0.72)',
            color: sourceColor ? sourceColor.accent : 'var(--text-1)',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
            textTransform: 'uppercase',
            zIndex: 1,
            maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {sourceName}
          </div>
        )}

        {/* Completed checkmark — top right */}
        {isCompleted && (
          <div style={{
            position: 'absolute', top: 6, right: 6,
            width: 16, height: 16, borderRadius: '50%',
            background: 'var(--accent-success)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1,
          }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"
              strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}

        {/* Progress bar — bottom edge of poster */}
        {progressPct > 0 && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
            background: 'rgba(255,255,255,0.08)',
            zIndex: 1,
          }}>
            <div style={{
              width: `${progressPct}%`, height: '100%',
              background: 'var(--accent-interactive)',
              borderRadius: '0 1.5px 1.5px 0',
            }} />
          </div>
        )}

        {/* Hover overlay with actions */}
        {hovered && (
          <CardActions
            item={item}
            onPlay={() => onClick(item)}
            showWatchlist={item.type !== 'live'}
          />
        )}
      </div>

      {/* Metadata strip */}
      <div style={{ padding: '7px 8px 8px' }}>
        <p style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-0)',
          lineHeight: 1.35,
          margin: 0,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {item.title}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
          {item.year && (
            <span style={{ fontSize: 10, color: 'var(--text-2)' }}>{item.year}</span>
          )}
          {rating != null && rating > 0 && (
            <span style={{
              fontSize: 10, color: 'var(--text-2)',
              display: 'flex', alignItems: 'center', gap: 2,
            }}>
              <svg width="7" height="7" viewBox="0 0 24 24" fill="var(--accent-warning)">
                <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              {Number(rating).toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
