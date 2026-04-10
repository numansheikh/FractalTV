import { useState } from 'react'

interface Episode {
  id: string
  num: number
  title: string
  plot?: string
  duration?: string
  poster?: string
}

interface Props {
  episode: Episode
  seriesId: string
  onPlay: () => void
  isPlaying?: boolean
  isCompleted?: boolean
  progress?: number
}

export function EpisodeRow({ episode, onPlay, isPlaying = false, isCompleted = false, progress = 0 }: Props) {
  const [hovered, setHovered] = useState(false)

  const episodeLabel = `E${String(episode.num).padStart(2, '0')}`

  return (
    <div
      onClick={onPlay}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 52,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 10px',
        borderRadius: 4,
        background: hovered ? 'var(--bg-3)' : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.1s',
        opacity: isCompleted ? 0.5 : 1,
        userSelect: 'none',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      {/* Episode badge / completed checkmark */}
      <div style={{
        flexShrink: 0,
        width: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {isCompleted ? (
          <div style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--accent-success)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        ) : (
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-2)',
            fontFamily: 'var(--font-mono, monospace)',
            letterSpacing: '0.04em',
          }}>
            {episodeLabel}
          </span>
        )}
      </div>

      {/* Title + progress */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <p style={{
          fontSize: 13,
          fontWeight: 400,
          color: isPlaying ? 'var(--accent-interactive)' : isCompleted ? 'var(--text-2)' : 'var(--text-0)',
          margin: 0,
          lineHeight: 1.3,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          transition: 'color 0.1s',
        }}>
          {episode.title}
        </p>
        {progress > 0 && !isCompleted && (
          <div style={{
            height: 3,
            background: 'var(--border-subtle)',
            borderRadius: 1.5,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.min(100, progress)}%`,
              height: '100%',
              background: 'var(--accent-interactive)',
              borderRadius: '0 1.5px 1.5px 0',
            }} />
          </div>
        )}
      </div>

      {/* Duration */}
      {episode.duration && (
        <span style={{
          flexShrink: 0,
          fontSize: 11,
          color: 'var(--text-2)',
          marginRight: hovered || isPlaying ? 4 : 0,
          transition: 'margin 0.1s',
        }}>
          {episode.duration}
        </span>
      )}

      {/* Playing indicator */}
      {isPlaying && (
        <div style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}>
          {[0, 80, 160].map((delay) => (
            <div
              key={delay}
              style={{
                width: 3,
                height: 12,
                borderRadius: 1.5,
                background: 'var(--accent-interactive)',
                animation: `episodeBarPulse 0.9s ease-in-out ${delay}ms infinite alternate`,
              }}
            />
          ))}
        </div>
      )}

      {/* Play icon — appears on hover (not playing) */}
      {hovered && !isPlaying && (
        <div style={{ flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24"
            fill="var(--accent-interactive)">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        </div>
      )}

    </div>
  )
}
