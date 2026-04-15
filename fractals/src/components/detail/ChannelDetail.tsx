import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContentItem, BreadcrumbNav } from '@/lib/types'
import { api } from '@/lib/api'
import { useSourcesStore } from '@/stores/sources.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { ActionButtons } from './ActionButtons'
import { DetailShell, BreadcrumbItem } from './DetailShell'
import { fmtTime } from '@/lib/time'

interface EpgProg {
  id: string
  title: string
  description?: string
  startTime: number
  endTime: number
  category?: string
}

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

  const { data: epgData } = useQuery({
    queryKey: ['channel-detail-epg', item.id, epgChannelId],
    queryFn: async () => {
      const now = Math.floor(Date.now() / 1000)
      const data = await api.epg.guide({
        contentIds: [item.id],
        startTime: now - 6 * 3600,
        endTime: now + 12 * 3600,
      })
      return (data?.programmes?.[item.id] ?? []) as EpgProg[]
    },
    enabled: !!epgChannelId,
    staleTime: 2 * 60_000,
  })
  const programmes = epgData ?? []

  const initials = item.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

  const breadcrumbs: BreadcrumbItem[] = [
    ...(primarySource && sourceColor ? [{
      label: primarySource.name,
      color: sourceColor.accent,
      onClick: () => onNavigate({ sourceId: primarySourceId }),
    }] : []),
    { label: 'Channels', color: 'var(--accent-live)', onClick: () => onNavigate({ type: 'live' }) },
    ...(categoryName ? [{
      label: categoryName,
      color: 'var(--accent-live)',
      onClick: () => onNavigate({ type: 'live', category: categoryName }),
      bold: true,
    }] : []),
  ]

  return (
    <SlidePanel open={true} onClose={onClose} width={380} suppressClose={isPlaying}>
      <DetailShell
        typeBadge={{ label: 'CHANNEL', accent: 'var(--accent-live)' }}
        breadcrumbs={breadcrumbs}
        primarySource={primarySource}
        primarySourceColor={sourceColor}
        onClose={onClose}
      >
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

        {programmes.length > 0 && <ScheduleSection programmes={programmes} />}

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
      </DetailShell>
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

function ScheduleSection({ programmes }: { programmes: EpgProg[] }) {
  const nowSec = Math.floor(Date.now() / 1000)
  const sorted = [...programmes].sort((a, b) => a.startTime - b.startTime)
  const current = sorted.find((p) => p.startTime <= nowSec && p.endTime > nowSec) ?? null
  const past = sorted.filter((p) => p.endTime <= nowSec).slice(-3)
  const upcoming = sorted.filter((p) => p.startTime > nowSec).slice(0, 10)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p style={{
        fontSize: 10, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--text-3)',
        margin: 0, fontFamily: 'var(--font-ui)',
      }}>
        Schedule
      </p>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {past.map((p) => <ProgRow key={p.id} prog={p} state="past" />)}
        {current && <ProgRow key={current.id} prog={current} state="now" nowSec={nowSec} />}
        {upcoming.map((p) => <ProgRow key={p.id} prog={p} state="upcoming" />)}
      </div>
    </div>
  )
}

function ProgRow({ prog, state, nowSec }: { prog: EpgProg; state: 'past' | 'now' | 'upcoming'; nowSec?: number }) {
  const isNow = state === 'now'
  const isPast = state === 'past'
  const progress = isNow && nowSec
    ? Math.max(0, Math.min(100, ((nowSec - prog.startTime) / (prog.endTime - prog.startTime)) * 100))
    : 0

  return (
    <div style={{
      position: 'relative',
      padding: '6px 8px',
      borderRadius: 4,
      marginBottom: 2,
      background: isNow ? 'color-mix(in srgb, var(--accent-live) 12%, transparent)' : 'transparent',
      borderLeft: isNow ? `2px solid var(--accent-live)` : '2px solid transparent',
      opacity: isPast ? 0.5 : 1,
    }}>
      {isNow && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0,
          width: `${progress}%`, height: 2,
          background: 'var(--accent-live)',
          borderRadius: 1,
          opacity: 0.6,
        }} />
      )}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        marginBottom: prog.description ? 2 : 0,
      }}>
        <span style={{
          fontSize: 10,
          color: isNow ? 'var(--accent-live)' : 'var(--text-3)',
          fontFamily: 'var(--font-mono)',
          fontWeight: isNow ? 600 : 400,
          flexShrink: 0, minWidth: 44,
        }}>
          {fmtTime(prog.startTime)}
        </span>
        <span style={{
          fontSize: 12,
          fontWeight: isNow ? 600 : 500,
          color: isNow ? 'var(--text-0)' : 'var(--text-1)',
          fontFamily: 'var(--font-ui)',
          lineHeight: 1.3, wordBreak: 'break-word',
        }}>
          {prog.title}
        </span>
      </div>
      {isNow && prog.description && (
        <p style={{
          fontSize: 11,
          color: 'var(--text-2)',
          margin: '2px 0 0 52px',
          lineHeight: 1.4,
          fontFamily: 'var(--font-ui)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {prog.description}
        </p>
      )}
    </div>
  )
}
