import { useState } from 'react'
import { ContentItem } from '@/lib/types'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { buildColorMap } from '@/lib/sourceColors'
import { CardActions } from './CardActions'

interface Props {
  item: ContentItem
  onClick: (item: ContentItem) => void
}

export function ChannelCard({ item, onClick }: Props) {
  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)

  const sources = useSourcesStore((s) => s.sources)
  const colorMap = buildColorMap(sources.map((s) => s.id))
  const userData = useUserStore((s) => s.data[item.id])

  const poster = item.posterUrl ?? item.poster_url
  const hasPoster = poster && !imgError
  const primarySourceId = item.primarySourceId ?? item.primary_source_id
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const showSourceBar = sources.length > 1 && !!sourceColor
  const isFavorite = userData?.favorite === 1

  // Channel initials for fallback
  const initials = item.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

  return (
    <div
      onClick={() => onClick(item)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={item.title}
      style={{
        minWidth: 0,
        cursor: 'pointer',
        borderRadius: 6,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
        borderLeft: showSourceBar ? `3px solid ${sourceColor!.accent}` : undefined,
        transition: 'border-color 0.12s',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      {/* Logo area — 16:9 */}
      <div style={{
        aspectRatio: '16/9',
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--bg-3)',
      }}>
        {hasPoster ? (
          <img
            src={poster}
            alt=""
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'contain',
              padding: '10%',
            }}
            onError={() => setImgError(true)}
          />
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-3)',
          }}>
            <span style={{
              fontSize: 18,
              fontWeight: 700,
              color: sourceColor ? sourceColor.accent : 'var(--text-2)',
              opacity: 0.6,
              letterSpacing: '-0.02em',
              fontFamily: 'var(--font-ui, system-ui, sans-serif)',
            }}>
              {initials}
            </span>
          </div>
        )}

        {/* Persistent favorite heart — top right of logo */}
        {isFavorite && !hovered && (
          <div style={{
            position: 'absolute', top: 5, right: 5,
            padding: '2px 5px',
            borderRadius: 10,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center',
            zIndex: 2,
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="#f43f5e" stroke="none">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </div>
        )}

        {/* Hover overlay — no watchlist for live */}
        {hovered && (
          <CardActions
            item={item}
            onPlay={() => onClick(item)}
            showWatchlist={false}
          />
        )}
      </div>

      {/* Channel name */}
      <div style={{ padding: '5px 7px 6px' }}>
        <p style={{
          fontSize: 11,
          fontWeight: 500,
          lineHeight: 1.3,
          color: 'var(--text-1)',
          margin: 0,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {item.title}
        </p>
      </div>
    </div>
  )
}
