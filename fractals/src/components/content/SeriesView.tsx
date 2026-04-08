import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@/lib/api'
import { ContentItem } from '@/components/browse/ContentCard'
import { useSourcesStore } from '@/stores/sources.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { BreadcrumbNav } from './ContentDetail'

interface Props {
  item: ContentItem
  onPlay: (item: ContentItem) => void
  onBack: () => void
  onNavigate?: (nav: BreadcrumbNav) => void
}

export function SeriesView({ item, onPlay, onBack, onNavigate }: Props) {
  const [activeSeason, setActiveSeason] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onBack()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onBack])

  const { data: full } = useQuery({
    queryKey: ['content', item.id],
    queryFn: () => api.content.get(item.id),
    staleTime: 60_000,
  })

  const { data: seriesData, isFetching: episodesFetching, error: episodesError } = useQuery({
    queryKey: ['series-info', item.id],
    queryFn: () => api.series.getInfo(item.id),
    staleTime: 5 * 60_000,
  })

  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)

  const c = (full as any) ?? item
  const backdrop = c.backdropUrl ?? c.backdrop_url
  const poster = c.posterUrl ?? c.poster_url
  const plot = c.plot
  const rating = c.ratingTmdb ?? c.rating_tmdb
  const year = c.year
  const categoryName = c.categoryName ?? c.category_name
  const primarySourceId = c.primarySourceId ?? c.primary_source_id ?? item.primarySourceId ?? (item as any).primary_source_id
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const primarySource = primarySourceId ? sources.find((s) => s.id === primarySourceId) : undefined

  const seasons = (seriesData as any)?.seasons ?? {}
  const seriesInfo = (seriesData as any)?.seriesInfo ?? {}
  const seasonKeys = Object.keys(seasons).sort((a, b) => Number(a) - Number(b))

  // Auto-select first season
  const currentSeason = activeSeason ?? seasonKeys[0] ?? null
  const episodes: any[] = currentSeason ? (seasons[currentSeason] ?? []) : []

  const buildEpisodeItem = (ep: any): ContentItem => ({
    ...(item as any),
    id: `episode:${ep.id}`,
    type: 'episode' as any,
    title: `S${ep.season}E${ep.episode_num} · ${ep.title}`,
    _streamId: ep.id,
    _extension: ep.container_extension,
    _sourceId: (seriesData as any)?.sourceId,
    _serverUrl: (seriesData as any)?.serverUrl,
    _username: (seriesData as any)?.username,
    _password: (seriesData as any)?.password,
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 40,
        background: 'var(--color-bg)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        WebkitAppRegion: 'no-drag' as any,
      }}
    >
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div style={{ position: 'relative', flexShrink: 0, height: 260, overflow: 'hidden', background: 'var(--color-card)' }}>
        {(backdrop || poster) && (
          <img
            src={backdrop || poster}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', filter: 'brightness(0.55)' }}
          />
        )}
        {/* Gradient to bg */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, var(--color-bg) 100%)' }} />

        {/* Breadcrumb: ← Back  Source > Series > Category > Title */}
        <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={onBack} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 8px',
            borderRadius: 8, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 12, cursor: 'pointer',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
            </svg>
            Back
          </button>
          {primarySource && sourceColor && (
            <>
              <BreadcrumbChevron />
              <BreadcrumbLink color={sourceColor.accent} onClick={() => onNavigate?.({ sourceId: primarySourceId })}>{primarySource.name}</BreadcrumbLink>
            </>
          )}
          <BreadcrumbChevron />
          <BreadcrumbLink color="rgba(255,255,255,0.7)" onClick={() => onNavigate?.({ type: 'series' })}> Series</BreadcrumbLink>
          {categoryName && (
            <>
              <BreadcrumbChevron />
              <BreadcrumbLink color="rgba(255,255,255,0.6)" onClick={() => onNavigate?.({ type: 'series', category: categoryName })}>{categoryName}</BreadcrumbLink>
            </>
          )}
          <BreadcrumbChevron />
          <span style={{ fontSize: 12, color: '#fff', fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.title}
          </span>
        </div>

        {/* Title + meta overlaid at bottom */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 24px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-series)', background: 'color-mix(in srgb, var(--color-series) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--color-series) 30%, transparent)', borderRadius: 5, padding: '2px 7px' }}>
              Series
            </span>
            {year && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{year}</span>}
            {rating && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--color-warning)">
                  <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-warning)' }}>{Number(rating).toFixed(1)}</span>
              </div>
            )}
            {seasonKeys.length > 0 && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                {seasonKeys.length} season{seasonKeys.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0, textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>
            {c.title}
          </h1>
        </div>
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

        {/* Plot */}
        {plot && (
          <div style={{ padding: '16px 24px 0' }}>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--color-text-secondary)', maxWidth: 720 }}>{plot}</p>
          </div>
        )}

        {/* Episodes loading / error */}
        {episodesFetching && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 24px', color: 'var(--color-text-muted)', fontSize: 12 }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(124,77,255,0.25)', borderTopColor: '#7c4dff', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            Loading episodes…
          </div>
        )}

        {!episodesFetching && episodesError && (
          <div style={{ padding: '20px 24px' }}>
            <p style={{ fontSize: 12, color: 'var(--color-error)' }}>Could not load episodes: {String(episodesError)}</p>
          </div>
        )}

        {!episodesFetching && seasonKeys.length === 0 && !episodesError && (
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.25">
              <rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 2v20M17 2v20M2 12h20" />
            </svg>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>No episodes available</p>
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', maxWidth: 280 }}>
              This provider may not support episode listing, or the series has no episodes yet.
            </p>
          </div>
        )}

        {seasonKeys.length > 0 && (
          <>
            {/* ── Season selector ─────────────────────────────────────── */}
            <div style={{ padding: '20px 24px 0' }}>
              <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 12 }}>
                Seasons
              </p>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
                {seasonKeys.map((s) => {
                  const isActive = currentSeason === s
                  const cover = seriesInfo?.cover ?? poster
                  return (
                    <button
                      key={s}
                      onClick={() => setActiveSeason(s)}
                      style={{
                        flexShrink: 0, width: 100, display: 'flex', flexDirection: 'column', gap: 6,
                        background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                        textAlign: 'left',
                      }}
                    >
                      {/* Season thumbnail */}
                      <div style={{
                        width: 100, height: 60, borderRadius: 8, overflow: 'hidden',
                        background: 'var(--color-card)',
                        border: `2px solid ${isActive ? 'var(--color-series)' : 'transparent'}`,
                        transition: 'border-color 0.12s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: 'relative',
                      }}>
                        {cover
                          ? <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: isActive ? 'none' : 'brightness(0.7)' }} />
                          : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.25"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20"/></svg>
                        }
                        {isActive && (
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(124,77,255,0.15)' }} />
                        )}
                      </div>
                      <span style={{
                        fontSize: 12, fontWeight: isActive ? 600 : 400,
                        color: isActive ? 'var(--color-series)' : 'var(--color-text-secondary)',
                        transition: 'color 0.12s',
                      }}>
                        Season {s}
                        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 4 }}>
                          {seasons[s]?.length ?? 0} ep
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── Episode list ─────────────────────────────────────────── */}
            <AnimatePresence mode="wait">
              <motion.div
                key={currentSeason ?? 'none'}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                style={{ padding: '20px 24px 32px' }}
              >
                <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 10 }}>
                  Season {currentSeason} · {episodes.length} episode{episodes.length !== 1 ? 's' : ''}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {episodes.map((ep) => (
                    <button
                      key={ep.id}
                      onClick={() => onPlay(buildEpisodeItem(ep))}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                        borderRadius: 10, background: 'transparent', border: 'none', cursor: 'pointer',
                        textAlign: 'left', transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-card)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      {/* Episode thumbnail */}
                      <div style={{
                        flexShrink: 0, width: 96, height: 54, borderRadius: 6,
                        background: 'var(--color-card)', overflow: 'hidden',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: 'relative',
                      }}>
                        {ep.poster
                          ? <img src={ep.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--color-text-muted)"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                        }
                        {/* Episode number badge */}
                        <div style={{
                          position: 'absolute', bottom: 4, left: 4,
                          background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '1px 5px',
                          fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.8)',
                        }}>
                          E{ep.episode_num}
                        </div>
                      </div>

                      {/* Episode info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ep.title}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {ep.duration && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{ep.duration}</span>}
                          {ep.releaseDate && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{ep.releaseDate.slice(0, 10)}</span>}
                        </div>
                        {ep.plot && (
                          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '4px 0 0', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {ep.plot}
                          </p>
                        )}
                      </div>

                      {/* Play icon */}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--color-text-muted)" style={{ flexShrink: 0 }}>
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </button>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </div>
    </motion.div>
  )
}

function BreadcrumbChevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function BreadcrumbLink({ children, color, onClick }: { children: React.ReactNode; color: string; onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        fontSize: 12, fontWeight: 500, color,
        cursor: 'pointer', transition: 'opacity 0.1s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.textDecoration = 'underline' }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.textDecoration = 'none' }}
    >
      {children}
    </span>
  )
}
