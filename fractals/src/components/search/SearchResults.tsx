import React from 'react'
import { ContentItem } from '@/lib/types'
import { PosterCard } from '@/components/cards/PosterCard'
import { ChannelCard } from '@/components/cards/ChannelCard'

interface TypeBucket {
  results: ContentItem[]
  onShowAll: () => void
}

interface Props {
  live: TypeBucket
  movies: TypeBucket
  series: TypeBucket
  onSelect: (item: ContentItem) => void
}

const INITIAL_CAP = 20

const SECTIONS = [
  { key: 'live'   as const, label: 'Live Channels', accentColor: 'var(--accent-live)',    isChannel: true  },
  { key: 'movies' as const, label: 'Movies',        accentColor: 'var(--accent-film)',    isChannel: false },
  { key: 'series' as const, label: 'Series',        accentColor: 'var(--accent-series)',  isChannel: false },
]

export function SearchResults({ live, movies, series, onSelect }: Props) {
  const buckets: Record<string, TypeBucket> = { live, movies, series }

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
      {SECTIONS.map(({ key, label, accentColor, isChannel }) => {
        const bucket = buckets[key]
        const { results, onShowAll } = bucket

        if (results.length === 0) return null

        // N+1 trick: if we got more than INITIAL_CAP rows, there are more to fetch
        const hasMore = results.length > INITIAL_CAP
        const visible = results.slice(0, INITIAL_CAP)
        const countLabel = hasMore ? `(${INITIAL_CAP}+)` : `(${results.length})`

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

              <div style={{ flex: 1 }} />

              {hasMore && (
                <button
                  onClick={onShowAll}
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
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.85')}
                >
                  Show all →
                </button>
              )}
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
