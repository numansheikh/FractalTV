import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContentItem } from '@/lib/types'
import { api } from '@/lib/api'
import { useUserStore } from '@/stores/user.store'

interface Props {
  item: ContentItem
  onPlay: (item: ContentItem) => void
  episodeToPlay?: any
}

function formatPosition(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function ActionButtons({ item, onPlay, episodeToPlay }: Props) {
  const userStore = useUserStore()
  const userData = userStore.data[item.id]

  const [extError, setExtError] = useState<string | null>(null)
  const [hoverStar, setHoverStar] = useState<number | null>(null)

  // Load user data on mount and seed the store
  useQuery({
    queryKey: ['userdata', item.id],
    queryFn: async () => {
      const d = await api.user.getData(item.id)
      if (d) {
        // Use getState() to avoid stale closure over userStore reference
        const store = useUserStore.getState()
        store.setFavorite(item.id, !!(d as any).favorite)
        store.setWatchlist(item.id, !!(d as any).watchlist)
        if ((d as any).rating != null) store.setRating(item.id, (d as any).rating)
        if ((d as any).last_position) store.setPosition(item.id, (d as any).last_position)
      }
      return d
    },
    staleTime: 30_000,
  })

  const isFavorite = userData?.favorite === 1
  const isWatchlist = userData?.watchlist === 1
  const userRating = userData?.rating ?? null
  const lastPosition = userData?.last_position ?? 0

  const playLabel = lastPosition > 0
    ? `▶ Resume from ${formatPosition(lastPosition)}`
    : '▶ Play'

  const handleFavorite = async () => {
    userStore.setFavorite(item.id, !isFavorite)
    try {
      await api.user.toggleFavorite(item.id)
    } catch {
      userStore.setFavorite(item.id, isFavorite)
    }
  }

  const handleWatchlist = async () => {
    userStore.setWatchlist(item.id, !isWatchlist)
    try {
      await api.user.toggleWatchlist(item.id)
    } catch {
      userStore.setWatchlist(item.id, isWatchlist)
    }
  }

  const handleRating = async (star: number) => {
    const newRating = userRating === star ? null : star
    userStore.setRating(item.id, newRating)
    try {
      await api.user.setRating(item.id, newRating)
    } catch {
      userStore.setRating(item.id, userRating)
    }
  }

  const handleExternalPlayer = async () => {
    setExtError(null)
    try {
      const detected = await api.player.detectExternal() as any
      const player: 'mpv' | 'vlc' = detected?.mpv ? 'mpv' : detected?.vlc ? 'vlc' : null as any
      if (!player) {
        setExtError('No external player found. Install MPV or VLC.')
        return
      }
      const urlResult = await api.content.getStreamUrl({ contentId: item.id }) as any
      const url = urlResult?.url ?? urlResult?.streamUrl ?? urlResult
      if (!url || typeof url !== 'string') {
        setExtError('Could not get stream URL.')
        return
      }
      await api.player.openExternal({ player, url, title: item.title })
    } catch (err) {
      setExtError(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const iconBtnStyle: React.CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 6,
    background: 'var(--bg-3)',
    border: '1px solid var(--border-subtle)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.12s, border-color 0.12s',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Play button */}
      <button
        onClick={() => onPlay(episodeToPlay ?? item)}
        style={{
          width: '100%',
          height: 36,
          borderRadius: 6,
          background: 'var(--accent-interactive)',
          color: '#fff',
          border: 'none',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'var(--font-ui)',
          transition: 'opacity 0.12s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88' }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
      >
        {playLabel}
      </button>

      {/* Icon buttons row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Heart — favorite */}
        <button
          onClick={handleFavorite}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          style={{
            ...iconBtnStyle,
            borderColor: isFavorite ? 'rgba(236,25,111,0.35)' : 'var(--border-subtle)',
            background: isFavorite ? 'rgba(236,25,111,0.1)' : 'var(--bg-3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(236,25,111,0.12)'
            e.currentTarget.style.borderColor = 'rgba(236,25,111,0.35)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = isFavorite ? 'rgba(236,25,111,0.1)' : 'var(--bg-3)'
            e.currentTarget.style.borderColor = isFavorite ? 'rgba(236,25,111,0.35)' : 'var(--border-subtle)'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24"
            fill={isFavorite ? '#ec196f' : 'none'}
            stroke={isFavorite ? '#ec196f' : 'var(--text-2)'}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        {/* Bookmark — watchlist */}
        <button
          onClick={handleWatchlist}
          title={isWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
          style={{
            ...iconBtnStyle,
            borderColor: isWatchlist ? 'rgba(139,92,246,0.35)' : 'var(--border-subtle)',
            background: isWatchlist ? 'var(--accent-interactive-dim)' : 'var(--bg-3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-interactive-dim)'
            e.currentTarget.style.borderColor = 'rgba(139,92,246,0.35)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = isWatchlist ? 'var(--accent-interactive-dim)' : 'var(--bg-3)'
            e.currentTarget.style.borderColor = isWatchlist ? 'rgba(139,92,246,0.35)' : 'var(--border-subtle)'
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24"
            fill={isWatchlist ? 'var(--accent-interactive)' : 'none'}
            stroke={isWatchlist ? 'var(--accent-interactive)' : 'var(--text-2)'}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        {/* Star rating — 5 stars inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
          {[1, 2, 3, 4, 5].map((star) => {
            const filled = (hoverStar ?? userRating ?? 0) >= star
            return (
              <button
                key={star}
                onClick={() => handleRating(star)}
                onMouseEnter={() => setHoverStar(star)}
                onMouseLeave={() => setHoverStar(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '2px 1px',
                  cursor: 'pointer',
                  transition: 'transform 0.1s',
                  transform: hoverStar === star ? 'scale(1.2)' : 'scale(1)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24"
                  fill={filled ? 'var(--accent-warning)' : 'none'}
                  stroke={filled ? 'var(--accent-warning)' : 'var(--text-3)'}
                  strokeWidth="1.5"
                >
                  <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </button>
            )
          })}
        </div>

        {/* External player button */}
        <button
          onClick={handleExternalPlayer}
          title="Open in external player"
          style={iconBtnStyle}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
        >
          {/* MPV-style play arrow with external bracket icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <path d="M10 14L21 3" />
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          </svg>
        </button>
      </div>

      {/* External player error */}
      {extError && (
        <p style={{
          fontSize: 11,
          color: 'var(--accent-danger)',
          margin: 0,
          fontFamily: 'var(--font-ui)',
        }}>
          {extError}
        </p>
      )}
    </div>
  )
}
