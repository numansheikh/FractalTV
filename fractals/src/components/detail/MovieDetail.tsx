import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ContentItem, BreadcrumbNav } from '@/lib/types'
import { api } from '@/lib/api'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { MetadataBlock } from './MetadataBlock'
import { ActionButtons } from './ActionButtons'
import { AboutBlock, parseCast, CastPanel } from './AboutBlock'
import { DetailShell, BreadcrumbItem } from './DetailShell'
import { EnrichmentPicker } from './EnrichmentPicker'
import { CopyUrlContext } from '@/components/shared/CopyUrlMenu'

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

  // Auto-enrich on first open; augment with TMDB if already enriched but missing tmdb_id
  useEffect(() => {
    if (enrichTriggered.current) return
    if (!enrichmentData) return
    if (enrichmentData.disabled) return
    const hasCandidates = enrichmentData.candidates.some((c: any) => c.confidence > 0)
    if (!hasCandidates) {
      enrichTriggered.current = true
      setEnrichingSingle(true)
      api.vodEnrich.enrichSingle(item.id).finally(() => {
        setEnrichingSingle(false)
        refetchEnrichment()
      })
      return
    }
    // Already enriched — augment with TMDB if tmdb_id missing
    const best = enrichmentData.candidates[0]
    if (best && best.raw_json !== '{}') {
      try {
        if (!JSON.parse(best.raw_json).tmdb_id) {
          enrichTriggered.current = true
          api.vodEnrich.enrichSingle(item.id).finally(refetchEnrichment)
        }
      } catch {}
    }
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
    backdropUrl: activeEnrichment?.backdrop_url ?? c.backdropUrl ?? c.backdrop_url,
    tmdbRating: activeEnrichment?.tmdb_vote_average ?? null,
    tmdbVoteCount: activeEnrichment?.tmdb_vote_count ?? null,
    runtime: (c as any).runtime ?? (c as any).md_runtime ?? activeEnrichment?.runtime_min ?? vodInfo?.runtime ?? undefined,
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

  const userData = useUserStore((s) => s.data[item.id])
  const lastPosition = userData?.last_position ?? 0
  const watchLabel = lastPosition > 0
    ? `▶ Resume from ${(() => { const h = Math.floor(lastPosition / 3600); const m = Math.floor((lastPosition % 3600) / 60); const s = Math.floor(lastPosition % 60); return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}` })()}`
    : '▶ Watch'

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

  const footer = (
    <>
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
        <span>{watchLabel}</span>
      </button>
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
        <div style={{ display: 'flex', gap: 10, alignSelf: 'center' }}>
          <button
            onClick={() => setShowPicker(true)}
            style={{
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
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>·</span>
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
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-ui)',
              padding: '2px 0', transition: 'color 0.12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
          >
            Re-enrich
          </button>
        </div>
      )}
    </>
  )

  return (
    <SlidePanel open={true} onClose={onClose} width={380} suppressClose={isPlaying}>
      <CopyUrlContext item={c}>
        <DetailShell
          typeBadge={{ label: 'FILM', accent: 'var(--accent-film)' }}
          breadcrumbs={breadcrumbs}
          actionsRow={<ActionButtons item={c} onPlay={onPlay} hidePrimary />}
          primarySource={primarySource}
          primarySourceColor={sourceColor}
          allSourceIds={allSourceIds}
          sourceColorMap={colorMap}
          onClose={onClose}
          castPanel={<CastPanel cast={parseCast(displayItem.cast)} loading={enrichingSingle} />}
          footer={footer}
        >
          <MetadataBlock item={displayItem} />
          <AboutBlock item={displayItem} />
        </DetailShell>
      </CopyUrlContext>
      {showPicker && (
        <EnrichmentPicker
          contentId={c.id}
          contentType="movie"
          candidates={enrichmentData?.candidates ?? []}
          selectedId={enrichmentData?.selected_id ?? null}
          onPicked={() => { setShowPicker(false); queryClient.invalidateQueries({ queryKey: ['vodEnrich', c.id] }) }}
          onDisabled={() => { setShowPicker(false); queryClient.invalidateQueries({ queryKey: ['vodEnrich', c.id] }) }}
          onReset={() => { setShowPicker(false); queryClient.invalidateQueries({ queryKey: ['vodEnrich', c.id] }) }}
          onRerun={() => {
            enrichTriggered.current = false
            setEnrichingSingle(true)
            api.vodEnrich.enrichSingle(c.id, true).finally(() => {
              setEnrichingSingle(false)
              refetchEnrichment()
            })
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </SlidePanel>
  )
}
