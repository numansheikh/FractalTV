import React, { useState } from 'react'
import { ContentItem } from '@/lib/types'
import { useUserStore } from '@/stores/user.store'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Props {
  item: ContentItem
  onPlay: () => void
  showWatchlist?: boolean
}

export function CardActions({ item, onPlay, showWatchlist = true }: Props) {
  const userData = useUserStore((s) => s.data[item.id])
  const setFav = useUserStore((s) => s.setFavorite)
  const setWl = useUserStore((s) => s.setWatchlist)
  const qc = useQueryClient()
  const [confirmUnfav, setConfirmUnfav] = useState(false)

  const isFavorite = userData?.favorite === 1
  const isWatchlist = userData?.watchlist === 1

  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isFavorite && !confirmUnfav) {
      setConfirmUnfav(true)
      return
    }
    setConfirmUnfav(false)
    setFav(item.id, !isFavorite)
    api.user.toggleFavorite(item.id).then(() => {
      qc.invalidateQueries({ queryKey: ['channels', 'favorites'] })
      qc.invalidateQueries({ queryKey: ['browse-favorites'] })
      qc.invalidateQueries({ queryKey: ['library', 'favorites'] })
    })
  }

  const handleWatchlist = (e: React.MouseEvent) => {
    e.stopPropagation()
    setWl(item.id, !isWatchlist)
    api.user.toggleWatchlist(item.id).then(() => {
      qc.invalidateQueries({ queryKey: ['home-watchlist'] })
      qc.invalidateQueries({ queryKey: ['library', 'watchlist'] })
    })
  }

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    onPlay()
  }

  const btnBase: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-3)',
    border: '1px solid var(--border-default)',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'color-mix(in srgb, var(--bg-0) 70%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3,
        opacity: 1,
        transition: 'opacity 0.1s ease',
      }}
      onMouseLeave={() => setConfirmUnfav(false)}
    >
      {/* Heart — top left */}
      <button
        onClick={handleFav}
        title={confirmUnfav ? 'Click again to remove' : isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        style={{
          ...btnBase,
          position: 'absolute',
          top: 6,
          left: 6,
          background: confirmUnfav ? 'rgba(244,63,94,0.15)' : isFavorite ? 'rgba(244,63,94,0.25)' : 'var(--bg-3)',
          border: `1px solid ${confirmUnfav ? 'rgba(244,63,94,0.7)' : isFavorite ? 'rgba(244,63,94,0.45)' : 'var(--border-default)'}`,
          animation: confirmUnfav ? 'pulse 0.4s ease' : 'none',
        }}
      >
        {confirmUnfav ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
        <svg width="13" height="13" viewBox="0 0 24 24"
          fill={isFavorite ? '#f43f5e' : 'none'}
          stroke={isFavorite ? '#f43f5e' : 'var(--text-1)'}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        )}
      </button>

      {/* Bookmark — top right */}
      {showWatchlist && (
        <button
          onClick={handleWatchlist}
          title={isWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
          style={{
            ...btnBase,
            position: 'absolute',
            top: 6,
            right: 6,
            background: isWatchlist ? 'rgba(139,92,246,0.25)' : 'var(--bg-3)',
            border: `1px solid ${isWatchlist ? 'rgba(139,92,246,0.45)' : 'var(--border-default)'}`,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24"
            fill={isWatchlist ? '#8b5cf6' : 'none'}
            stroke={isWatchlist ? '#8b5cf6' : 'var(--text-1)'}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Play — center */}
      <button
        onClick={handlePlay}
        title="Play"
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--accent-interactive)',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
          boxShadow: '0 2px 12px rgba(139,92,246,0.5)',
        }}
      >
        {/* Triangle offset slightly right for optical centering */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="white" style={{ marginLeft: 2 }}>
          <polygon points="5,3 19,12 5,21" />
        </svg>
      </button>
    </div>
  )
}
