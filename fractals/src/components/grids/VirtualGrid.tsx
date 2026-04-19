import { memo, useRef, useState, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useQueryClient } from '@tanstack/react-query'
import { ContentItem } from '@/lib/types'
import { MoviePosterCard } from '@/components/cards/MoviePosterCard'
import { SeriesPosterCard } from '@/components/cards/SeriesPosterCard'
import { ChannelCard } from '@/components/cards/ChannelCard'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { useAppStore } from '@/stores/app.store'
import { api } from '@/lib/api'

interface Props {
  items: ContentItem[]
  onSelect: (item: ContentItem) => void
  viewMode?: 'grid' | 'list'
  isLoading?: boolean
  contentType?: 'live' | 'movie' | 'series'
  scrollKey?: string
}

// Module-level cache — survives re-renders but resets on full page reload.
const scrollCache = new Map<string, number>()

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

interface ChannelListCardProps {
  item: ContentItem
  onClick: (item: ContentItem) => void
}

const ChannelListCard = memo(function ChannelListCard({ item, onClick }: ChannelListCardProps) {
  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [marqueeOffset, setMarqueeOffset] = useState(0)
  const nameContainerRef = useRef<HTMLDivElement>(null)
  const nameSpanRef = useRef<HTMLSpanElement>(null)

  const primarySourceId = item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]
  const sourceColor = useSourcesStore((s) => (primarySourceId ? s._colorMap[primarySourceId] : undefined))
  const sourceName = useSourcesStore((s) => (primarySourceId ? s._sourceNames[primarySourceId] : undefined))
  const multiSource = useSourcesStore((s) => s._sourceCount > 1)

  // Favorite state
  const isFav = !!useUserStore((s) => s.data[item.id]?.favorite)
  const setSelectedContent = useAppStore((s) => s.setSelectedContent)
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
    if (item.type === 'live') qc.invalidateQueries({ queryKey: ['channels', 'favorites'] })
  }

  const showSourceBadge = multiSource && sourceName
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
        <div
          title={sourceName ? `Source: ${sourceName}` : undefined}
          style={{
            position: 'absolute',
            left: 0, top: 4, bottom: 4,
            width: 3,
            borderRadius: 2,
            background: sourceColor.accent,
            flexShrink: 0,
          }}
        />
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
        {/* Details pill on hover — outlined, far right */}
        {hovered && (
          <button
            onClick={(e) => { e.stopPropagation(); setSelectedContent(item) }}
            title="Details"
            style={{
              background: 'transparent',
              color: 'var(--accent-live)',
              border: '1px solid var(--accent-live)',
              borderRadius: 4,
              height: 18,
              padding: '0 6px',
              fontSize: 10, fontWeight: 600,
              fontFamily: 'var(--font-ui)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center',
              lineHeight: 1,
            }}
          >
            Details
          </button>
        )}
      </div>
    </div>
  )
})

// ─── Virtual grid ────────────────────────────────────────────────────────────

export function VirtualGrid({ items, onSelect, viewMode = 'grid', isLoading, contentType, scrollKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

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

  // Restore scroll position when scrollKey changes or items first load
  useEffect(() => {
    if (!scrollKey || !containerRef.current || items.length === 0) return
    const saved = scrollCache.get(scrollKey)
    if (saved) containerRef.current.scrollTop = saved
  }, [scrollKey, items.length > 0])

  const isList = viewMode === 'list'
  const isLive = items[0]?.type === 'live'
  const gap = isList ? 2 : 10
  const colGap = isList ? 8 : gap
  const padding = 16

  // Per-type dimensions (grid mode)
  const minCardWidth = isLive ? 140 : 120
  const maxCardWidth = isLive ? 220 : 180
  const listRowHeight = 32

  const availableWidth = containerWidth - padding * 2

  const columns = isList
    ? 3
    : availableWidth > 0
      ? Math.max(2, Math.floor((availableWidth + gap) / (minCardWidth + gap)))
      : 2

  // Compute actual card width to derive row height from aspect ratio + metadata
  const actualCardWidth = isList ? 0 : Math.min(maxCardWidth, Math.floor((availableWidth - (columns - 1) * gap) / columns))
  // Metadata strip: compact tinted caption + 12px overhang for the hanging Details button.
  // Both poster types now share 76px; captionHeight stays as a single value.
  const captionHeight = 76
  const gridRowHeight = isLive
    ? Math.ceil(actualCardWidth * 9 / 16) + 60              // 16:9 + name strip (2-line title reserved) + 12px overhang for hanging Details button
    : Math.ceil(actualCardWidth * 3 / 2) + captionHeight    // 2:3 + metadata strip
  const rowHeight = isList ? listRowHeight : gridRowHeight

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

  // ─── Arrow-key grid navigation ───────────────────────────────────────────
  // Reset focused index when items change (view/filter switch)
  useEffect(() => { setFocusedIndex(null) }, [items])

  const handleGridKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return
    // Don't intercept if a child input has focus
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
    e.preventDefault()
    e.stopPropagation()

    if (e.key === 'Enter') {
      if (focusedIndex !== null && items[focusedIndex]) onSelect(items[focusedIndex])
      return
    }

    const current = focusedIndex ?? -1
    let next = current
    if (e.key === 'ArrowRight') next = current + 1
    else if (e.key === 'ArrowLeft') next = current - 1
    else if (e.key === 'ArrowDown') next = current + columns
    else if (e.key === 'ArrowUp') next = current - columns

    // Initialize: first arrow press focuses first card
    if (current === -1) next = 0

    next = Math.max(0, Math.min(items.length - 1, next))
    setFocusedIndex(next)
    virtualizer.scrollToIndex(Math.floor(next / columns), { align: 'auto' })
  }, [focusedIndex, items, columns, onSelect, virtualizer])

  // ─── Background enrichment prefetch ──────────────────────────────────────
  // Wait 400ms after scroll settles, then send visible movie/series IDs to main
  // process for Level 1 enrichment (Wikidata + TVmaze). TMDB stays on-demand.
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const virtualItems = virtualizer.getVirtualItems()
  const visibleIdsKey = virtualItems.length > 0 && rows.length > 0
    ? `${virtualItems[0]?.index}-${virtualItems[virtualItems.length - 1]?.index}-${rows.length}`
    : ''
  useEffect(() => {
    if (contentType === 'live' || !visibleIdsKey) return
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
    prefetchTimerRef.current = setTimeout(() => {
      const ids: string[] = []
      for (const vi of virtualItems) {
        const row = rows[vi.index]
        if (!row) continue
        for (const item of row) {
          if (item.id && (item.id.includes(':movie:') || item.id.includes(':series:'))) {
            ids.push(item.id)
          }
        }
      }
      if (ids.length > 0) api.vodEnrich.prefetchVisible(ids).catch(() => { /* silent */ })
    }, 400)
    return () => {
      if (prefetchTimerRef.current) { clearTimeout(prefetchTimerRef.current); prefetchTimerRef.current = null }
    }
  }, [visibleIdsKey, contentType])
  useEffect(() => {
    return () => { api.vodEnrich.cancelPrefetch().catch(() => {}) }
  }, [])

  // Show skeleton when loading with no items
  if (isLoading && items.length === 0) {
    const skeletonType = contentType === 'live' ? 'channel' : 'poster'
    const skeletonCount = columns * 4
    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: `0 ${padding}px`,
        }}
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: gap,
          paddingTop: gap,
        }}>
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <div key={i} style={{
              borderRadius: 6,
              overflow: 'hidden',
              background: 'var(--bg-2)',
              border: '1px solid var(--border-subtle)',
            }}>
              <div style={{
                aspectRatio: skeletonType === 'channel' ? '16/9' : '2/3',
                background: 'linear-gradient(90deg, var(--bg-2) 25%, var(--bg-3) 50%, var(--bg-2) 75%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.4s infinite',
              }} />
              <div style={{ padding: '6px 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ height: 10, borderRadius: 3, background: 'var(--bg-3)', width: '70%' }} />
                {skeletonType === 'poster' && (
                  <div style={{ height: 8, borderRadius: 3, background: 'var(--bg-3)', width: '45%' }} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
      onBlur={() => setFocusedIndex(null)}
      onScroll={scrollKey ? (e) => { scrollCache.set(scrollKey, (e.currentTarget as HTMLDivElement).scrollTop) } : undefined}
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        outline: 'none',
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
              {row.map((item, colIdx) => {
                const flatIdx = virtualRow.index * columns + colIdx
                const isFocused = flatIdx === focusedIndex
                return (
                <div
                  key={item.id}
                  style={isList ? {
                    flex: 1,
                    minWidth: 0,
                    height: rowHeight,
                    borderRadius: 6,
                    outline: isFocused ? '2px solid var(--accent-interactive)' : 'none',
                    outlineOffset: 2,
                  } : {
                    flex: '0 0 auto',
                    width: actualCardWidth,
                    height: rowHeight,
                    overflow: 'hidden',
                    borderRadius: 6,
                    outline: isFocused ? '2px solid var(--accent-interactive)' : 'none',
                    outlineOffset: 2,
                  }}
                >
                  {isList
                    ? <ChannelListCard item={item} onClick={onSelect} />
                    : item.type === 'live'
                      ? <ChannelCard item={item} onClick={onSelect} />
                      : item.type === 'series'
                        ? <SeriesPosterCard item={item} onClick={onSelect} />
                        : <MoviePosterCard item={item} onClick={onSelect} />
                  }
                </div>
              )})}
            </div>
          )
        })}
      </div>
    </div>
  )
}
