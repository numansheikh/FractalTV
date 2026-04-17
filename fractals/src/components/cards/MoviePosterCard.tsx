import { useState } from 'react'
import { ContentItem } from '@/lib/types'
import { useAppStore } from '@/stores/app.store'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { useContextMenuStore } from '@/stores/contextMenu.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { PosterPlaceholder } from './PosterPlaceholder'
import { CardActions } from './CardActions'

interface Props {
  item: ContentItem
  onClick: (item: ContentItem) => void  // opens details panel (used by Details pill)
}

// Overhang: how far the Details button hangs below the blue caption
const OVERHANG = 12

export function MoviePosterCard({ item, onClick }: Props) {
  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)

  const sources = useSourcesStore((s) => s.sources)
  const colorMap = buildColorMapFromSources(sources)
  const userData = useUserStore((s) => s.data[item.id])
  const showCtxMenu = useContextMenuStore((s) => s.show)
  const setPlayingContent = useAppStore((s) => s.setPlayingContent)
  const setPlayerMode = useAppStore((s) => s.setPlayerMode)

  const handlePlay = () => {
    setPlayingContent(item)
    setPlayerMode('fullscreen')
  }

  const poster = item.posterUrl ?? item.poster_url
  const hasPoster = poster && !imgError
  const rating = item.ratingTmdb ?? item.rating_tmdb ?? item.ratingImdb ?? item.rating_imdb
  const primarySourceId = item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const sourceName = primarySourceId ? sources.find((s) => s.id === primarySourceId)?.name : undefined
  const showSourceBadge = sources.length > 1 && !!sourceColor

  const isFavorite = userData?.favorite === 1
  const isCompleted = userData?.completed === 1
  const progressPct =
    userData?.last_position && item.runtime && !isCompleted
      ? Math.min(100, (userData.last_position / (item.runtime * 60)) * 100)
      : 0

  const captionBg = `color-mix(in oklab, var(--accent-film) var(--caption-tint-pct), var(--bg-2))`

  return (
    <div
      onClick={handlePlay}
      onContextMenu={(e) => { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, item) }}
      title={showSourceBadge && sourceName ? `Source: ${sourceName}` : undefined}
      style={{
        position: 'relative',
        paddingBottom: OVERHANG,  // transparent overhang zone for Details button
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {/* Visual card — poster + blue caption. Hover state lives here so the floating Details button doesn't count as card-hover. */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: 'var(--bg-2)',
          borderRadius: 6,
          borderTop: `1px solid ${hovered ? 'var(--border-default)' : 'var(--border-subtle)'}`,
          borderRight: `1px solid ${hovered ? 'var(--border-default)' : 'var(--border-subtle)'}`,
          borderBottom: `1px solid ${hovered ? 'var(--border-default)' : 'var(--border-subtle)'}`,
          borderLeft: showSourceBadge && sourceColor
            ? `3px solid ${sourceColor.accent}`
            : `1px solid ${hovered ? 'var(--border-default)' : 'var(--border-subtle)'}`,
          overflow: 'hidden',
          transition: 'border-color 0.12s',
        }}
      >
        {/* Poster area — 2:3 aspect ratio */}
        <div style={{ aspectRatio: '2/3', position: 'relative', overflow: 'hidden' }}>
          {hasPoster ? (
            <img
              src={poster}
              alt=""
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={() => setImgError(true)}
            />
          ) : (
            <PosterPlaceholder id={item.id} title={item.title} style={{ position: 'absolute', inset: 0 }} />
          )}

          {/* Top-left: type pill + NSFW badge stack */}
          <div style={{
            position: 'absolute', top: 3, left: 3,
            display: 'flex', flexDirection: 'column', gap: 3, zIndex: 1,
          }}>
            <div style={{
              minWidth: 16, height: 16, padding: '0 4px',
              borderRadius: 4,
              background: 'var(--accent-film)',
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.02em',
              fontFamily: 'var(--font-ui)',
            }}>
              M
            </div>
            {(item as any).is_nsfw === 1 && (
              <div style={{
                padding: '1px 4px', borderRadius: 4,
                background: 'rgba(180,0,0,0.85)',
                color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                fontFamily: 'var(--font-ui)',
                border: '1px solid rgba(255,80,80,0.35)',
              }}>
                18+
              </div>
            )}
          </div>

          {/* Top-right cluster: completed checkmark + favorite heart (when not hovered) */}
          {(isCompleted || (isFavorite && !hovered)) && (
            <div style={{
              position: 'absolute', top: 3, right: 3,
              display: 'flex', alignItems: 'center', gap: 4,
              zIndex: 1,
            }}>
              {isCompleted && (
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  background: 'var(--accent-success)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
              {isFavorite && !hovered && (
                <div style={{
                  padding: '2px 5px',
                  borderRadius: 10,
                  background: 'rgba(0,0,0,0.55)',
                  display: 'flex', alignItems: 'center',
                }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="#f43f5e" stroke="none">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </div>
              )}
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
              onPlay={handlePlay}
              showWatchlist={true}
            />
          )}
        </div>

        {/* Blue caption — title + meta(year/rating) with Play icon right-aligned. Tight, no wasted space */}
        <div style={{
          padding: '6px 8px 6px',
          background: captionBg,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        }}>
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
            minHeight: 'calc(1.35em * 2)',
          }}>
            {item.title}
          </p>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 4,
            minHeight: 22,
          }}>
            {/* Play icon — bigger, borderless, left-aligned */}
            <button
              onClick={(e) => { e.stopPropagation(); handlePlay() }}
              title="Play"
              style={{
                width: 22,
                height: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent',
                color: 'var(--text-0)',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0,
                marginLeft: -3,  // align triangle's visual left edge with title's left edge
              }}
            >
              {/* Triangle offset 1.5px right for optical centering */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 1.5, display: 'block' }}>
                <polygon points="5,3 19,12 5,21" />
              </svg>
            </button>
            <div style={{ flex: 1 }} />
            {item.year && (
              <span style={{ fontSize: 10, color: 'var(--text-2)' }}>{item.year}</span>
            )}
            {rating != null && rating > 0 && (
              <span style={{ fontSize: 10, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 2 }}>
                <svg width="7" height="7" viewBox="0 0 24 24" fill="var(--accent-warning)">
                  <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {Number(rating).toFixed(1)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Details button — absolute, hangs off the bottom-right of the visual card */}
      <button
        onClick={(e) => { e.stopPropagation(); onClick(item) }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-film) 55%, white)'
          e.currentTarget.style.transform = 'translateY(-1px)'
          e.currentTarget.style.boxShadow = '0 6px 14px rgba(0,0,0,0.45), 0 2px 5px rgba(0,0,0,0.3)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--accent-film)'
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.25)'
        }}
        title="Details"
        style={{
          position: 'absolute',
          right: 8,
          bottom: 0,  // inside the OVERHANG zone; button is centered vertically on the visual card's bottom edge
          height: 20,
          padding: '0 7px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--accent-film)',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          fontSize: 11, fontWeight: 600,
          fontFamily: 'var(--font-ui)',
          cursor: 'pointer',
          transition: 'background 0.12s, transform 0.12s, box-shadow 0.12s',
          boxShadow: '0 3px 8px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.25)',
        }}
      >
        Details
      </button>
    </div>
  )
}
