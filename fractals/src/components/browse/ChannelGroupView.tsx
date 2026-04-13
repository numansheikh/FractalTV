import { useState } from 'react'
import { ContentItem } from '@/lib/types'
import { useSourcesStore } from '@/stores/sources.store'
import { useSearchStore } from '@/stores/search.store'
import { useAppStore } from '@/stores/app.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'

const MAX_VISIBLE = 4

function countryFlag(code: string | undefined): string | null {
  if (!code || code.length !== 2) return null
  const base = 0x1F1E6 - 65
  return String.fromCodePoint(base + code.toUpperCase().charCodeAt(0), base + code.toUpperCase().charCodeAt(1))
}

interface StreamRow {
  id: string
  canonical_channel_id: string
  title: string
  source_id: string
  thumbnail_url: string | null
  category_name: string | null
}

interface CanonicalGroup {
  id: string
  title: string
  country?: string
  network?: string
  poster_url?: string
  is_nsfw?: number
  closed?: string
  categories?: string   // JSON array string e.g. '["News","Entertainment"]'
  streams: StreamRow[]
}

interface Props {
  groups: CanonicalGroup[]
  onSelect: (item: ContentItem) => void
  hasCategory: boolean  // true → show "similar" pill; false → show category pill
}

export function ChannelGroupView({ groups, onSelect, hasCategory }: Props) {
  const sources = useSourcesStore((s) => s.sources)
  const colorMap = buildColorMapFromSources(sources)
  const { seedQuery } = useSearchStore()
  const setCategoryFilter = useAppStore((s) => s.setCategoryFilter)

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
      {groups.map(group => (
        <ChannelGroup key={group.id} group={group} onSelect={onSelect} hasCategory={hasCategory}
          colorMap={colorMap} setCategoryFilter={setCategoryFilter} seedQuery={seedQuery} />
      ))}
    </div>
  )
}

function ChannelGroup({ group, onSelect, hasCategory, colorMap, setCategoryFilter, seedQuery }: {
  group: CanonicalGroup
  onSelect: (item: ContentItem) => void
  hasCategory: boolean
  colorMap: Record<string, { accent: string }>
  setCategoryFilter: (cat: string | null) => void
  seedQuery: (view: string, query: string) => void
}) {

  const flag = countryFlag(group.country)
  const isDefunct = !!group.closed

  // Parse primary category from JSON array
  let primaryCategory: string | null = null
  try {
    if (group.categories) {
      const arr = JSON.parse(group.categories) as string[]
      primaryCategory = arr[0] ?? null
    }
  } catch { /* ignore */ }

  const visibleStreams = group.streams.slice(0, MAX_VISIBLE)
  const hiddenCount = group.streams.length - visibleStreams.length

  const canonicalItem: ContentItem = {
    id: group.id,
    type: 'live',
    title: group.title,
    poster_url: group.poster_url,
    country: group.country,
    network: group.network,
    closed: group.closed,
  }

  return (
    <div style={{
      background: 'var(--bg-2)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 10,
      display: 'inline-flex',
      flexDirection: 'row',
      alignItems: 'flex-start',
      maxWidth: '100%',
      overflow: 'hidden',
    }}>
      {/* Info panel */}
      <InfoPanel
        group={group}
        flag={flag}
        primaryCategory={primaryCategory}
        isDefunct={isDefunct}
        onSelect={() => onSelect(canonicalItem)}
      />

      {/* Streams area */}
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: '10px 10px 10px 6px',
        gap: 8,
      }}>
        {visibleStreams.map(stream => (
          <StreamCard
            key={stream.id}
            stream={stream}
            colorMap={colorMap}
            hasCategory={hasCategory}
            onSelect={() => {
              const item: ContentItem = {
                id: stream.id,
                type: 'live',
                title: stream.title,
                poster_url: stream.thumbnail_url ?? undefined,
                canonical_channel_id: group.id,
                category_name: stream.category_name ?? undefined,
              }
              onSelect(item)
            }}
            onCategoryClick={() => {
              if (stream.category_name) setCategoryFilter(stream.category_name)
            }}
            onSimilarClick={() => {
              setCategoryFilter(null)
              seedQuery('live', group.title)
            }}
          />
        ))}

        {/* More chip */}
        {hiddenCount > 0 && (
          <div
            onClick={() => onSelect(canonicalItem)}
            title={`${hiddenCount} more stream${hiddenCount > 1 ? 's' : ''}`}
            style={{
              alignSelf: 'center',
              flexShrink: 0,
              borderRadius: 20,
              border: '1px solid var(--border-subtle)',
              padding: '3px 8px',
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--text-2)',
              cursor: 'pointer',
              background: 'transparent',
              whiteSpace: 'nowrap',
              transition: 'border-color 0.12s, color 0.12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.color = 'var(--text-2)' }}
          >
            +{hiddenCount}
          </div>
        )}
      </div>
    </div>
  )
}

function InfoPanel({ group, flag, primaryCategory, isDefunct, onSelect }: {
  group: CanonicalGroup
  flag: string | null
  primaryCategory: string | null
  isDefunct: boolean
  onSelect: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 140,
        flexShrink: 0,
        padding: '10px 10px 10px 12px',
        borderRight: `1px solid var(--border-subtle)`,
        cursor: 'pointer',
        background: hovered ? 'var(--bg-3)' : 'transparent',
        transition: 'background 0.12s',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        userSelect: 'none',
      }}
    >
      <p style={{
        fontSize: 11,
        fontWeight: 700,
        color: hovered
          ? 'var(--accent-interactive)'
          : isDefunct ? 'var(--text-3)' : 'var(--text-0)',
        lineHeight: 1.2,
        margin: 0,
        transition: 'color 0.12s',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {group.title}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
        {flag && (
          <span style={{ fontSize: 11, lineHeight: 1 }} title={group.country ?? ''}>
            {flag}
          </span>
        )}
        {primaryCategory && (
          <span style={{
            fontSize: 9, fontWeight: 600,
            padding: '1px 4px', borderRadius: 3,
            background: 'var(--bg-3)',
            color: 'var(--text-2)',
            lineHeight: 1.5,
          }}>
            {primaryCategory}
          </span>
        )}
        {isDefunct && (
          <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 400 }}>DEFUNCT</span>
        )}
      </div>

      {group.network && (
        <p style={{
          fontSize: 9,
          color: 'var(--text-2)',
          margin: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {group.network}
        </p>
      )}

      <p style={{ fontSize: 9, color: 'var(--text-3)', margin: '3px 0 0', lineHeight: 1 }}>
        ↗ Details
      </p>
    </div>
  )
}

function StreamCard({ stream, colorMap, hasCategory, onSelect, onCategoryClick, onSimilarClick }: {
  stream: StreamRow
  colorMap: Record<string, { accent: string }>
  hasCategory: boolean
  onSelect: () => void
  onCategoryClick: () => void
  onSimilarClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)
  const sourceColor = colorMap[stream.source_id]
  const hasPoster = stream.thumbnail_url && !imgError

  const initials = stream.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')

  return (
    <div style={{ width: 110, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Card */}
      <div
        onClick={onSelect}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          borderRadius: 7,
          border: `1px solid ${hovered ? 'var(--border-default)' : 'var(--border-subtle)'}`,
          cursor: 'pointer',
          position: 'relative',
          background: 'var(--bg-1)',
          overflow: 'hidden',
          boxShadow: hovered ? '0 2px 8px rgba(0,0,0,0.18)' : 'none',
          transition: 'border-color 0.12s, box-shadow 0.12s',
          userSelect: 'none',
        }}
      >
        {/* Source stripe */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, zIndex: 2,
          background: sourceColor?.accent ?? 'var(--border-subtle)',
        }} />

        {/* Logo area 16:9 */}
        <div style={{
          aspectRatio: '16/9',
          background: 'var(--bg-3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', overflow: 'hidden',
        }}>
          {hasPoster ? (
            <img
              src={stream.thumbnail_url!}
              alt=""
              loading="lazy"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', padding: '10%' }}
              onError={() => setImgError(true)}
            />
          ) : (
            <span style={{
              fontSize: 13, fontWeight: 800,
              color: sourceColor ? sourceColor.accent : 'var(--text-2)',
              opacity: 0.35,
              letterSpacing: '-0.02em',
            }}>
              {initials}
            </span>
          )}

          {/* Play overlay */}
          {hovered && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(124,77,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: 'var(--accent-interactive)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="7" height="7" viewBox="0 0 24 24" fill="white">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* Title */}
        <div style={{ padding: '4px 7px 5px 10px' }}>
          <p style={{
            fontSize: 10, fontWeight: 600,
            color: 'var(--text-0)',
            margin: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {stream.title}
          </p>
        </div>
      </div>

      {/* Pill below card */}
      <div style={{ padding: '4px 2px 0 4px' }}>
        {hasCategory ? (
          // Similar pill — search for canonical title
          <span
            onClick={onSimilarClick}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 9, fontWeight: 700, fontStyle: 'italic',
              padding: '3px 8px', borderRadius: 10,
              color: 'var(--accent-interactive)',
              border: '1px solid color-mix(in srgb, var(--accent-interactive) 35%, transparent)',
              background: 'color-mix(in srgb, var(--accent-interactive) 8%, transparent)',
              cursor: 'pointer',
              transition: 'background 0.12s, border-color 0.12s',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-interactive) 16%, transparent)'
              e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-interactive) 55%, transparent)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-interactive) 8%, transparent)'
              e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-interactive) 35%, transparent)'
            }}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="10" cy="10" r="6" />
              <line x1="21" y1="21" x2="14.65" y2="14.65" />
            </svg>
            similar
          </span>
        ) : stream.category_name ? (
          // Category pill — navigate to category
          <span
            onClick={onCategoryClick}
            style={{
              display: 'inline-block',
              fontSize: 9, fontWeight: 600,
              padding: '3px 8px', borderRadius: 10,
              background: 'var(--bg-3)',
              color: 'var(--text-2)',
              border: '1px solid transparent',
              cursor: 'pointer',
              transition: 'background 0.1s, color 0.1s, border-color 0.1s',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              maxWidth: '100%',
              userSelect: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-interactive) 10%, transparent)'
              e.currentTarget.style.color = 'var(--accent-interactive)'
              e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-interactive) 30%, transparent)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-3)'
              e.currentTarget.style.color = 'var(--text-2)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            {stream.category_name}
          </span>
        ) : null}
      </div>
    </div>
  )
}
