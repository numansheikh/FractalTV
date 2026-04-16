import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ContentItem, BreadcrumbNav } from '@/lib/types'
import { api } from '@/lib/api'
import { useSourcesStore } from '@/stores/sources.store'
import { useAppStore } from '@/stores/app.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { MetadataBlock } from './MetadataBlock'
import { ActionButtons } from './ActionButtons'
import { AboutBlock } from './AboutBlock'
import { DetailShell, BreadcrumbItem } from './DetailShell'
import { EnrichmentPicker } from './EnrichmentPicker'

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
  const queryClient = useQueryClient()
  const [showPicker, setShowPicker] = useState(false)

  // Callback ref fires at DOM commit time — guaranteed non-null, no effect timing issues.
  // Handles anchor registration and cleanup independently of the autoplay timer.
  const playerZoneCallback = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      const s = useAppStore.getState()
      s.setEmbeddedAnchor(null)
      if (s.playerMode === 'embedded') {
        s.setPlayerMode('hidden')
        s.setPlayingContent(null)
      }
      return
    }
    useAppStore.getState().setEmbeddedAnchor(el)
  }, [])

  // Autoplay timer — starts 2s after the panel opens.
  // Separated from anchor registration so a null-ref timing issue can't block both.
  useEffect(() => {
    const s0 = useAppStore.getState()
    if (s0.playingContent?.id === item.id && s0.playerMode !== 'hidden') {
      s0.setPlayerMode('embedded')
      return
    }
    const capturedItem = item
    const timer = setTimeout(() => {
      const s = useAppStore.getState()
      s.setPlayingContent(capturedItem)
      s.setPlayerMode('embedded')
    }, 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const { data: enrichedItem } = useQuery({
    queryKey: ['content', item.id],
    queryFn: () => api.content.get(item.id),
    staleTime: 5 * 60_000,
  })

  const { data: vodInfo } = useQuery({
    queryKey: ['vod-info', item.id],
    queryFn: () => api.content.getVodInfo(item.id),
    staleTime: Infinity,
    enabled: item.type === 'movie',
  })

  const [enrichingSingle, setEnrichingSingle] = useState(false)
  const enrichTriggered = useRef(false)

  // Reset enrichTriggered when the item changes so a new item can auto-enrich.
  useEffect(() => { enrichTriggered.current = false }, [item.id])

  const { data: enrichmentData, refetch: refetchEnrichment } = useQuery({
    queryKey: ['vodEnrich', item.id],
    queryFn: () => api.vodEnrich.getForContent(item.id),
    staleTime: 60_000,
  })

  // Auto-enrich on first open if no data exists
  useEffect(() => {
    if (enrichTriggered.current) return
    if (!enrichmentData) return
    if (enrichmentData.disabled) return
    if (enrichmentData.candidates.some((c: any) => c.confidence > 0)) return
    enrichTriggered.current = true
    setEnrichingSingle(true)
    api.vodEnrich.enrichSingle(item.id).finally(() => {
      setEnrichingSingle(false)
      refetchEnrichment()
    })
  }, [enrichmentData, item.id, refetchEnrichment])

  const c = (enrichedItem as ContentItem | null) ?? item

  // Derive active enrichment candidate
  const activeEnrichment = (() => {
    if (!enrichmentData || enrichmentData.disabled) return null
    const candidates = enrichmentData.candidates ?? []
    if (!candidates.length) return null
    if (enrichmentData.selected_id != null) {
      const pinned = candidates.find((c: any) => c.id === enrichmentData.selected_id)
      if (pinned && pinned.confidence > 0) return JSON.parse(pinned.raw_json)
    }
    const best = candidates[0]
    if (best && best.confidence > 0 && best.raw_json !== '{}') return JSON.parse(best.raw_json)
    return null
  })()

  // Merge enrichment over stream data (per-field fallback)
  const displayItem: ContentItem = {
    ...c,
    plot: activeEnrichment?.overview ?? c.plot,
    cast: activeEnrichment?.cast?.length
      ? JSON.stringify(activeEnrichment.cast)
      : c.cast,
    director: activeEnrichment?.directors?.join(', ') ?? c.director,
    genres: activeEnrichment?.genres?.join(', ') ?? c.genres,
    posterUrl: activeEnrichment?.poster_url ?? c.posterUrl ?? c.poster_url,
    runtime: (c as any).runtime ?? (c as any).md_runtime ?? vodInfo?.runtime ?? undefined,
  }
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
  const hasCandidates = (enrichmentData?.candidates ?? []).some((r: any) => r.confidence > 0 && r.raw_json !== '{}')

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
        onClick={() => onPlay(displayItem)}
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
      {/* Embedded player placeholder — PlayerOverlay overlays this div in 'embedded' mode */}
      <div
        ref={playerZoneCallback}
        style={{ width: '100%', aspectRatio: '16/9', background: '#0a0a0e', borderRadius: 8, flexShrink: 0 }}
      />
      {enrichingSingle && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', padding: '2px 0' }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-ui)' }}>Looking up film data…</span>
        </div>
      )}
      {!enrichingSingle && !hasCandidates && (
        <button
          onClick={() => {
            enrichTriggered.current = false
            setEnrichingSingle(true)
            api.vodEnrich.enrichSingle(item.id, true).finally(() => {
              setEnrichingSingle(false)
              refetchEnrichment()
            })
          }}
          style={{
            alignSelf: 'center',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-ui)',
            padding: '2px 0', transition: 'color 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-1)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
        >
          Retry lookup
        </button>
      )}
      {hasCandidates && (
        <button
          onClick={() => setShowPicker(true)}
          style={{
            alignSelf: 'center',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-ui)',
            padding: '2px 0',
            transition: 'color 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-1)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
        >
          {enrichmentData?.disabled ? 'Re-enable enrichment' : 'Not this film?'}
        </button>
      )}
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
        <MetadataBlock item={displayItem} />
        <AboutBlock item={displayItem} onClose={onClose} />
      </DetailShell>
      {showPicker && (
        <EnrichmentPicker
          contentId={c.id}
          contentType="movie"
          candidates={enrichmentData?.candidates ?? []}
          onPicked={() => { setShowPicker(false); queryClient.invalidateQueries({ queryKey: ['vodEnrich', c.id] }) }}
          onDisabled={() => { setShowPicker(false); queryClient.invalidateQueries({ queryKey: ['vodEnrich', c.id] }) }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </SlidePanel>
  )
}
