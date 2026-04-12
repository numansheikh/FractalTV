import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContentItem, BreadcrumbNav } from '@/lib/types'
import { api } from '@/lib/api'
import { useSourcesStore } from '@/stores/sources.store'
import { useSearchStore } from '@/stores/search.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { MetadataBlock } from './MetadataBlock'
import { ActionButtons } from './ActionButtons'
import { EnrichmentFallback } from './EnrichmentFallback'

interface Props {
  item: ContentItem
  onPlay: (item: ContentItem) => void
  onClose: () => void
  onNavigate: (nav: BreadcrumbNav) => void
  isPlaying?: boolean
}

export function MovieDetail({ item, onPlay, onClose, onNavigate, isPlaying }: Props) {
  const [plotExpanded, setPlotExpanded] = useState(false)

  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)
  const setQuery = useSearchStore((s) => s.setQuery)

  const { data: enrichedItem, refetch } = useQuery({
    queryKey: ['content', item.id],
    queryFn: () => api.content.get(item.id),
    staleTime: 5 * 60_000,
  })

  const c = (enrichedItem as ContentItem | null) ?? item
  const isEnriched = !!(c.enriched)
  const primarySourceId = c.primarySourceId ?? c.primary_source_id ?? item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const primarySource = primarySourceId ? sources.find((s) => s.id === primarySourceId) : undefined

  let allSourceIds: string[] = []
  try {
    if (c.sourceIds) allSourceIds = JSON.parse(c.sourceIds)
  } catch {
    if (c.sourceIds) allSourceIds = [c.sourceIds]
  }
  if (!allSourceIds.length && primarySourceId) allSourceIds = [primarySourceId]

  const plot = c.plot ?? ''
  const cast: string[] = (() => {
    if (!c.cast) return []
    try { const p = JSON.parse(c.cast); return Array.isArray(p) ? p : [String(p)] } catch { return [c.cast] }
  })()

  const categoryName = (c as any).categoryName ?? (c as any).category_name

  const handleRefetch = () => {
    refetch()
  }

  return (
    <SlidePanel open={true} onClose={onClose} width={420} suppressClose={isPlaying}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-1)' }}>

        {/* Header bar */}
        <div style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          {/* Close */}
          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              lineHeight: 1,
              transition: 'color 0.12s',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-0)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-2)' }}
          >
            ✕
          </button>

          {/* Type badge */}
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--accent-film)',
            background: 'color-mix(in srgb, var(--accent-film) 15%, transparent)',
            borderRadius: 4,
            padding: '2px 7px',
            fontFamily: 'var(--font-ui)',
            letterSpacing: '0.04em',
          }}>
            FILM
          </span>

          <div style={{ flex: 1 }} />

          {/* Source indicator */}
          {allSourceIds.length <= 1 && primarySource && sourceColor && (
            <span style={{
              fontSize: 11,
              fontWeight: 500,
              color: sourceColor.accent,
              background: sourceColor.dim,
              borderRadius: 4,
              padding: '2px 7px',
              fontFamily: 'var(--font-ui)',
              maxWidth: 120,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {primarySource.name}
            </span>
          )}
          {allSourceIds.length > 1 && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {allSourceIds.slice(0, 4).map((sid, i) => {
                const sc = colorMap[sid]
                return (
                  <div key={sid ?? i} style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: sc?.accent ?? 'var(--text-3)',
                    flexShrink: 0,
                  }} />
                )
              })}
              {allSourceIds.length > 4 && (
                <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-ui)' }}>
                  +{allSourceIds.length - 4}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Breadcrumbs — pinned above scroll */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexWrap: 'wrap',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          {primarySource && sourceColor && (
            <>
              <BreadcrumbLink
                color={sourceColor.accent}
                onClick={() => onNavigate({ sourceId: primarySourceId })}
              >
                {primarySource.name}
              </BreadcrumbLink>
              <BreadcrumbSep />
            </>
          )}
          <BreadcrumbLink
            color="var(--accent-film)"
            onClick={() => onNavigate({ type: 'movie' })}
          >
            Films
          </BreadcrumbLink>
          {categoryName && (
            <>
              <BreadcrumbSep />
              <BreadcrumbLink
                color="var(--accent-film)"
                onClick={() => onNavigate({ type: 'movie', category: categoryName })}
                bold
              >
                {categoryName}
              </BreadcrumbLink>
            </>
          )}
        </div>

        {/* Scrollable content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}>
          <MetadataBlock item={c} isEnriched={isEnriched} />

          <ActionButtons item={c} onPlay={onPlay} />

          {/* Plot */}
          {plot && (
            <div>
              <p style={{
                fontSize: 13,
                color: 'var(--text-1)',
                lineHeight: 1.6,
                margin: 0,
                fontFamily: 'var(--font-ui)',
                ...(plotExpanded ? {} : {
                  display: '-webkit-box',
                  WebkitLineClamp: 6,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }),
              }}>
                {plot}
              </p>
              {plot.length > 320 && (
                <button
                  onClick={() => setPlotExpanded((v) => !v)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '4px 0 0',
                    fontSize: 11,
                    color: 'var(--accent-interactive)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-ui)',
                    transition: 'opacity 0.12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.75' }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                >
                  {plotExpanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}

          {/* Cast pills */}
          {cast.length > 0 && (
            <div>
              <p style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-3)',
                margin: '0 0 6px',
                fontFamily: 'var(--font-ui)',
              }}>
                Cast
              </p>
              <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
                {cast.slice(0, 12).map((name) => (
                  <button
                    key={name}
                    onClick={() => {
                      setQuery(name)
                      onClose()
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 20,
                      background: 'var(--bg-3)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-1)',
                      fontSize: 11,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      fontFamily: 'var(--font-ui)',
                      flexShrink: 0,
                      transition: 'background 0.1s, color 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-4)'
                      e.currentTarget.style.color = 'var(--text-0)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'var(--bg-3)'
                      e.currentTarget.style.color = 'var(--text-1)'
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* EnrichmentFallback hidden until g2+ TMDB integration */}

          {/* Breadcrumbs moved to top */}
        </div>
      </div>
    </SlidePanel>
  )
}

function BreadcrumbLink({ children, color, onClick, bold }: { children: React.ReactNode; color: string; onClick: () => void; bold?: boolean }) {
  return (
    <span
      onClick={onClick}
      style={{
        fontSize: bold ? 11 : 10,
        fontWeight: bold ? 600 : 400,
        color,
        cursor: 'pointer',
        fontFamily: 'var(--font-ui)',
        transition: 'opacity 0.12s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.65'; e.currentTarget.style.textDecoration = 'underline' }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.textDecoration = 'none' }}
    >
      {children}
    </span>
  )
}

function BreadcrumbSep() {
  return (
    <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2.5" strokeLinecap="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
