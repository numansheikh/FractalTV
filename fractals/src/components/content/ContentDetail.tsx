import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api } from '@/lib/api'
import { ContentItem } from '@/components/browse/ContentCard'
import { useSourcesStore } from '@/stores/sources.store'
import { buildColorMap } from '@/lib/sourceColors'

export interface BreadcrumbNav {
  type?: 'live' | 'movie' | 'series'
  sourceId?: string
  category?: string
}

interface Props {
  item: ContentItem
  onPlay: (item: ContentItem) => void
  onClose: () => void
  onNavigate?: (nav: BreadcrumbNav) => void
  isPlaying?: boolean
}

const TYPE_META: Record<string, { label: string; color: string; dimColor: string }> = {
  live:   { label: 'Live TV', color: 'var(--color-live)',   dimColor: 'color-mix(in srgb, var(--color-live) 12%, transparent)'   },
  movie:  { label: 'Movie',   color: 'var(--color-movie)',  dimColor: 'color-mix(in srgb, var(--color-movie) 12%, transparent)'  },
  series: { label: 'Series',  color: 'var(--color-series)', dimColor: 'color-mix(in srgb, var(--color-series) 12%, transparent)' },
}

export function ContentDetail({ item, onPlay, onClose, onNavigate, isPlaying }: Props) {
  const isSeries = item.type === 'series'
  const panelWidth = isSeries ? 720 : 380
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isPlaying) return // Let Player handle Escape when it's on top
        e.stopImmediatePropagation()
        onClose()
      }
    }
    // Use capture phase so we intercept before SearchBar's handler
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose, isPlaying])

  const qc = useQueryClient()
  const { sources } = useSourcesStore()
  const colorMap = buildColorMap(sources.map((s) => s.id))

  // ── Favorites / watchlist ──────────────────────────────────────────────
  const { data: userData } = useQuery({
    queryKey: ['user-data', item.id],
    queryFn: () => api.user.getData(item.id),
    staleTime: 30_000,
  })
  const isFavorite  = !!(userData as any)?.favorite
  const isWatchlist = !!(userData as any)?.watchlist

  const toggleFav = useMutation({
    mutationFn: () => api.user.toggleFavorite(item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-data', item.id] })
      qc.invalidateQueries({ queryKey: ['browse-favorites'] })
      qc.invalidateQueries({ queryKey: ['library', 'favorites'] })
    },
  })
  const toggleWl = useMutation({
    mutationFn: () => api.user.toggleWatchlist(item.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-data', item.id] }),
  })

  const { data: full } = useQuery({
    queryKey: ['content', item.id],
    queryFn: () => api.content.get(item.id),
  })

  const c = (full as any) ?? item
  const genres: string[] = c.genres ? tryParse(c.genres) : []
  const cast: string[] = c.cast ? tryParse(c.cast) : []
  const rating = c.ratingTmdb ?? c.rating_tmdb ?? c.ratingImdb ?? c.rating_imdb
  const plot = c.plot
  const year = c.year
  const runtime = c.runtime
  const director = c.director
  const backdrop = c.backdropUrl ?? c.backdrop_url
  const poster = c.posterUrl ?? c.poster_url
  const meta = TYPE_META[item.type] ?? TYPE_META.movie
  const hasEnrichedData = plot || director || cast.length > 0 || genres.length > 0

  // ── On-demand TMDB enrichment ───────────────────────────────────────
  const [enriching, setEnriching] = useState(false)
  const [enrichFailed, setEnrichFailed] = useState(false)
  const [showManualSearch, setShowManualSearch] = useState(false)
  const enrichAttemptedRef = useRef(false)

  // Reset enrichment state when item changes
  useEffect(() => {
    enrichAttemptedRef.current = false
    setEnrichFailed(false)
    setShowManualSearch(false)
  }, [item.id])

  useEffect(() => {
    if (hasEnrichedData) return
    if (item.type === 'live') return
    if (!full) return
    if (enrichAttemptedRef.current) return
    enrichAttemptedRef.current = true

    setEnriching(true)

    const timeout = setTimeout(() => {
      setEnriching(false)
      setEnrichFailed(true)
    }, 15_000)

    api.enrichment.enrichSingle(item.id).then(async (result: any) => {
      clearTimeout(timeout)
      if (result?.success && result?.enrichedWithData) {
        await qc.refetchQueries({ queryKey: ['content', item.id] })
      }
      setEnriching(false)
      if (!result?.success || (!result?.enrichedWithData && !result?.alreadyEnriched)) {
        setEnrichFailed(true)
      }
    }).catch(() => {
      clearTimeout(timeout)
      setEnriching(false)
      setEnrichFailed(true)
    })

    return () => clearTimeout(timeout)
  }, [item.id, item.type, hasEnrichedData, full, qc])

  const primarySourceId = c.primarySourceId ?? c.primary_source_id ?? item.primarySourceId ?? item.primary_source_id
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const primarySource = primarySourceId ? sources.find((s) => s.id === primarySourceId) : undefined
  const containerExt = c.containerExtension ?? c.container_extension
  const categoryName = c.categoryName ?? c.category_name

  // Pick the best image: backdrop > poster > nothing
  const heroImg = backdrop || poster

  // Series: episode browser state
  const [activeSeason, setActiveSeason] = useState<string | null>(null)
  const { data: seriesInfo, isFetching: seriesFetching } = useQuery({
    queryKey: ['series-info', item.id],
    queryFn: () => api.series.getInfo(item.id),
    enabled: item.type === 'series',
    staleTime: 5 * 60_000,
  })
  const seasons = (seriesInfo as any)?.seasons ?? {}
  const seasonKeys = Object.keys(seasons).sort((a, b) => Number(a) - Number(b))
  const currentSeason = activeSeason ?? seasonKeys[0] ?? null
  const episodes: any[] = currentSeason ? (seasons[currentSeason] ?? []) : []

  return (
    <>
      {/* Scrim — hidden when player is on top */}
      {!isPlaying && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', WebkitAppRegion: 'no-drag' as any }}
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <motion.div
        initial={{ x: '100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        style={{
          position: 'fixed', right: 0, top: 0, zIndex: 50,
          WebkitAppRegion: 'no-drag' as any,
          width: panelWidth, height: '100%',
          display: 'flex', flexDirection: 'row', overflow: 'hidden',
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border-strong)',
          boxShadow: '-20px 0 48px rgba(0,0,0,0.3)',
        }}
      >
        {/* ── Left column: Episodes (series only) ─────────────────── */}
        {isSeries && (
          <div style={{
            width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column',
            borderRight: '1px solid var(--color-border)',
            overflow: 'hidden',
          }}>
            {/* Season coins */}
            <div style={{ padding: '16px 16px 0', flexShrink: 0 }}>
              <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 10 }}>
                Seasons
              </p>
              {seasonKeys.length > 1 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {seasonKeys.map((s) => {
                    const isActive = currentSeason === s
                    return (
                      <button key={s} onClick={() => setActiveSeason(s)}
                        style={{
                          width: 34, height: 34, borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: isActive ? 700 : 500,
                          background: isActive ? 'var(--color-primary)' : 'var(--color-card)',
                          color: isActive ? '#fff' : 'var(--color-text-secondary)',
                          border: `2px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.borderColor = 'var(--color-primary)' }}
                        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.borderColor = 'var(--color-border)' }}
                      >
                        {s}
                      </button>
                    )
                  })}
                </div>
              )}
              {currentSeason && (
                <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                  Season {currentSeason} · {episodes.length} episode{episodes.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* Episode list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 20px' }}>
              {seriesFetching && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 8px', color: 'var(--color-text-muted)', fontSize: 12 }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(124,77,255,0.25)', borderTopColor: '#7c4dff', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                  Loading episodes…
                </div>
              )}

              {!seriesFetching && seasonKeys.length === 0 && (
                <div style={{ padding: '24px 8px', textAlign: 'center' }}>
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No episodes found</p>
                </div>
              )}

              {episodes.map((ep) => (
                <button key={ep.id} onClick={() => {
                  const epItem: any = {
                    id: `episode:${ep.id}`,
                    type: 'episode',
                    title: `S${ep.season}E${ep.episode_num} · ${ep.title}`,
                    _streamId: ep.id,
                    _extension: ep.container_extension,
                    _sourceId: (seriesInfo as any)?.sourceId,
                    _serverUrl: (seriesInfo as any)?.serverUrl,
                    _username: (seriesInfo as any)?.username,
                    _password: (seriesInfo as any)?.password,
                  }
                  onPlay(epItem)
                }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', width: '100%',
                    borderRadius: 7, background: 'transparent', border: 'none', cursor: 'pointer',
                    textAlign: 'left', transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-card)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {/* Episode thumbnail */}
                  {ep.poster ? (
                    <img src={ep.poster} alt="" style={{ width: 72, height: 40, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{
                      width: 72, height: 40, borderRadius: 5, flexShrink: 0,
                      background: 'var(--color-card)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--color-text-muted)"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--color-text-muted)', marginRight: 6 }}>E{ep.episode_num}</span>
                      {ep.title}
                    </p>
                    {ep.duration && <p style={{ fontSize: 10, color: 'var(--color-text-muted)', margin: '2px 0 0' }}>{ep.duration}</p>}
                  </div>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--color-text-muted)" style={{ flexShrink: 0 }}>
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Right column: Metadata (same for all types) ──────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* ── Hero: full-width image with title overlaid ─────────────── */}
        <div style={{ position: 'relative', flexShrink: 0, height: 200, overflow: 'hidden', background: 'var(--color-card)' }}>
          {heroImg ? (
            <img
              src={heroImg}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <HeroIcon type={item.type} color={meta.color} />
            </div>
          )}

          {/* Bottom gradient → surface color */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.0) 30%, var(--color-surface) 100%)',
          }} />

          {/* Close button — top right */}
          <button
            onClick={onClose}
            style={{
              position: 'absolute', top: 12, right: 12,
              width: 30, height: 30, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff', cursor: 'pointer', transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.7)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.45)' }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>

          {/* Title block — overlaid on bottom of hero */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 18px 14px' }}>
            {/* Type + year + runtime pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 10, fontWeight: 600, color: meta.color,
                background: meta.dimColor,
                border: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)`,
                borderRadius: 5, padding: '2px 7px',
              }}>
                {meta.label}
              </span>
              {year && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{year}</span>}
              {runtime && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{runtime}m</span>}
              {rating && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 2 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--color-warning)">
                    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-warning)' }}>{Number(rating).toFixed(1)}</span>
                </div>
              )}
            </div>
            <h1 style={{
              fontSize: 17, fontWeight: 700, lineHeight: 1.25,
              color: heroImg ? '#fff' : 'var(--color-text-primary)',
              textShadow: heroImg ? '0 1px 8px rgba(0,0,0,0.7)' : 'none',
              margin: 0,
            }}>
              {c.title}
            </h1>
          </div>
        </div>

        {/* ── Scrollable body ────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 28px' }}>

          {/* Breadcrumb: Source > Type > Category · .ext */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
            {primarySource && sourceColor && (
              <>
                <CrumbLink color={sourceColor.accent} onClick={() => onNavigate?.({ sourceId: primarySourceId })}>{primarySource.name}</CrumbLink>
                <Chevron />
              </>
            )}
            <CrumbLink color={meta.color} onClick={() => onNavigate?.({ type: item.type as any })}>{meta.label}</CrumbLink>
            {categoryName && (
              <>
                <Chevron />
                <CrumbLink color="var(--color-text-secondary)" onClick={() => onNavigate?.({ type: item.type as any, category: categoryName })}>{categoryName}</CrumbLink>
              </>
            )}
            {containerExt && (
              <>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 4 }}>·</span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>.{containerExt}</span>
              </>
            )}
          </div>

          {/* Play + Favorite + Watchlist row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            {item.type !== 'series' && (
              <button
                onClick={() => onPlay(item)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: sourceColor ? sourceColor.accent : 'var(--color-primary)',
                  color: '#fff', fontSize: 13, fontWeight: 600,
                  transition: 'opacity 0.1s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                {item.type === 'live' ? 'Watch Live' : 'Play'}
              </button>
            )}
            {/* Favorite toggle */}
            <button
              onClick={() => toggleFav.mutate()}
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              style={{
                width: 40, height: 40, borderRadius: 10, border: `1px solid ${isFavorite ? 'rgba(236,25,111,0.4)' : 'var(--color-border-strong)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: isFavorite ? 'rgba(236,25,111,0.12)' : 'transparent',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(236,25,111,0.4)'; e.currentTarget.style.background = 'rgba(236,25,111,0.1)' }}
              onMouseLeave={(e) => { if (!isFavorite) { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.background = 'transparent' } }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill={isFavorite ? '#ec196f' : 'none'} stroke={isFavorite ? '#ec196f' : 'var(--color-text-muted)'} strokeWidth="2" strokeLinecap="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
            {/* Watchlist toggle */}
            <button
              onClick={() => toggleWl.mutate()}
              title={isWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
              style={{
                width: 40, height: 40, borderRadius: 10, border: `1px solid ${isWatchlist ? 'rgba(124,77,255,0.4)' : 'var(--color-border-strong)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: isWatchlist ? 'var(--color-primary-dim)' : 'transparent',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(124,77,255,0.4)'; e.currentTarget.style.background = 'var(--color-primary-dim)' }}
              onMouseLeave={(e) => { if (!isWatchlist) { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.background = 'transparent' } }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={isWatchlist ? 'var(--color-primary)' : 'none'} stroke={isWatchlist ? 'var(--color-primary)' : 'var(--color-text-muted)'} strokeWidth="2" strokeLinecap="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          </div>

          {/* Genres */}
          {genres.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 16 }}>
              {genres.map((g) => (
                <span key={g} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 20, background: 'var(--color-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Plot */}
          {plot && (
            <div style={{ marginBottom: 16 }}>
              <SectionLabel>Overview</SectionLabel>
              <p style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>{plot}</p>
            </div>
          )}

          {/* Director */}
          {director && <MetaRow label="Director" value={director} />}

          {/* Cast */}
          {cast.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <SectionLabel>Cast</SectionLabel>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
                {cast.slice(0, 8).join(', ')}
                {cast.length > 8 && <span style={{ color: 'var(--color-text-muted)' }}> +{cast.length - 8} more</span>}
              </p>
            </div>
          )}

          {/* Star rating */}
          {item.type !== 'live' && (
            <StarRating
              contentId={item.id}
              currentRating={(userData as any)?.rating ?? null}
              onRate={(r) => api.user.setRating(item.id, r)}
            />
          )}

          {/* Re-match on TMDB — available when content is enriched but might be wrong */}
          {hasEnrichedData && item.type !== 'live' && !showManualSearch && (
            <div style={{ marginBottom: 14 }}>
              <span
                onClick={() => setShowManualSearch(true)}
                style={{ fontSize: 10, color: 'var(--color-text-muted)', cursor: 'pointer', transition: 'color 0.1s' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
              >
                Wrong match? Search TMDB manually
              </span>
            </div>
          )}

          {/* Manual TMDB search (re-match) */}
          {showManualSearch && item.type !== 'live' && (
            <ManualEnrichForm
              contentId={item.id}
              contentType={item.type as 'movie' | 'series'}
              originalTitle={c.title}
              onSuccess={() => {
                setShowManualSearch(false)
                setEnrichFailed(false)
                qc.refetchQueries({ queryKey: ['content', item.id] })
              }}
              onCancel={() => setShowManualSearch(false)}
              onSearching={(v) => setEnriching(v)}
            />
          )}

          {/* Enrichment status */}
          {!hasEnrichedData && item.type !== 'series' && (
            enriching ? (
              <div style={{
                marginTop: 4, padding: '14px 16px', borderRadius: 10,
                background: 'var(--color-card)', border: '1px solid var(--color-border)',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(124,77,255,0.25)', borderTopColor: '#7c4dff', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Fetching metadata from TMDB…</span>
              </div>
            ) : enrichFailed ? (
              <ManualEnrichForm
                contentId={item.id}
                contentType={item.type as 'movie' | 'series'}
                originalTitle={c.title}
                onSuccess={() => {
                  setEnrichFailed(false)
                  qc.refetchQueries({ queryKey: ['content', item.id] })
                }}
                onSearching={(v) => setEnriching(v)}
              />
            ) : null
          )}
        </div>
        </div>{/* end right column */}
      </motion.div>
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 6 }}>
      {children}
    </p>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <SectionLabel>{label}</SectionLabel>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{value}</p>
    </div>
  )
}

function HeroIcon({ type, color }: { type: string; color: string }) {
  if (type === 'live') return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="0.8" style={{ opacity: 0.3 }}>
      <rect x="2" y="7" width="20" height="15" rx="2" /><polyline points="17 2 12 7 7 2" />
    </svg>
  )
  if (type === 'series') return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="0.8" style={{ opacity: 0.3 }}>
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <path d="M7 2v20M17 2v20M2 12h20" />
    </svg>
  )
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="0.8" style={{ opacity: 0.3 }}>
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <polygon points="10 8 16 12 10 16 10 8" fill={color} stroke="none" opacity={0.7} />
    </svg>
  )
}

function CrumbLink({ children, color, onClick }: { children: React.ReactNode; color: string; onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        fontSize: 11, fontWeight: 500, color,
        cursor: 'pointer', transition: 'opacity 0.1s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.textDecoration = 'underline' }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.textDecoration = 'none' }}
    >
      {children}
    </span>
  )
}

function Chevron() {
  return (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function tryParse(s: string): string[] {
  try { return JSON.parse(s) } catch { return [s] }
}

interface TmdbResult {
  tmdbId: number
  title: string
  originalTitle?: string
  year?: string
  overview?: string
  posterUrl?: string
  rating?: number
}

function StarRating({ contentId, currentRating, onRate }: {
  contentId: string
  currentRating: number | null
  onRate: (rating: number | null) => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [rating, setRating] = useState(currentRating)

  const handleClick = (star: number) => {
    const newRating = rating === star ? null : star
    setRating(newRating)
    onRate(newRating)
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <SectionLabel>Your Rating</SectionLabel>
      <div style={{ display: 'flex', gap: 4 }}>
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = (hover ?? rating ?? 0) >= star
          return (
            <button key={star}
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover(null)}
              onClick={() => handleClick(star)}
              style={{
                background: 'none', border: 'none', padding: 2, cursor: 'pointer',
                transition: 'transform 0.1s',
                transform: hover === star ? 'scale(1.2)' : 'scale(1)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24"
                fill={filled ? '#ffab40' : 'none'}
                stroke={filled ? '#ffab40' : 'var(--color-text-muted)'}
                strokeWidth="1.5"
              >
                <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </button>
          )
        })}
        {rating && (
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', alignSelf: 'center', marginLeft: 4 }}>
            {rating}/5
          </span>
        )}
      </div>
    </div>
  )
}

function ManualEnrichForm({ contentId, contentType, originalTitle, onSuccess, onCancel, onSearching }: {
  contentId: string
  contentType: 'movie' | 'series'
  originalTitle: string
  onSuccess: () => void
  onCancel?: () => void
  onSearching: (v: boolean) => void
}) {
  const cleaned = originalTitle
    .replace(/^[A-Z]{2,4}[\s]*[\-–:|][\s]*/i, '')
    .replace(/\s*(HD|FHD|4K|SD|UHD)\s*$/i, '')
    .trim()

  const yearMatch = cleaned.match(/\((\d{4})\)\s*$/)
  const defaultYear = yearMatch ? yearMatch[1] : ''
  const defaultTitle = yearMatch ? cleaned.replace(/\s*\(\d{4}\)\s*$/, '').trim() : cleaned

  const [title, setTitle] = useState(defaultTitle)
  const [yearStr, setYearStr] = useState(defaultYear)
  const [results, setResults] = useState<TmdbResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async () => {
    if (!title.trim()) return
    setError(null)
    setResults(null)
    setSearching(true)
    try {
      const year = yearStr ? parseInt(yearStr) : undefined
      const res = await api.enrichment.searchTmdb({ title: title.trim(), year, type: contentType })
      setSearching(false)
      if (res?.success && res.results?.length > 0) {
        setResults(res.results)
      } else if (res?.error) {
        setError(res.error)
      } else {
        setError('No results found. Try a different title.')
      }
    } catch (err) {
      setSearching(false)
      setError(`Search failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handlePick = async (tmdbId: number) => {
    setPicking(true)
    onSearching(true)
    try {
      const res = await api.enrichment.enrichById({ contentId, tmdbId })
      onSearching(false)
      setPicking(false)
      if (res?.success && res?.enrichedWithData) {
        onSuccess()
      } else {
        setError('Failed to enrich with selected result.')
      }
    } catch {
      onSearching(false)
      setPicking(false)
      setError('Enrichment failed.')
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: '5px 8px', borderRadius: 6, fontSize: 11,
    background: 'var(--color-bg)', border: '1px solid var(--color-border-strong)',
    color: 'var(--color-text-primary)', outline: 'none',
  }

  return (
    <div style={{
      marginTop: 4, padding: '12px 14px', borderRadius: 10,
      background: 'var(--color-card)', border: '1px solid var(--color-border)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Search TMDB</span>
        </div>
        {onCancel && (
          <span
            onClick={onCancel}
            style={{ fontSize: 10, color: 'var(--color-text-muted)', cursor: 'pointer' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >Cancel</span>
        )}
      </div>

      {/* Search inputs */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); e.stopPropagation() }}
          placeholder="Title…"
          style={{ ...inputStyle, flex: 1 }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
          autoFocus
        />
        <input
          value={yearStr} onChange={(e) => setYearStr(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); e.stopPropagation() }}
          placeholder="Year"
          style={{ ...inputStyle, width: 48, textAlign: 'center' }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
        />
        <button onClick={handleSearch} disabled={searching}
          style={{
            padding: '5px 12px', borderRadius: 6, border: 'none',
            background: 'var(--color-primary)', color: '#fff',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
            opacity: searching ? 0.5 : 1, transition: 'opacity 0.1s',
          }}>
          {searching ? '…' : 'Search'}
        </button>
      </div>

      {/* Results list */}
      {results && !picking && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflowY: 'auto' }}>
          {results.map((r) => (
            <button key={r.tmdbId} onClick={() => handlePick(r.tmdbId)}
              style={{
                display: 'flex', gap: 8, padding: '6px 8px', borderRadius: 7,
                background: 'transparent', border: 'none', cursor: 'pointer',
                textAlign: 'left', transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {r.posterUrl ? (
                <img src={r.posterUrl} alt="" style={{ width: 32, height: 48, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 32, height: 48, borderRadius: 4, background: 'var(--color-surface)', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.title}
                  {r.year && <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 4 }}>({r.year})</span>}
                </p>
                {r.rating && (
                  <span style={{ fontSize: 10, color: 'var(--color-warning)' }}>{Number(r.rating).toFixed(1)}</span>
                )}
                {r.overview && (
                  <p style={{ fontSize: 10, color: 'var(--color-text-muted)', margin: '2px 0 0', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {r.overview}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {picking && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(124,77,255,0.25)', borderTopColor: '#7c4dff', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Applying metadata…</span>
        </div>
      )}

      {error && (
        <p style={{ fontSize: 10, color: 'var(--color-text-muted)', margin: 0 }}>{error}</p>
      )}
    </div>
  )
}
