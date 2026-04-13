import { useState } from 'react'
import { ContentItem } from '@/lib/types'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { useContextMenuStore } from '@/stores/contextMenu.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { CardActions } from './CardActions'

interface Props {
  item: ContentItem
  onClick: (item: ContentItem) => void
}

// Country code → flag emoji (basic ISO 3166-1 alpha-2)
function countryFlag(code: string | undefined): string | null {
  if (!code || code.length !== 2) return null
  const base = 0x1F1E6 - 65
  return String.fromCodePoint(base + code.toUpperCase().charCodeAt(0), base + code.toUpperCase().charCodeAt(1))
}

export function ChannelCard({ item, onClick }: Props) {
  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)

  const sources = useSourcesStore((s) => s.sources)
  const colorMap = buildColorMapFromSources(sources)
  const userData = useUserStore((s) => s.data[item.id])
  const showCtxMenu = useContextMenuStore((s) => s.show)

  const poster = item.posterUrl ?? item.poster_url
  const hasPoster = poster && !imgError
  const primarySourceId = item.primarySourceId ?? item.primary_source_id ?? item.id?.split(':')[0]
  const allSourceIds = ((item as any).source_ids as string | undefined)?.split(',').filter(Boolean) ?? (primarySourceId ? [primarySourceId] : [])
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const sourceName = primarySourceId ? sources.find((s) => s.id === primarySourceId)?.name : undefined
  const showSourceBar = sources.length > 1 && allSourceIds.length > 0
  const isFavorite = userData?.favorite === 1

  // g3 canonical badges
  const flag = countryFlag(item.country)
  const variantCount = item.variant_count ?? 0
  const sourceCount = item.source_count ?? 0
  const isDefunct = !!item.closed
  const hasMultiSource = sourceCount > 1
  const hasMultiVariant = variantCount > 1

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
      onContextMenu={(e) => { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, item) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={showSourceBar && sourceName ? `${item.title} — Source: ${sourceName}` : item.title}
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
          ? '3px solid transparent'
          : `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
        transition: 'border-color 0.12s',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      {/* Source stripe — stacked colored segments, one per source */}
      {showSourceBar && (
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
          display: 'flex', flexDirection: 'column',
          gap: allSourceIds.length > 1 ? 1 : 0,
          zIndex: 3,
        }}>
          {allSourceIds.map((sid) => (
            <div key={sid} style={{
              flex: 1,
              background: colorMap[sid]?.accent ?? 'var(--border-subtle)',
            }} />
          ))}
        </div>
      )}

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

      {/* Channel name + badges */}
      <div style={{ padding: '5px 7px 6px' }}>
        <p style={{
          fontSize: 11,
          fontWeight: 500,
          lineHeight: 1.3,
          color: isDefunct ? 'var(--text-3)' : 'var(--text-1)',
          margin: 0,
          marginBottom: 3,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {item.title}
          {isDefunct && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--text-3)', fontWeight: 400 }}>DEFUNCT</span>}
        </p>

        {/* Badges row */}
        {(flag || hasMultiVariant) && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {flag && (
              <span style={{ fontSize: 11, lineHeight: 1 }} title={item.country ?? ''}>
                {flag}
              </span>
            )}
            {hasMultiVariant && (
              <span style={{
                fontSize: 9, fontWeight: 600, color: 'var(--text-2)',
                background: 'var(--bg-3)', borderRadius: 3,
                padding: '1px 4px', lineHeight: 1.4,
              }} title={`${variantCount} variants`}>
                ×{variantCount}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
