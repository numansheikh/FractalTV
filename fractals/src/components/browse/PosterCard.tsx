import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { buildColorMap } from '@/lib/sourceColors'
import { ContentItem } from './ContentCard'
import { api } from '@/lib/api'

// Deterministic gradient palettes for missing posters
const GRADIENTS = [
  'linear-gradient(145deg, #1a0a2e 0%, #6b21a8 55%, #e040fb 100%)',
  'linear-gradient(145deg, #0f1729 0%, #1e3a5f 55%, #2196f3 100%)',
  'linear-gradient(145deg, #1a0a0a 0%, #7f1d1d 55%, #ef4444 100%)',
  'linear-gradient(145deg, #0a1a0f 0%, #14532d 55%, #22c55e 100%)',
  'linear-gradient(145deg, #1a1200 0%, #78350f 55%, #f59e0b 100%)',
  'linear-gradient(145deg, #0a1820 0%, #164e63 55%, #06b6d4 100%)',
  'linear-gradient(145deg, #180a1a 0%, #701a75 55%, #d946ef 100%)',
  'linear-gradient(145deg, #1a0f0a 0%, #7c2d12 55%, #f97316 100%)',
  'linear-gradient(145deg, #0f1a1a 0%, #134e4a 55%, #14b8a6 100%)',
  'linear-gradient(145deg, #12121a 0%, #312e81 55%, #818cf8 100%)',
  'linear-gradient(145deg, #1a0a14 0%, #9d174d 55%, #ec4899 100%)',
  'linear-gradient(145deg, #0a150f 0%, #166534 55%, #4ade80 100%)',
]

function gradientFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return GRADIENTS[hash % GRADIENTS.length]
}

interface Props {
  item: ContentItem
  onClick: (item: ContentItem) => void
}

export function PosterCard({ item, onClick }: Props) {
  const { sources } = useSourcesStore()
  const colorMap = buildColorMap(sources.map((s) => s.id))
  const userData = useUserStore((s) => s.data[item.id])
  const setFav = useUserStore((s) => s.setFavorite)
  const setWl = useUserStore((s) => s.setWatchlist)
  const [hovered, setHovered] = useState(false)
  const qc = useQueryClient()

  const poster = item.posterUrl ?? item.poster_url
  const rating = item.ratingTmdb ?? item.rating_tmdb ?? item.ratingImdb ?? item.rating_imdb
  const primarySourceId = item.primarySourceId ?? item.primary_source_id
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const isFavorite = userData?.favorite === 1
  const isWatchlist = userData?.watchlist === 1
  const isCompleted = userData?.completed === 1
  const progressPct = userData?.last_position && item.runtime && !isCompleted
    ? Math.min(100, (userData.last_position / (item.runtime * 60)) * 100)
    : 0

  const toggleFav = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const removing = isFavorite
    setFav(item.id, !isFavorite)
    if (removing) {
      const strip = (old: ContentItem[] | undefined) => old?.filter((i) => i.id !== item.id)
      qc.setQueriesData<ContentItem[]>({ queryKey: ['browse-favorites'] }, strip)
      qc.setQueriesData<ContentItem[]>({ queryKey: ['library', 'favorites'] }, strip)
    }
    await api.user.toggleFavorite(item.id)
    qc.invalidateQueries({ queryKey: ['browse-favorites'] })
    qc.invalidateQueries({ queryKey: ['library', 'favorites'] })
  }
  const toggleWatchlist = (e: React.MouseEvent) => {
    e.stopPropagation()
    setWl(item.id, !isWatchlist)
    api.user.toggleWatchlist(item.id)
  }

  return (
    <div
      onClick={() => onClick(item)}
      onMouseEnter={(e) => { setHovered(true); e.currentTarget.style.transform = 'translateY(-3px) scale(1.02)'; e.currentTarget.style.boxShadow = '0 10px 28px rgba(0,0,0,0.5)' }}
      onMouseLeave={(e) => { setHovered(false); e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)' }}
      style={{
        borderRadius: '10px',
        overflow: 'hidden',
        cursor: 'pointer',
        background: 'var(--color-card)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        position: 'relative',
        transition: 'transform 0.15s, box-shadow 0.15s',
      }}
    >
      {/* Poster art — 2:3 ratio */}
      <div style={{ aspectRatio: '2/3', position: 'relative', overflow: 'hidden' }}>
        {poster ? (
          <img
            src={poster}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={(e) => {
              e.currentTarget.style.display = 'none'
              const parent = e.currentTarget.parentElement
              if (parent) parent.style.background = gradientFor(item.id)
            }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', background: gradientFor(item.id) }} />
        )}

        {/* Bottom gradient overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.15) 45%, transparent 100%)',
        }} />

        {/* Type badge — top left */}
        {item.type === 'series' && (
          <div style={{
            position: 'absolute', top: 7, left: 7,
            padding: '2px 5px', borderRadius: 4,
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
            color: 'rgba(255,255,255,0.75)', lineHeight: 1,
            border: '1px solid rgba(255,255,255,0.12)',
          }}>
            SERIES
          </div>
        )}

        {/* Quick action buttons — on hover */}
        {hovered && (
          <div style={{
            position: 'absolute', top: 6, left: 6, display: 'flex', gap: 4, zIndex: 2,
          }}>
            <button onClick={toggleFav} title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              style={{
                width: 26, height: 26, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isFavorite ? 'rgba(239,68,68,0.25)' : 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                border: `1px solid ${isFavorite ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.15)'}`,
                cursor: 'pointer', padding: 0,
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill={isFavorite ? '#ef4444' : 'none'} stroke={isFavorite ? '#ef4444' : 'rgba(255,255,255,0.8)'} strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
            <button onClick={toggleWatchlist} title={isWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
              style={{
                width: 26, height: 26, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isWatchlist ? 'rgba(124,77,255,0.25)' : 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                border: `1px solid ${isWatchlist ? 'rgba(124,77,255,0.4)' : 'rgba(255,255,255,0.15)'}`,
                cursor: 'pointer', padding: 0,
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill={isWatchlist ? '#7c4dff' : 'none'} stroke={isWatchlist ? '#7c4dff' : 'rgba(255,255,255,0.8)'} strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          </div>
        )}

        {/* Favorite heart — persistent indicator (when not hovered) */}
        {isFavorite && !hovered && (
          <div style={{
            position: 'absolute', top: 6, right: sourceColor ? 22 : 6,
            width: 20, height: 20, borderRadius: 5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#ef4444" stroke="none">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </div>
        )}

        {/* Completed checkmark — top right */}
        {isCompleted && (
          <div style={{
            position: 'absolute', top: 6, right: 6,
            width: 18, height: 18, borderRadius: '50%',
            background: 'rgba(76,175,80,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}

        {/* Source color dot — top right */}
        {sourceColor && !isCompleted && (
          <div style={{
            position: 'absolute', top: 8, right: 8,
            width: 8, height: 8, borderRadius: '50%',
            background: sourceColor.accent,
            border: '1.5px solid rgba(0,0,0,0.5)',
            boxShadow: `0 0 6px ${sourceColor.glow}`,
          }} />
        )}

        {/* Title + meta overlay at bottom */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '8px 10px' }}>
          <p style={{
            fontSize: '11.5px', fontWeight: 600, color: '#fff',
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {item.title}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
            {item.year && (
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>{item.year}</span>
            )}
            {rating && rating > 0 && (
              <span style={{ fontSize: '10px', color: '#e5c07b', display: 'flex', alignItems: 'center', gap: 2 }}>
                <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor">
                  <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {Number(rating).toFixed(1)}
              </span>
            )}
          </div>
        </div>
        {/* Progress bar — bottom edge */}
        {progressPct > 0 && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
            background: 'rgba(255,255,255,0.1)',
          }}>
            <div style={{
              width: `${progressPct}%`, height: '100%',
              background: '#7c4dff',
              borderRadius: '0 1.5px 1.5px 0',
            }} />
          </div>
        )}
      </div>
    </div>
  )
}
