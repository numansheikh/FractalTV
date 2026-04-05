import { useState } from 'react'
import { ContentItem } from '@/lib/types'
import { useUserStore } from '@/stores/user.store'
import { PosterPlaceholder } from './PosterPlaceholder'

interface Props {
  item: ContentItem
  onClick: (item: ContentItem) => void
}

function formatRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m remaining`
  return `${m}m remaining`
}

export function ContinueCard({ item, onClick }: Props) {
  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)

  const userData = useUserStore((s) => s.data[item.id])

  const backdrop = item.backdropUrl ?? item.backdrop_url
  const poster = item.posterUrl ?? item.poster_url
  // Prefer backdrop, fall back to poster, fall back to placeholder
  const bgImage = (!imgError && (backdrop || poster)) || null

  const lastPosition = userData?.last_position ?? 0
  const totalSeconds = (item.runtime ?? 0) * 60
  const progressPct = totalSeconds > 0 ? Math.min(100, (lastPosition / totalSeconds) * 100) : 0
  const remainingSeconds = Math.max(0, totalSeconds - lastPosition)

  return (
    <div
      onClick={() => onClick(item)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 280,
        flexShrink: 0,
        aspectRatio: '16/9',
        borderRadius: 6,
        overflow: 'hidden',
        cursor: 'pointer',
        position: 'relative',
        border: `1px solid ${hovered ? 'var(--border-default)' : 'var(--border-subtle)'}`,
        transition: 'border-color 0.12s',
        userSelect: 'none',
      }}
    >
      {/* Background image or placeholder */}
      {bgImage ? (
        <img
          src={bgImage}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setImgError(true)}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0 }}>
          <PosterPlaceholder id={item.id} title={item.title} />
        </div>
      )}

      {/* Bottom gradient overlay — bottom 50% */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        height: '60%',
        background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 55%, transparent 100%)',
        pointerEvents: 'none',
      }} />

      {/* Title + remaining — inside gradient, bottom left */}
      <div style={{
        position: 'absolute',
        bottom: progressPct > 0 ? 6 : 8,
        left: 8,
        right: 46, // leave room for play button
      }}>
        <p style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-0)',
          lineHeight: 1.3,
          margin: 0,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}>
          {item.title}
        </p>
        {totalSeconds > 0 && (
          <p style={{
            fontSize: 10,
            color: 'var(--text-1)',
            margin: '2px 0 0',
            lineHeight: 1,
          }}>
            {formatRemaining(remainingSeconds)}
          </p>
        )}
      </div>

      {/* Play button — bottom right */}
      <button
        onClick={(e) => { e.stopPropagation(); onClick(item) }}
        title="Continue watching"
        style={{
          position: 'absolute',
          bottom: progressPct > 0 ? 8 : 10,
          right: 8,
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--accent-interactive)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          flexShrink: 0,
          boxShadow: '0 2px 10px rgba(139,92,246,0.45)',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="white" style={{ marginLeft: 2 }}>
          <polygon points="5,3 19,12 5,21" />
        </svg>
      </button>

      {/* Progress bar — very bottom edge */}
      {progressPct > 0 && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
          background: 'rgba(255,255,255,0.08)',
        }}>
          <div style={{
            width: `${progressPct}%`,
            height: '100%',
            background: 'var(--accent-interactive)',
            borderRadius: '0 1.5px 1.5px 0',
          }} />
        </div>
      )}
    </div>
  )
}
