import { useState } from 'react'
import { ContentItem } from '@/lib/types'
import { PosterCard } from '@/components/cards/PosterCard'
import { ChannelCard } from '@/components/cards/ChannelCard'

interface Props {
  items: ContentItem[]
  onSelect: (item: ContentItem) => void
}

interface SectionConfig {
  key: 'live' | 'movie' | 'series'
  label: string
  accentColor: string
}

const SECTIONS: SectionConfig[] = [
  { key: 'live',   label: 'Live Channels', accentColor: 'var(--accent-live)' },
  { key: 'movie',  label: 'Movies',        accentColor: 'var(--accent-film)' },
  { key: 'series', label: 'Series',        accentColor: 'var(--accent-series)' },
]

const INITIAL_CAP = 20

export function SearchResults({ items, onSelect }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    live: false,
    movie: false,
    series: false,
  })

  const grouped = {
    live:   items.filter((i) => i.type === 'live'),
    movie:  items.filter((i) => i.type === 'movie'),
    series: items.filter((i) => i.type === 'series'),
  }

  const toggleSection = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))

  return (
    <div
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        fontFamily: 'var(--font-ui)',
      }}
    >
      {SECTIONS.map(({ key, label, accentColor }) => {
        const all = grouped[key]
        if (all.length === 0) return null

        const isExpanded = expanded[key]
        const isCapped = !isExpanded && all.length > INITIAL_CAP
        const visible = isExpanded ? all : all.slice(0, INITIAL_CAP)
        const countLabel = isCapped ? `(${INITIAL_CAP}+)` : `(${all.length})`

        const isChannel = key === 'live'
        const gridStyle: React.CSSProperties = {
          display: 'grid',
          gridTemplateColumns: isChannel
            ? 'repeat(auto-fill, minmax(160px, 1fr))'
            : 'repeat(auto-fill, minmax(130px, 1fr))',
          gap: 8,
        }

        return (
          <div key={key}>
            {/* Section header row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                paddingBottom: 8,
                marginBottom: 10,
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-2)',
                }}
              >
                {label}
              </span>

              <span
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-2)',
                }}
              >
                {countLabel}
              </span>

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              <button
                onClick={() => toggleSection(key)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '0 2px',
                  cursor: 'pointer',
                  fontSize: 11,
                  color: accentColor,
                  fontFamily: 'var(--font-ui)',
                  lineHeight: 1,
                  opacity: 0.85,
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.opacity = '1')
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.opacity = '0.85')
                }
              >
                {isExpanded ? 'Show less ←' : 'Show all →'}
              </button>
            </div>

            {/* Card grid */}
            <div style={gridStyle}>
              {visible.map((item) =>
                isChannel ? (
                  <ChannelCard key={item.id} item={item} onClick={onSelect} />
                ) : (
                  <PosterCard key={item.id} item={item} onClick={onSelect} />
                )
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
