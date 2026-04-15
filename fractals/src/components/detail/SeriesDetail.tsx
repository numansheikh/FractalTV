import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContentItem, BreadcrumbNav } from '@/lib/types'
import { api } from '@/lib/api'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { EpisodeRow } from '@/components/cards/EpisodeRow'
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

export function SeriesDetail({ item, onPlay, onClose, onNavigate, isPlaying }: Props) {
  const [activeSeason, setActiveSeason] = useState<string | null>(null)
  const [autoplay, setAutoplay] = useState(true)
  const [promptSeen, setPromptSeen] = useState(false)

  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)
  const userStore = useUserStore()

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

  const { data: seriesInfo, isFetching: seriesFetching } = useQuery({
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

  const categoryName = (c as any).categoryName ?? (c as any).category_name

  const firstEpisode = episodes[0] ?? null
  const resumeEpisodeInList = resumeEntry?.resume_episode_id
    ? episodes.find((ep) => String(ep.id) === resumeEntry.resume_episode_id)
    : null
  const resumeSeason = resumeEntry?.resume_season_number != null
    ? String(resumeEntry.resume_season_number)
    : null

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
        id: `${primarySourceId}:episode:${episodeForPlay.id}`,
        title: `S${String(currentSeason ?? 1).padStart(2,'0')}E${String(episodeForPlay.episode_num).padStart(2,'0')} · ${episodeForPlay.title ?? ''}`,
        _streamId: String(episodeForPlay.id),
        _serverUrl: serverUrl,
        _username: username,
        _password: password,
        _extension: episodeForPlay.container_extension,
        _parent: { id: item.id, title: item.title, type: 'series' },
      }
    : undefined

  const playButtonLabel = resumeEntry && resumeEntry.resume_season_number != null && resumeEntry.resume_episode_number != null
    ? `▶ Resume S${resumeEntry.resume_season_number}·E${resumeEntry.resume_episode_number}`
    : firstEpisode ? '▶ Play from S1·E1' : '▶ Play'

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

              return (
                <EpisodeRow
                  key={ep.id}
                  episode={epAsEpisodeRowFmt}
                  seriesId={item.id}
                  onPlay={() => {
                    const epItem: ContentItem = {
                      ...item,
                      id: `${primarySourceId}:episode:${ep.id}`,
                      title: `S${String(currentSeason).padStart(2,'0')}E${String(ep.episode_num).padStart(2,'0')} · ${ep.title ?? ''}`,
                      _streamId: String(ep.id),
                      _serverUrl: serverUrl,
                      _username: username,
                      _password: password,
                      _extension: ep.container_extension,
                      _parent: { id: item.id, title: item.title, type: 'series' },
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

        {/* ── Right column: shared DetailShell ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <DetailShell
            typeBadge={{ label: 'SERIES', accent: 'var(--accent-series)' }}
            breadcrumbs={breadcrumbs}
            primarySource={primarySource}
            primarySourceColor={sourceColor}
            allSourceIds={allSourceIds}
            sourceColorMap={colorMap}
            onClose={onClose}
            footer={
              <>
                <ActionButtons
                  item={c}
                  onPlay={onPlay}
                  episodeToPlay={firstEpItem}
                  hidePrimary
                />
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
                  <span>{playButtonLabel}</span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </button>
                {firstEpItem && (
                  <DetailMiniPlayer
                    contentId={firstEpItem.id}
                    autoplay={autoplay}
                    promptSeen={promptSeen}
                    onPromptSeen={() => setPromptSeen(true)}
                  />
                )}
              </>
            }
          >
            <MetadataBlock item={c} isSeries />
            <AboutBlock item={c} onClose={onClose} />
          </DetailShell>
        </div>
      </div>
    </SlidePanel>
  )
}
