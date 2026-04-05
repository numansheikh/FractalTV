import { useRef, useState, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ContentItem } from '@/lib/types'
import { PosterCard } from '@/components/cards/PosterCard'
import { ChannelCard } from '@/components/cards/ChannelCard'

interface Props {
  items: ContentItem[]
  onSelect: (item: ContentItem) => void
  columnWidth?: number
}

export function VirtualGrid({ items, onSelect, columnWidth = 130 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  // Measure container width via ResizeObserver
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    ro.observe(el)
    // Set initial width
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const gap = 8
  const columns = containerWidth > 0
    ? Math.max(2, Math.floor(containerWidth / (columnWidth + gap)))
    : 2

  // Chunk items into rows
  const rows: ContentItem[][] = []
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns))
  }

  const itemHeight = Math.floor(columnWidth * 1.5) + 40
  const channelCardWidth = Math.floor(columnWidth * 1.23)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback(() => itemHeight + gap, [itemHeight, gap]),
    overscan: 3,
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
                height: itemHeight,
                display: 'flex',
                gap: gap,
                padding: '0 16px',
              }}
            >
              {row.map((item) => {
                const isLive = item.type === 'live'
                const cardWidth = isLive ? channelCardWidth : columnWidth
                return (
                  <div
                    key={item.id}
                    style={{
                      width: cardWidth,
                      flexShrink: 0,
                      height: isLive ? undefined : itemHeight,
                    }}
                  >
                    {isLive
                      ? <ChannelCard item={item} onClick={onSelect} />
                      : <PosterCard item={item} onClick={onSelect} />
                    }
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
