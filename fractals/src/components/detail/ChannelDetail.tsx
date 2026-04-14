import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContentItem, BreadcrumbNav } from '@/lib/types'
import { api } from '@/lib/api'
import { useSourcesStore } from '@/stores/sources.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { ActionButtons } from './ActionButtons'

interface Props {
  item: ContentItem
  onPlay: (item: ContentItem) => void
  onClose: () => void
  onNavigate: (nav: BreadcrumbNav) => void
  isPlaying?: boolean
}

export function ChannelDetail({ item, onPlay, onClose, onNavigate, isPlaying }: Props) {
  const [imgError, setImgError] = useState(false)

  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)

  const { data: enrichedItem } = useQuery({
    queryKey: ['content', item.id],
    queryFn: () => api.content.get(item.id),
    staleTime: 5 * 60_000,
  })

  const c = (enrichedItem as ContentItem | null) ?? item
  const primarySourceId = c.primarySourceId ?? c.primary_source_id ?? item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const primarySource = primarySourceId ? sources.find((s) => s.id === primarySourceId) : undefined

  const logo = c.posterUrl ?? c.poster_url
  const hasLogo = logo && !imgError
  const categoryName = (c as any).categoryName ?? (c as any).category_name
  const tvgId = (c as any).tvg_id ?? (c as any).tvgId
  const epgChannelId = (c as any).epg_channel_id ?? (c as any).epgChannelId
  const catchupSupported = ((c as any).catchup_supported ?? (c as any).catchupSupported) === 1
  const catchupDays = (c as any).catchup_days ?? (c as any).catchupDays

  const initials = item.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

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
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'transparent', border: 'none',
              color: 'var(--text-2)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, lineHeight: 1,
              transition: 'color 0.12s', flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-0)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-2)' }}
          >
            ✕
          </button>

          <span style={{
            fontSize: 11, fontWeight: 600,
            color: 'var(--accent-live)',
            background: 'color-mix(in srgb, var(--accent-live) 15%, transparent)',
            borderRadius: 4, padding: '2px 7px',
            fontFamily: 'var(--font-ui)', letterSpacing: '0.04em',
          }}>
            CHANNEL
          </span>

          <div style={{ flex: 1 }} />

          {primarySource && sourceColor && (
            <span style={{
              fontSize: 11, fontWeight: 500,
              color: sourceColor.accent,
              background: sourceColor.dim,
              borderRadius: 4, padding: '2px 7px',
              fontFamily: 'var(--font-ui)',
              maxWidth: 120,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {primarySource.name}
            </span>
          )}
        </div>

        {/* Breadcrumbs */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          {primarySource && sourceColor && (
            <>
              <BreadcrumbLink color={sourceColor.accent} onClick={() => onNavigate({ sourceId: primarySourceId })}>
                {primarySource.name}
              </BreadcrumbLink>
              <BreadcrumbSep />
            </>
          )}
          <BreadcrumbLink color="var(--accent-live)" onClick={() => onNavigate({ type: 'live' })}>
            Channels
          </BreadcrumbLink>
          {categoryName && (
            <>
              <BreadcrumbSep />
              <BreadcrumbLink
                color="var(--accent-live)"
                onClick={() => onNavigate({ type: 'live', category: categoryName })}
                bold
              >
                {categoryName}
              </BreadcrumbLink>
            </>
          )}
        </div>

        {/* Scrollable content */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: 16,
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {/* Logo + title */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{
              width: 96, height: 96,
              borderRadius: 8,
              background: 'var(--bg-3)',
              border: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
            }}>
              {hasLogo ? (
                <img
                  src={logo}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 10 }}
                  onError={() => setImgError(true)}
                />
              ) : (
                <span style={{
                  fontSize: 28, fontWeight: 700,
                  color: sourceColor?.accent ?? 'var(--text-2)',
                  opacity: 0.7, letterSpacing: '-0.02em',
                }}>
                  {initials}
                </span>
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 style={{
                fontSize: 18, fontWeight: 600,
                color: 'var(--text-0)',
                margin: 0, lineHeight: 1.3,
                fontFamily: 'var(--font-ui)',
                wordBreak: 'break-word',
              }}>
                {c.title}
              </h2>
              {catchupSupported && (
                <p style={{
                  marginTop: 6, margin: 0,
                  fontSize: 11, color: 'var(--text-2)',
                  fontFamily: 'var(--font-ui)',
                }}>
                  Catchup{catchupDays ? ` · ${catchupDays} days` : ''}
                </p>
              )}
            </div>
          </div>

          <ActionButtons item={c} onPlay={onPlay} overridePlayLabel="▶ Watch live" />

          {/* Minimal technical metadata — shown only if present */}
          {(tvgId || epgChannelId) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{
                fontSize: 10, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                color: 'var(--text-3)',
                margin: 0, fontFamily: 'var(--font-ui)',
              }}>
                EPG identity
              </p>
              {tvgId && <MetaRow label="tvg-id" value={String(tvgId)} />}
              {epgChannelId && epgChannelId !== tvgId && (
                <MetaRow label="EPG channel" value={String(epgChannelId)} />
              )}
            </div>
          )}
        </div>
      </div>
    </SlidePanel>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{
        fontSize: 11, color: 'var(--text-3)',
        fontFamily: 'var(--font-mono)',
        minWidth: 90,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 11, color: 'var(--text-1)',
        fontFamily: 'var(--font-mono)',
        wordBreak: 'break-all',
      }}>
        {value}
      </span>
    </div>
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
