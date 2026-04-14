import { useState } from 'react'
import { ContentItem } from '@/lib/types'
import { useAppStore } from '@/stores/app.store'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { useContextMenuStore } from '@/stores/contextMenu.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { CardActions } from './CardActions'

interface Props {
  item: ContentItem
  onClick: (item: ContentItem) => void
}

const OVERHANG = 12

export function ChannelCard({ item, onClick }: Props) {
  const [hovered, setHovered] = useState(false)
  const [detailsHovered, setDetailsHovered] = useState(false)
  const [imgError, setImgError] = useState(false)

  const sources = useSourcesStore((s) => s.sources)
  const colorMap = buildColorMapFromSources(sources)
  const userData = useUserStore((s) => s.data[item.id])
  const showCtxMenu = useContextMenuStore((s) => s.show)
  const setSelectedContent = useAppStore((s) => s.setSelectedContent)

  const poster = item.posterUrl ?? item.poster_url
  const hasPoster = poster && !imgError
  const primarySourceId = item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const sourceName = primarySourceId ? sources.find((s) => s.id === primarySourceId)?.name : undefined
  const showSourceBar = sources.length > 1 && !!sourceColor
  const isFavorite = userData?.favorite === 1

  const initials = item.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

  return (
    <div
      onContextMenu={(e) => { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, item) }}
      title={showSourceBar && sourceName ? `${item.title} — Source: ${sourceName}` : item.title}
      style={{
        position: 'relative',
        paddingBottom: OVERHANG,
        userSelect: 'none',
      }}
    >
      {/* Visual card — hover state scoped here so the floating Details button doesn't count as card-hover */}
      <div
        onClick={() => onClick(item)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          minWidth: 0,
          cursor: 'pointer',
          borderRadius: 6,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          borderTop: `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
          borderRight: `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
          borderBottom: `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
          borderLeft: showSourceBar
            ? `3px solid ${sourceColor!.accent}`
            : `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
          transition: 'border-color 0.12s',
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
              loading="lazy"
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

          {hovered && (
            <CardActions
              item={item}
              onPlay={() => onClick(item)}
              showWatchlist={false}
            />
          )}
        </div>

        {/* Channel name — extra bottom padding reserves space for the hanging Details button */}
        <div style={{ padding: '5px 7px 14px' }}>
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
            minHeight: 'calc(1.3em * 2)',  // reserve 2 lines so all cards are the same height
          }}>
            {item.title}
          </p>
        </div>
      </div>

      {/* Details button — always visible, hangs off the bottom-right of the visual card.
          Lights up when the card itself is hovered, signaling linkage. */}
      {(() => {
        const lit = detailsHovered || hovered
        return (
          <button
            onClick={(e) => { e.stopPropagation(); setSelectedContent(item) }}
            onMouseEnter={() => setDetailsHovered(true)}
            onMouseLeave={() => setDetailsHovered(false)}
            title="Details"
            style={{
              position: 'absolute',
              right: 8,
              bottom: 0,
              height: 20,
              padding: '0 7px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: lit
                ? 'color-mix(in srgb, var(--accent-live) 55%, white)'
                : 'var(--accent-live)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontSize: 11, fontWeight: 600,
              fontFamily: 'var(--font-ui)',
              cursor: 'pointer',
              transition: 'background 0.12s, transform 0.12s, box-shadow 0.12s',
              transform: lit ? 'translateY(-1px)' : 'translateY(0)',
              boxShadow: lit
                ? '0 6px 14px rgba(0,0,0,0.45), 0 2px 5px rgba(0,0,0,0.3)'
                : '0 3px 8px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.25)',
            }}
          >
            Details
          </button>
        )
      })()}
    </div>
  )
}
