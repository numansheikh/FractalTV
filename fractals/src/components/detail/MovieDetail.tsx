import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContentItem, BreadcrumbNav } from '@/lib/types'
import { api } from '@/lib/api'
import { useSourcesStore } from '@/stores/sources.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { MetadataBlock } from './MetadataBlock'
import { ActionButtons } from './ActionButtons'
import { AboutBlock } from './AboutBlock'
import { DetailShell, BreadcrumbItem } from './DetailShell'
import { DetailMiniPlayer } from '@/components/player/DetailMiniPlayer'

interface Props {
  item: ContentItem
  onPlay: (item: ContentItem) => void
  onClose: () => void
  onNavigate: (nav: BreadcrumbNav) => void
  isPlaying?: boolean
}

export function MovieDetail({ item, onPlay, onClose, onNavigate, isPlaying }: Props) {
  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)
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

  const { data: enrichedItem } = useQuery({
    queryKey: ['content', item.id],
    queryFn: () => api.content.get(item.id),
    staleTime: 5 * 60_000,
  })

  const c = (enrichedItem as ContentItem | null) ?? item
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

  const categoryName = (c as any).categoryName ?? (c as any).category_name

  const breadcrumbs: BreadcrumbItem[] = [
    ...(primarySource && sourceColor ? [{
      label: primarySource.name,
      color: sourceColor.accent,
      onClick: () => onNavigate({ sourceId: primarySourceId }),
    }] : []),
    { label: 'Films', color: 'var(--accent-film)', onClick: () => onNavigate({ type: 'movie' }) },
    ...(categoryName ? [{
      label: categoryName,
      color: 'var(--accent-film)',
      onClick: () => onNavigate({ type: 'movie', category: categoryName }),
      bold: true,
    }] : []),
  ]

  const expandIcon = (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )

  const footer = (
    <>
      <ActionButtons item={c} onPlay={onPlay} hidePrimary />
      <button
        onClick={() => onPlay(c)}
        style={{
          width: '100%', height: 36, borderRadius: 6,
          background: 'var(--accent-film)', color: '#fff',
          border: 'none', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'var(--font-ui)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          transition: 'opacity 0.12s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88' }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
      >
        <span>▶ Watch</span>
        {expandIcon}
      </button>
      <DetailMiniPlayer
        contentId={c.id}
        contentType="movie"
        autoplay={autoplay}
        promptSeen={promptSeen}
        onPromptSeen={() => setPromptSeen(true)}
      />
    </>
  )

  return (
    <SlidePanel open={true} onClose={onClose} width={380} suppressClose={isPlaying}>
      <DetailShell
        typeBadge={{ label: 'FILM', accent: 'var(--accent-film)' }}
        breadcrumbs={breadcrumbs}
        primarySource={primarySource}
        primarySourceColor={sourceColor}
        allSourceIds={allSourceIds}
        sourceColorMap={colorMap}
        onClose={onClose}
        footer={footer}
      >
        <MetadataBlock item={c} />
        <AboutBlock item={c} onClose={onClose} />
      </DetailShell>
    </SlidePanel>
  )
}
