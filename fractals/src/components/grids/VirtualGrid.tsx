import { useRef, useState, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useQueryClient } from '@tanstack/react-query'
import { ContentItem } from '@/lib/types'
import { PosterCard } from '@/components/cards/PosterCard'
import { ChannelCard } from '@/components/cards/ChannelCard'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { buildColorMap } from '@/lib/sourceColors'
import { api } from '@/lib/api'

interface Props {
  items: ContentItem[]
  onSelect: (item: ContentItem) => void
  viewMode?: 'grid' | 'list'
}

// ─── Marquee style (injected once) ───────────────────────────────────────────

function ensureMarqueeStyle() {
  if (document.getElementById('ch-marquee-style')) return
  const s = document.createElement('style')
  s.id = 'ch-marquee-style'
  s.textContent = `
    @keyframes ch-marquee {
      0%,12%  { transform: translateX(0) }
      88%,100% { transform: translateX(var(--ch-overflow, 0px)) }
    }
    .ch-marquee { animation: ch-marquee 5s ease-in-out infinite; }
  `
  document.head.appendChild(s)
}

// ─── Channel list row ────────────────────────────────────────────────────────

interface ChannelListRowProps {
  item: ContentItem
  onClick: (item: ContentItem) => void
}

function ChannelListRow({ item, onClick }: ChannelListRowProps) {
  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [marqueeOffset, setMarqueeOffset] = useState(0)
  const nameContainerRef = useRef<HTMLDivElement>(null)
  const nameSpanRef = useRef<HTMLSpanElement>(null)

  const sources = useSourcesStore((s) => s.sources)
  const colorMap = buildColorMap(sources.map((s) => s.id))

  // Favorite state
  const isFav = !!useUserStore((s) => s.data[item.id]?.favorite)
  const qc = useQueryClient()

  const toggleFav = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const removing = isFav
    useUserStore.getState().setFavorite(item.id, !isFav)
    if (removing) {
      const strip = (old: ContentItem[] | undefined) => old?.filter((i) => i.id !== item.id)
      qc.setQueriesData<ContentItem[]>({ queryKey: ['browse-favorites'] }, strip)
      qc.setQueriesData<ContentItem[]>({ queryKey: ['library', 'favorites'] }, strip)
    }
    try {
      await api.user.toggleFavorite(item.id)
    } catch { /* noop */ }
    qc.invalidateQueries({ queryKey: ['browse-favorites'] })
    qc.invalidateQueries({ queryKey: ['library', 'favorites'] })
  }

  const primarySourceId = item.primarySourceId ?? item.primary_source_id
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const sourceName = primarySourceId ? sources.find((s) => s.id === primarySourceId)?.name : undefined
  const showSourceBadge = sources.length > 1 && sourceName
  const logo = item.posterUrl ?? item.poster_url

  // Measure overflow when hovered
  useEffect(() => {
    ensureMarqueeStyle()
  }, [])

  useEffect(() => {
    if (!hovered) { setMarqueeOffset(0); return }
    const container = nameContainerRef.current
    const span = nameSpanRef.current
    if (!container || !span) return
    const overflow = span.scrollWidth - container.clientWidth
    setMarqueeOffset(overflow > 4 ? -overflow : 0)
  }, [hovered])

  const isScrolling = hovered && marqueeOffset < 0

  return (
    <div
      onClick={() => onClick(item)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '100%',
        background: hovered ? 'var(--bg-2)' : 'transparent',
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'background 0.1s',
        paddingRight: 12,
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        minWidth: 0,
      }}
    >
      {/* Source color bar */}
      {showSourceBadge && sourceColor && (
        <div style={{
          position: 'absolute',
          left: 0, top: 4, bottom: 4,
          width: 3,
          borderRadius: 2,
          background: sourceColor.accent,
          flexShrink: 0,
        }} />
      )}

      {/* Logo */}
      <div style={{
        width: 28,
        height: 28,
        borderRadius: 4,
        background: 'var(--bg-3)',
        flexShrink: 0,
        marginLeft: (showSourceBadge && sourceColor) ? 12 : 8,
        marginRight: 8,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {logo && !imgError ? (
          <img
            src={logo}
            alt=""
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.5">
            <rect x="2" y="7" width="20" height="15" rx="2"/>
            <polyline points="17 2 12 7 7 2"/>
          </svg>
        )}
      </div>

      {/* Channel name — clipping container + scrolling inner span */}
      <div
        ref={nameContainerRef}
        style={{
          flex: 1,
          overflow: 'hidden',
          minWidth: 0,
          position: 'relative',
        }}
      >
        <span
          ref={nameSpanRef}
          className={isScrolling ? 'ch-marquee' : undefined}
          style={{
            fontSize: 12,
            color: hovered ? 'var(--text-0)' : 'var(--text-1)',
            fontFamily: 'var(--font-ui)',
            whiteSpace: 'nowrap',
            display: 'inline-block',
            transition: isScrolling ? 'none' : 'color 0.1s',
            // CSS custom property for the animation
            ['--ch-overflow' as any]: `${marqueeOffset}px`,
          }}
        >
          {item.title}
        </span>
      </div>

      {/* Trailing actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 6, flexShrink: 0 }}>
        {/* Heart — always visible when favorited, show on hover otherwise */}
        {(hovered || isFav) && (
          <button
            onClick={toggleFav}
            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
            style={{
              background: 'none', border: 'none', padding: '2px 3px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', color: isFav ? 'var(--accent-live)' : 'var(--text-2)',
              transition: 'color 0.1s',
            }}
            onMouseEnter={(e) => { if (!isFav) e.currentTarget.style.color = 'var(--accent-live)' }}
            onMouseLeave={(e) => { if (!isFav) e.currentTarget.style.color = 'var(--text-2)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24"
              fill={isFav ? 'currentColor' : 'none'}
              stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
        )}
        {/* Play arrow on hover */}
        {hovered && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--accent-interactive)">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </div>
    </div>
  )
}

// ─── Virtual grid ────────────────────────────────────────────────────────────

export function VirtualGrid({ items, onSelect, viewMode = 'grid' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    ro.observe(el)
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const isList = viewMode === 'list'
  const isLive = items[0]?.type === 'live'
  const gap = isList ? 2 : 8
  const colGap = isList ? 8 : gap
  const padding = 16

  // Per-type dimensions (grid mode)
  const minCardWidth = isLive ? 140 : 120
  const maxCardWidth = isLive ? 220 : 180
  const gridRowHeight = isLive ? 116 : 242
  const listRowHeight = 32

  const rowHeight = isList ? listRowHeight : gridRowHeight
  const availableWidth = containerWidth - padding * 2

  const columns = isList
    ? 3
    : availableWidth > 0
      ? Math.max(2, Math.floor((availableWidth + gap) / (minCardWidth + gap)))
      : 2

  const rows: ContentItem[][] = []
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns))
  }

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback(() => rowHeight + gap, [rowHeight, gap]),
    overscan: isList ? 8 : 3,
  })

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <div
        style={{
          position: 'relative',
          height: virtualizer.getTotalSize(),
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]
          if (!row) return null

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: virtualRow.start,
                left: 0,
                right: 0,
                height: rowHeight,
                display: 'flex',
                gap: colGap,
                padding: `0 ${padding}px`,
                background: isList && virtualRow.index % 2 === 1
                  ? 'color-mix(in srgb, var(--text-0) 2.5%, transparent)'
                  : 'transparent',
              }}
            >
              {row.map((item) => (
                <div
                  key={item.id}
                  style={isList ? {
                    flex: 1,
                    minWidth: 0,
                    height: rowHeight,
                  } : {
                    flex: 1,
                    minWidth: minCardWidth,
                    maxWidth: maxCardWidth,
                    height: rowHeight,
                    overflow: 'hidden',
                  }}
                >
                  {isList
                    ? <ChannelListRow item={item} onClick={onSelect} />
                    : item.type === 'live'
                      ? <ChannelCard item={item} onClick={onSelect} />
                      : <PosterCard item={item} onClick={onSelect} />
                  }
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
