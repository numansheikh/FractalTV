import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ContentItem, BreadcrumbNav } from '@/lib/types'
import { api } from '@/lib/api'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { useAppStore } from '@/stores/app.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { EpisodeRow } from '@/components/cards/EpisodeRow'
import { MetadataBlock } from './MetadataBlock'
import { ActionButtons } from './ActionButtons'
import { AboutBlock, parseCast, CastPanel } from './AboutBlock'
import { DetailShell, BreadcrumbItem } from './DetailShell'
import { EnrichmentPicker } from './EnrichmentPicker'

interface Props {
  item: ContentItem
  onPlay: (item: ContentItem) => void
  onClose: () => void
  onNavigate: (nav: BreadcrumbNav) => void
  isPlaying?: boolean
}

// Session-level cache so activeSeason survives panel close/reopen within the same session.
const activeSeasonCache = new Map<string, string>()

export function SeriesDetail({ item, onPlay, onClose, onNavigate, isPlaying }: Props) {
  const [activeSeason, _setActiveSeason] = useState<string | null>(() => activeSeasonCache.get(item.id) ?? null)
  const setActiveSeason = (s: string | null) => {
    if (s) activeSeasonCache.set(item.id, s)
    _setActiveSeason(s)
  }
  const [showPicker, setShowPicker] = useState(false)

  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)
  const userStore = useUserStore()
  const queryClient = useQueryClient()
  const playingContent = useAppStore((s) => s.playingContent)
  const playerMode = useAppStore((s) => s.playerMode)

  const { data: enrichedItem } = useQuery({
    queryKey: ['content', item.id],
    queryFn: () => api.content.get(item.id),
    staleTime: 5 * 60_000,
  })

  const [enrichingSingle, setEnrichingSingle] = useState(false)
  const enrichTriggered = useRef(false)

  // Reset enrichTriggered when the item changes so a new item can auto-enrich.
  useEffect(() => { enrichTriggered.current = false }, [item.id])

  // Reset season selection when series changes (component is reused, state doesn't reinitialize)
  useEffect(() => {
    _setActiveSeason(activeSeasonCache.get(item.id) ?? null)
    setHasAutoSelectedSeason(false)
    useAppStore.getState().setEpisodeSurfContext([], -1)
  }, [item.id])

  const { data: enrichmentData, refetch: refetchEnrichment } = useQuery({
    queryKey: ['vodEnrich', item.id],
    queryFn: () => api.vodEnrich.getForContent(item.id),
    staleTime: 60_000,
  })

  // Auto-enrich on first open; for already-enriched series also trigger TVmaze augmentation.
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
    // Already enriched — fire enrichSingle if TVmaze or TMDB augment not yet done
    const best = enrichmentData.candidates[0]
    if (best && best.raw_json !== '{}') {
      try {
        const parsed = JSON.parse(best.raw_json)
        if (!parsed.tvmaze_id || !parsed.tmdb_id) {
          enrichTriggered.current = true
          api.vodEnrich.enrichSingle(item.id).finally(refetchEnrichment)
        }
      } catch {}
    }
  }, [enrichmentData, item.id, refetchEnrichment])

  const { data: seriesInfo, isFetching: seriesFetching, isError: seriesError, refetch: refetchSeries } = useQuery({
    queryKey: ['series-info', item.id],
    queryFn: () => api.series.getInfo(item.id),
    staleTime: 5 * 60_000,
  })

  const { data: continueData = [] } = useQuery<ContentItem[]>({
    queryKey: ['series-continue', item.id],
    queryFn: async () => {
      const all = await api.user.continueWatching({ type: 'series' }) as ContentItem[]
      return all.filter((ci) => ci.id === item.id)
    },
    staleTime: 30_000,
  })
  const resumeEntry = continueData[0] ?? null

  const c = (enrichedItem as ContentItem | null) ?? item

  // Derive active enrichment candidate
  const activeEnrichment = (() => {
    if (!enrichmentData || enrichmentData.disabled) return null
    const candidates = enrichmentData.candidates ?? []
    if (!candidates.length) return null
    if (enrichmentData.selected_id != null) {
      const pinned = candidates.find((r: any) => r.id === enrichmentData.selected_id)
      if (pinned && pinned.confidence > 0) return JSON.parse(pinned.raw_json)
    }
    const best = candidates[0]
    if (best && best.confidence > 0 && best.raw_json !== '{}') return JSON.parse(best.raw_json)
    return null
  })()

  // Merge enrichment over stream data per-field
  const displayItem: ContentItem = {
    ...c,
    plot: activeEnrichment?.overview ?? c.plot,
    cast: activeEnrichment?.cast?.length ? JSON.stringify(activeEnrichment.cast) : c.cast,
    director: activeEnrichment?.directors?.join(', ') ?? c.director,
    genres: activeEnrichment?.genres?.join(', ') ?? c.genres,
    posterUrl: activeEnrichment?.poster_url ?? c.posterUrl ?? c.poster_url,
    backdropUrl: activeEnrichment?.backdrop_url ?? c.backdropUrl ?? c.backdrop_url,
    // TVmaze fields
    tvmazeStatus: activeEnrichment?.status ?? null,
    tvmazeNetwork: activeEnrichment?.network ?? null,
    tvmazeRating: activeEnrichment?.rating ?? null,
    // TMDB fields
    tmdbRating: activeEnrichment?.tmdb_vote_average ?? null,
    tmdbVoteCount: activeEnrichment?.tmdb_vote_count ?? null,
    tmdbCreator: activeEnrichment?.creator ?? null,
    seasonCount: activeEnrichment?.season_count ?? null,
    episodeCount: activeEnrichment?.episode_count ?? null,
  }

  const hasCandidates = (enrichmentData?.candidates ?? []).some((r: any) => r.confidence > 0 && r.raw_json !== '{}')

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

  const seasons = (seriesInfo as any)?.seasons ?? {}
  const seasonKeys: string[] = Object.keys(seasons).sort((a, b) => Number(a) - Number(b))
  const currentSeason = activeSeason ?? seasonKeys[0] ?? null
  const episodes: any[] = currentSeason ? (seasons[currentSeason] ?? []) : []

  useEffect(() => {
    if (!primarySourceId || episodes.length === 0) return
    const episodeIds = episodes.map((ep) => `${primarySourceId}:episode:${ep.id}`)
    userStore.loadBulk(episodeIds)
  }, [primarySourceId, episodes, userStore])

  const serverUrl: string = (seriesInfo as any)?.serverUrl ?? ''
  const username: string = (seriesInfo as any)?.username ?? ''
  const password: string = (seriesInfo as any)?.password ?? ''

  // Xtream episodes use _streamId to build URL client-side; M3U episodes
  // have stream_url in DB and resolve via content:get-stream-url instead.
  const isXtream = !!serverUrl

  useEffect(() => {
    if (!primarySourceId || seasonKeys.length === 0) return
    const epItems: ContentItem[] = []
    for (const sk of seasonKeys) {
      const seasonEps: any[] = seasons[sk] ?? []
      for (const ep of seasonEps) {
        epItems.push({
          ...item,
          id: `${primarySourceId}:episode:${ep.id}`,
          title: `S${String(sk).padStart(2,'0')}E${String(ep.episode_num).padStart(2,'0')} · ${ep.title ?? ''}`,
          ...(isXtream ? {
            _streamId: String(ep.id),
            _serverUrl: serverUrl,
            _username: username,
            _password: password,
            _extension: ep.container_extension,
          } : {}),
          _parent: { id: item.id, title: item.title, type: 'series' },
        } as ContentItem)
      }
    }
    if (epItems.length === 0) return
    const playingId = useAppStore.getState().playingContent?.id
    const idx = playingId ? epItems.findIndex((e) => e.id === playingId) : -1
    useAppStore.getState().setEpisodeSurfContext(epItems, idx >= 0 ? idx : 0)
  }, [seriesInfo, primarySourceId, serverUrl, username, password, item])

  const categoryName = (c as any).categoryName ?? (c as any).category_name

  const firstEpisode = episodes[0] ?? null
  const resumeEpisodeInList = resumeEntry?.resume_episode_id
    ? episodes.find((ep) => {
        const rawId = String(ep.id)
        // resume_episode_id is full content ID ({sourceId}:episode:{streamId}), ep.id is raw stream ID
        return `${primarySourceId}:episode:${rawId}` === resumeEntry.resume_episode_id
      })
    : null
  const resumeSeason = resumeEntry?.resume_season_number != null
    ? String(resumeEntry.resume_season_number)
    : null

  const [hasAutoSelectedSeason, setHasAutoSelectedSeason] = useState(false)
  useEffect(() => {
    if (hasAutoSelectedSeason) return
    if (!resumeSeason || !seasonKeys.includes(resumeSeason)) return
    if (resumeSeason === activeSeason) return
    setHasAutoSelectedSeason(true)
    setActiveSeason(resumeSeason)
  }, [hasAutoSelectedSeason, resumeSeason, seasonKeys, activeSeason])

  const episodeForPlay = resumeEpisodeInList ?? firstEpisode
  const firstEpItem: ContentItem | undefined = episodeForPlay
    ? {
        ...item,
        id: `${primarySourceId}:episode:${episodeForPlay.id}`,
        title: `S${String(currentSeason ?? 1).padStart(2,'0')}E${String(episodeForPlay.episode_num).padStart(2,'0')} · ${episodeForPlay.title ?? ''}`,
        ...(isXtream ? {
          _streamId: String(episodeForPlay.id),
          _serverUrl: serverUrl,
          _username: username,
          _password: password,
          _extension: episodeForPlay.container_extension,
        } : {}),
        _parent: { id: item.id, title: item.title, type: 'series' },
      }
    : undefined

  const playButtonLabel = resumeEntry && resumeEntry.resume_season_number != null && resumeEntry.resume_episode_number != null
    ? `▶ Resume S${resumeEntry.resume_season_number}·E${resumeEntry.resume_episode_number}`
    : firstEpisode ? '▶ Play from S1·E1' : '▶ Play'

  const playingEpLabel = playerMode !== 'hidden' && playingContent?._parent?.id === item.id
    ? playingContent!.title.split(' · ')[0]
    : null
  const topButtonLabel = playingEpLabel ? `▶ ${playingEpLabel}` : playButtonLabel

  const breadcrumbs: BreadcrumbItem[] = [
    ...(primarySource && sourceColor ? [{
      label: primarySource.name,
      color: sourceColor.accent,
      onClick: () => onNavigate({ sourceId: primarySourceId }),
    }] : []),
    { label: 'Series', color: 'var(--accent-series)', onClick: () => onNavigate({ type: 'series' }) },
    ...(categoryName ? [{
      label: categoryName,
      color: 'var(--accent-series)',
      onClick: () => onNavigate({ type: 'series', category: categoryName }),
      bold: true,
    }] : []),
  ]

  const panelWidth = Math.min(700, window.innerWidth * 0.92)

  return (
    <SlidePanel open={true} onClose={onClose} width={panelWidth} suppressClose={isPlaying}>
      <div style={{ display: 'flex', flexDirection: 'row', height: '100%', background: 'var(--bg-2)' }}>

        {/* ── Left column: Season selector + episode list ── */}
        <div style={{
          width: 320,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border-subtle)',
          overflow: 'hidden',
          background: 'var(--bg-1)',
        }}>
          <div style={{
            height: 48,
            padding: '0 8px',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            overflowX: 'auto',
            flexShrink: 0,
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            {seriesFetching && !seasonKeys.length && (
              <div style={{
                width: 13, height: 13,
                borderRadius: '50%',
                border: '2px solid rgba(139,92,246,0.2)',
                borderTopColor: 'var(--accent-interactive)',
                animation: 'spin 0.8s linear infinite',
                flexShrink: 0,
              }} />
            )}
            {seasonKeys.map((s) => {
              const isActive = currentSeason === s
              const label = s === '0' ? 'S' : s
              return (
                <button
                  key={s}
                  onClick={() => setActiveSeason(s)}
                  title={s === '0' ? 'Specials' : `Season ${s}`}
                  style={{
                    minWidth: 34, height: 34, padding: '0 6px',
                    borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: isActive ? 700 : 500,
                    background: isActive ? 'var(--accent-interactive)' : 'var(--bg-3)',
                    color: isActive ? '#fff' : 'var(--text-1)',
                    border: `2px solid ${isActive ? 'var(--accent-interactive)' : 'transparent'}`,
                    cursor: 'pointer', flexShrink: 0,
                    transition: 'all 0.15s', fontFamily: 'var(--font-ui)',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.borderColor = 'var(--accent-interactive)' }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.borderColor = 'transparent' }}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px 20px' }}>
            {seriesFetching && episodes.length === 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '16px 12px',
                color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-ui)',
              }}>
                <div style={{
                  width: 12, height: 12, borderRadius: '50%',
                  border: '2px solid rgba(139,92,246,0.2)',
                  borderTopColor: 'var(--accent-interactive)',
                  animation: 'spin 0.8s linear infinite',
                  flexShrink: 0,
                }} />
                Loading episodes…
              </div>
            )}

            {!seriesFetching && seriesError && (
              <div style={{
                padding: '16px 12px',
                display: 'flex', flexDirection: 'column', gap: 8,
                color: 'var(--accent-danger)', fontSize: 12, fontFamily: 'var(--font-ui)',
              }}>
                <span>Couldn't load episodes — network error.</span>
                <button
                  onClick={() => refetchSeries()}
                  style={{
                    alignSelf: 'flex-start',
                    padding: '4px 10px', borderRadius: 5,
                    background: 'color-mix(in srgb, var(--accent-interactive) 16%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent-interactive) 36%, transparent)',
                    color: 'var(--accent-interactive)',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            )}

            {!seriesFetching && !seriesError && seasonKeys.length === 0 && (
              <p style={{ padding: '20px 12px', fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-ui)', margin: 0 }}>
                No episodes found.
              </p>
            )}

            {episodes.map((ep) => {
              const epUserData = userStore.data[`${primarySourceId}:episode:${ep.id}`]
              const isCompleted = epUserData?.completed === 1
              const progress = (() => {
                if (!epUserData?.last_position || isCompleted) return 0
                const durationSec = ep.duration
                  ? (() => {
                      const raw = ep.duration
                      if (typeof raw === 'number') return raw
                      const str = String(raw)
                      if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str)
                      const parts = str.split(':').map(Number)
                      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
                      if (parts.length === 2) return parts[0] * 60 + parts[1]
                      return 0
                    })()
                  : 0
                return durationSec > 0
                  ? Math.min(100, (epUserData.last_position / durationSec) * 100)
                  : 0
              })()

              const epAsEpisodeRowFmt = {
                id: String(ep.id),
                num: ep.episode_num ?? ep.num ?? 0,
                title: ep.title ?? `Episode ${ep.episode_num}`,
                plot: ep.plot,
                duration: ep.duration,
                poster: ep.poster,
              }

              const epCopyItem = {
                id: `${primarySourceId}:episode:${ep.id}`,
                ...(isXtream ? {
                  _streamId: String(ep.id),
                  _serverUrl: serverUrl,
                  _username: username,
                  _password: password,
                  _extension: ep.container_extension,
                } : {}),
              }
              return (
                <EpisodeRow
                  key={ep.id}
                  episode={epAsEpisodeRowFmt}
                  seriesId={item.id}
                  copyItem={epCopyItem}
                  onPlay={() => {
                    const epItem: ContentItem = {
                      ...item,
                      id: `${primarySourceId}:episode:${ep.id}`,
                      title: `S${String(currentSeason).padStart(2,'0')}E${String(ep.episode_num).padStart(2,'0')} · ${ep.title ?? ''}`,
                      ...(isXtream ? {
                        _streamId: String(ep.id),
                        _serverUrl: serverUrl,
                        _username: username,
                        _password: password,
                        _extension: ep.container_extension,
                      } : {}),
                      _parent: { id: item.id, title: item.title, type: 'series' },
                    }
                    onPlay(epItem)
                  }}
                  isPlaying={(() => {
                    const epId = `${primarySourceId}:episode:${ep.id}`
                    const activeId = playingContent?._parent?.id === item.id
                      ? playingContent!.id
                      : firstEpItem?.id
                    return epId === activeId
                  })()}
                  isCompleted={isCompleted}
                  progress={progress}
                />
              )
            })}
          </div>
        </div>

        {/* ── Right column: shared DetailShell ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <DetailShell
            typeBadge={{ label: 'SERIES', accent: 'var(--accent-series)' }}
            breadcrumbs={breadcrumbs}
            actionsRow={<ActionButtons item={c} onPlay={onPlay} episodeToPlay={firstEpItem} hidePrimary />}
            primarySource={primarySource}
            primarySourceColor={sourceColor}
            allSourceIds={allSourceIds}
            sourceColorMap={colorMap}
            onClose={onClose}
            castPanel={<CastPanel cast={parseCast(displayItem.cast)} loading={enrichingSingle} />}
            footer={
              <>
                <button
                  onClick={() => onPlay(firstEpItem ?? c)}
                  style={{
                    width: '100%', height: 36, borderRadius: 6,
                    background: 'var(--accent-series)', color: '#fff',
                    border: 'none', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'var(--font-ui)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    transition: 'opacity 0.12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88' }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                >
                  <span>{topButtonLabel}</span>
                </button>
                {enrichingSingle && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', padding: '2px 0' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-ui)' }}>Looking up series data…</span>
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
                      {enrichmentData?.disabled ? 'Re-enable enrichment' : 'Not this series?'}
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
            }
          >
            <MetadataBlock item={displayItem} isSeries />
            <AboutBlock item={displayItem} />
          </DetailShell>
        </div>
      </div>
      {showPicker && (
        <EnrichmentPicker
          contentId={c.id}
          contentType="series"
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
