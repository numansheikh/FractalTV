import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContentItem, BreadcrumbNav } from '@/lib/types'
import { api } from '@/lib/api'
import { useSourcesStore } from '@/stores/sources.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { ActionButtons } from './ActionButtons'
import { DetailShell, BreadcrumbItem } from './DetailShell'
import { CopyUrlContext } from '@/components/shared/CopyUrlMenu'
import { ScheduleSection, EpgProg } from './channel/ScheduleSection'
import { IdentityCard } from './channel/IdentityCard'
import { ProviderCard } from './channel/ProviderCard'
import { SiblingsCard } from './channel/SiblingsCard'
import { DetailMiniPlayer } from '@/components/player/DetailMiniPlayer'

interface Props {
  item: ContentItem
  onPlay: (item: ContentItem) => void
  onClose: () => void
  onNavigate: (nav: BreadcrumbNav) => void
  onItemSelect?: (item: ContentItem) => void
  isPlaying?: boolean
}

export function ChannelDetail({ item, onPlay, onClose, onNavigate, isPlaying }: Props) {
  const [activeItem, setActiveItem] = useState<ContentItem>(item)
  const [history, setHistory] = useState<ContentItem[]>([])
  const [autoplay, setAutoplay] = useState(true)
  const [promptSeen, setPromptSeen] = useState(false)

  useEffect(() => {
    Promise.all([
      api.settings.get('autoplay_detail'),
      api.settings.get('autoplay_prompt_shown'),
    ]).then(([ad, aps]) => {
      setAutoplay(ad !== '0')
      setPromptSeen(aps === '1')
    })
  }, [])

  // Reset stack when the outer item changes (user picked a different channel)
  useEffect(() => {
    setActiveItem(item)
    setHistory([])
  }, [item.id])

  const isSiblingView = history.length > 0

  const handleSiblingSelect = (sibling: ContentItem) => {
    setHistory((h) => [...h, activeItem])
    setActiveItem(sibling)
  }

  const handleBack = () => {
    setHistory((h) => {
      const prev = h[h.length - 1]
      setActiveItem(prev)
      return h.slice(0, -1)
    })
  }

  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)

  const { data: enrichedItem } = useQuery({
    queryKey: ['content', activeItem.id],
    queryFn: () => api.content.get(activeItem.id),
    staleTime: 5 * 60_000,
  })

  const c = (enrichedItem as ContentItem | null) ?? activeItem
  const primarySourceId = c.primarySourceId ?? c.primary_source_id ?? activeItem.primarySourceId ?? activeItem.primary_source_id ?? (activeItem as any).source_ids ?? activeItem.id?.split(':')[0]
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const primarySource = primarySourceId ? sources.find((s) => s.id === primarySourceId) : undefined

  const tvgId = (c as any).tvg_id ?? (c as any).tvgId
  const epgChannelId = (c as any).epg_channel_id ?? (c as any).epgChannelId
  const catchupSupported = ((c as any).catchup_supported ?? (c as any).catchupSupported) === 1
  const catchupDays = (c as any).catchup_days ?? (c as any).catchupDays
  const categoryName = (c as any).categoryName ?? (c as any).category_name
  const isMatched = !!c.io_name

  const { data: epgData } = useQuery({
    queryKey: ['channel-detail-epg', activeItem.id, epgChannelId],
    queryFn: async () => {
      const now = Math.floor(Date.now() / 1000)
      const data = await api.epg.guide({
        contentIds: [activeItem.id],
        startTime: now - 6 * 3600,
        endTime: now + 12 * 3600,
      })
      return (data?.programmes?.[activeItem.id] ?? []) as EpgProg[]
    },
    enabled: !!epgChannelId,
    staleTime: 2 * 60_000,
  })
  const programmes = epgData ?? []

  const { data: siblings = [] } = useQuery({
    queryKey: ['channel-siblings', c.id],
    queryFn: () => api.channels.siblings(c.id),
    enabled: isMatched,
    staleTime: 10 * 60_000,
  })

  const sourceNames: Record<string, string> = {}
  for (const s of sources) sourceNames[s.id] = s.name

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

  const hasEpg = programmes.length > 0
  const panelWidth = hasEpg ? Math.min(700, window.innerWidth * 0.92) : 380

  const expandIcon = (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )

  const channelFooter = (
    <>
      <button
        onClick={() => onPlay(c)}
        style={{
          width: '100%', height: 36, borderRadius: 6,
          background: 'var(--accent-live)', color: '#fff',
          border: 'none', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'var(--font-ui)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          transition: 'opacity 0.12s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88' }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
      >
        <span>▶ Watch live</span>
        {expandIcon}
      </button>
      <DetailMiniPlayer
        contentId={c.id}
        contentType="live"
        autoplay={autoplay}
        promptSeen={promptSeen}
        onPromptSeen={() => setPromptSeen(true)}
      />
    </>
  )

  const rightBody = (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden',
      background: isSiblingView ? 'var(--bg-2)' : undefined,
    }}>
      {isSiblingView && (
        <div style={{
          height: 36, flexShrink: 0,
          background: 'color-mix(in srgb, var(--accent-interactive) 22%, var(--bg-1))',
          borderBottom: '2px solid var(--accent-interactive)',
          display: 'flex', alignItems: 'center',
          padding: '0 12px',
        }}>
          <button
            onClick={handleBack}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              padding: 0,
              fontSize: 12, fontWeight: 600,
              color: 'var(--accent-interactive)',
              fontFamily: 'var(--font-ui)',
            }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>←</span>
            <span style={{
              maxWidth: 260,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {history[history.length - 1]?.title}
            </span>
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <CopyUrlContext item={c}>
          <DetailShell
            typeBadge={{ label: 'CHANNEL', accent: 'var(--accent-live)' }}
            breadcrumbs={breadcrumbs}
            actionsRow={<ActionButtons item={c} onPlay={onPlay} hidePrimary />}
            primarySource={primarySource}
            primarySourceColor={sourceColor}
            onClose={onClose}
            footer={channelFooter}
          >
            <IdentityCard
              item={c}
              sourceAccent={sourceColor?.accent}
              catchupSupported={catchupSupported}
              catchupDays={catchupDays}
            />

            {(tvgId || epgChannelId) && (
              <ProviderCard tvgId={tvgId} epgChannelId={epgChannelId} />
            )}

            {isMatched && siblings.length > 0 && (
              <SiblingsCard
                siblings={siblings}
                colorMap={colorMap}
                sourceNames={sourceNames}
                onSelect={handleSiblingSelect}
              />
            )}
          </DetailShell>
        </CopyUrlContext>
      </div>
    </div>
  )

  if (!hasEpg) {
    return (
      <SlidePanel open={true} onClose={onClose} width={380} suppressClose={isPlaying}>
        {rightBody}
      </SlidePanel>
    )
  }

  return (
    <SlidePanel open={true} onClose={onClose} width={panelWidth} suppressClose={isPlaying}>
      <div style={{ display: 'flex', flexDirection: 'row', height: '100%', background: isSiblingView ? 'var(--bg-2)' : 'var(--bg-1)' }}>
        {/* Left: EPG schedule — secondary panel, slightly recessed */}
        <div style={{
          width: 320,
          flexShrink: 0,
          borderRight: '1px solid var(--border-default)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg-0)',
        }}>
          <div style={{
            padding: '10px 12px 8px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
            background: 'color-mix(in srgb, var(--bg-0) 60%, transparent)',
          }}>
            <p style={{
              fontSize: 9, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--text-3)',
              margin: 0, fontFamily: 'var(--font-ui)',
              opacity: 0.7,
            }}>
              Schedule
            </p>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
            <ScheduleSection programmes={programmes} hideHeader />
          </div>
        </div>

        {/* Right: detail */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {rightBody}
        </div>
      </div>
    </SlidePanel>
  )
}
