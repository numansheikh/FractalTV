import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContentItem, BreadcrumbNav } from '@/lib/types'
import { api } from '@/lib/api'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { useSearchStore } from '@/stores/search.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { EpisodeRow } from '@/components/cards/EpisodeRow'
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

export function SeriesDetail({ item, onPlay, onClose, onNavigate, isPlaying }: Props) {
  const [activeSeason, setActiveSeason] = useState<string | null>(null)
  const [plotExpanded, setPlotExpanded] = useState(false)

  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)
  const userStore = useUserStore()
  const setQuery = useSearchStore((s) => s.setQuery)

  const { data: enrichedItem, refetch } = useQuery({
    queryKey: ['content', item.id],
    queryFn: () => api.content.get(item.id),
    staleTime: 5 * 60_000,
  })

  const { data: seriesInfo, isFetching: seriesFetching } = useQuery({
    queryKey: ['series-info', item.id],
    queryFn: () => api.series.getInfo(item.id),
    staleTime: 5 * 60_000,
  })

  // Find in-progress episode for this series (resume support)
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

  const seasons = (seriesInfo as any)?.seasons ?? {}
  const seasonKeys: string[] = Object.keys(seasons).sort((a, b) => Number(a) - Number(b))
  const currentSeason = activeSeason ?? seasonKeys[0] ?? null
  const episodes: any[] = currentSeason ? (seasons[currentSeason] ?? []) : []

  // Load user data for visible episodes so progress bars render correctly
  useEffect(() => {
    if (!primarySourceId || episodes.length === 0) return
    const episodeIds = episodes.map((ep) => `${primarySourceId}:episode:${ep.id}`)
    userStore.loadBulk(episodeIds)
  }, [primarySourceId, episodes, userStore])

  const serverUrl: string = (seriesInfo as any)?.serverUrl ?? ''
  const username: string = (seriesInfo as any)?.username ?? ''
  const password: string = (seriesInfo as any)?.password ?? ''

  const plot = c.plot ?? ''
  const cast: string[] = (() => {
    if (!c.cast) return []
    try { const p = JSON.parse(c.cast); return Array.isArray(p) ? p : [String(p)] } catch { return [c.cast] }
  })()
  const categoryName = (c as any).categoryName ?? (c as any).category_name

  // Determine which episode to play:
  // 1. If user has an in-progress episode, use that (resume from where they left off)
  // 2. Otherwise default to the first episode of the first season
  const firstEpisode = episodes[0] ?? null

  // Find resume episode in loaded episodes list
  const resumeEpisodeInList = resumeEntry?.resume_episode_id
    ? episodes.find((ep) => String(ep.id) === resumeEntry.resume_episode_id)
    : null

  // Switch to the resume season if needed
  const resumeSeason = resumeEntry?.resume_season_number != null
    ? String(resumeEntry.resume_season_number)
    : null

  // Auto-select the resume season once seasons are loaded
  const [hasAutoSelectedSeason, setHasAutoSelectedSeason] = useState(false)
  useEffect(() => {
    if (!hasAutoSelectedSeason && resumeSeason && seasonKeys.includes(resumeSeason) && activeSeason === null) {
      setHasAutoSelectedSeason(true)
      setActiveSeason(resumeSeason)
    }
  }, [hasAutoSelectedSeason, resumeSeason, seasonKeys, activeSeason])

  const episodeForPlay = resumeEpisodeInList ?? firstEpisode
  const firstEpItem: ContentItem | undefined = episodeForPlay
    ? {
        ...item,
        // Use {sourceId}:episode:{streamId} — must match what's upserted into content during series:get-info
        id: `${primarySourceId}:episode:${episodeForPlay.id}`,
        title: `S${currentSeason ?? 1}E${episodeForPlay.episode_num} · ${episodeForPlay.title ?? ''}`,
        _streamId: String(episodeForPlay.id),
        _serverUrl: serverUrl,
        _username: username,
        _password: password,
        _extension: episodeForPlay.container_extension,
      }
    : undefined

  const playButtonLabel = resumeEntry && resumeEntry.resume_season_number != null && resumeEntry.resume_episode_number != null
    ? `▶ Resume S${resumeEntry.resume_season_number}·E${resumeEntry.resume_episode_number}`
    : firstEpisode ? '▶ Play from S1·E1' : '▶ Play'

  const handleRefetch = () => { refetch() }

  return (
    <SlidePanel open={true} onClose={onClose} width={Math.min(720, window.innerWidth * 0.92)} suppressClose={isPlaying}>
      <div style={{ display: 'flex', flexDirection: 'row', height: '100%', background: 'var(--bg-1)' }}>

        {/* ── Left column: Season selector + episode list ── */}
        <div style={{
          width: 320,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border-subtle)',
          overflow: 'hidden',
        }}>
          {/* Season selector */}
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
                width: 13,
                height: 13,
                borderRadius: '50%',
                border: '2px solid rgba(139,92,246,0.2)',
                borderTopColor: 'var(--accent-interactive)',
                animation: 'spin 0.8s linear infinite',
                flexShrink: 0,
              }} />
            )}
            {seasonKeys.map((s) => {
              const isActive = currentSeason === s
              // Season 0 from Xtream APIs = specials/extras
              const label = s === '0' ? 'S' : s
              return (
                <button
                  key={s}
                  onClick={() => setActiveSeason(s)}
                  title={s === '0' ? 'Specials' : `Season ${s}`}
                  style={{
                    minWidth: 34,
                    height: 34,
                    padding: '0 6px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 500,
                    background: isActive ? 'var(--accent-interactive)' : 'var(--bg-3)',
                    color: isActive ? '#fff' : 'var(--text-1)',
                    border: `2px solid ${isActive ? 'var(--accent-interactive)' : 'transparent'}`,
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'all 0.15s',
                    fontFamily: 'var(--font-ui)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.borderColor = 'var(--accent-interactive)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.borderColor = 'transparent'
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {/* Episode list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px 20px' }}>
            {seriesFetching && episodes.length === 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '16px 12px',
                color: 'var(--text-3)',
                fontSize: 12,
                fontFamily: 'var(--font-ui)',
              }}>
                <div style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: '2px solid rgba(139,92,246,0.2)',
                  borderTopColor: 'var(--accent-interactive)',
                  animation: 'spin 0.8s linear infinite',
                  flexShrink: 0,
                }} />
                Loading episodes…
              </div>
            )}

            {!seriesFetching && seasonKeys.length === 0 && (
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
                      // If it's already a number (seconds), use directly
                      if (typeof raw === 'number') return raw
                      const str = String(raw)
                      // If it's a pure numeric string, parse as seconds
                      if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str)
                      // Otherwise parse "HH:MM:SS" or "MM:SS"
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

              return (
                <EpisodeRow
                  key={ep.id}
                  episode={epAsEpisodeRowFmt}
                  seriesId={item.id}
                  onPlay={() => {
                    const epItem: ContentItem = {
                      ...item,
                      id: `${primarySourceId}:episode:${ep.id}`,
                      title: `S${currentSeason}E${ep.episode_num} · ${ep.title ?? ''}`,
                      _streamId: String(ep.id),
                      _serverUrl: serverUrl,
                      _username: username,
                      _password: password,
                      _extension: ep.container_extension,
                    }
                    onPlay(epItem)
                  }}
                  isCompleted={isCompleted}
                  progress={progress}
                />
              )
            })}
          </div>
        </div>

        {/* ── Right column: Header + metadata + actions ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

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
              color: 'var(--accent-series)',
              background: 'color-mix(in srgb, var(--accent-series) 15%, transparent)',
              borderRadius: 4,
              padding: '2px 7px',
              fontFamily: 'var(--font-ui)',
              letterSpacing: '0.04em',
            }}>
              SERIES
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

          {/* Scrollable body */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}>
            <MetadataBlock item={c} isEnriched={isEnriched} isSeries />

            <ActionButtons
              item={c}
              onPlay={onPlay}
              episodeToPlay={firstEpItem}
              overridePlayLabel={playButtonLabel}
            />

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

            <EnrichmentFallback item={item} onEnriched={handleRefetch} />

            {/* Breadcrumbs */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexWrap: 'wrap',
              paddingTop: 4,
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
                color="var(--accent-series)"
                onClick={() => onNavigate({ type: 'series' })}
              >
                Series
              </BreadcrumbLink>
              {categoryName && (
                <>
                  <BreadcrumbSep />
                  <BreadcrumbLink
                    color="var(--text-2)"
                    onClick={() => onNavigate({ type: 'series', category: categoryName })}
                  >
                    {categoryName}
                  </BreadcrumbLink>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </SlidePanel>
  )
}

function BreadcrumbLink({ children, color, onClick }: { children: React.ReactNode; color: string; onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        fontSize: 10,
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
