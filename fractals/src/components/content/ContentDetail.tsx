import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api } from '@/lib/api'
import { ContentItem } from '@/components/browse/ContentCard'
import { useSourcesStore } from '@/stores/sources.store'
import { buildColorMap } from '@/lib/sourceColors'

interface Props {
  item: ContentItem
  onPlay: (item: ContentItem) => void
  onClose: () => void
}

const TYPE_META: Record<string, { label: string; color: string; dimColor: string }> = {
  live:   { label: 'Live TV', color: 'var(--color-live)',   dimColor: 'color-mix(in srgb, var(--color-live) 12%, transparent)'   },
  movie:  { label: 'Movie',   color: 'var(--color-movie)',  dimColor: 'color-mix(in srgb, var(--color-movie) 12%, transparent)'  },
  series: { label: 'Series',  color: 'var(--color-series)', dimColor: 'color-mix(in srgb, var(--color-series) 12%, transparent)' },
}

export function ContentDetail({ item, onPlay, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    // Use capture phase so we intercept before SearchBar's handler
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose])

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-data', item.id] }),
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
  const enrichAttemptedRef = useRef(false)

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
      {/* Scrim */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', WebkitAppRegion: 'no-drag' as any }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ x: '100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        style={{
          position: 'fixed', right: 0, top: 0, zIndex: 50,
          WebkitAppRegion: 'no-drag' as any,
          width: 380, height: '100%',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border-strong)',
          boxShadow: '-20px 0 48px rgba(0,0,0,0.3)',
        }}
      >
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

          {/* Breadcrumb: Source > Type > Category */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
            {primarySource && sourceColor && (
              <>
                <span style={{ fontSize: 11, fontWeight: 600, color: sourceColor.accent }}>{primarySource.name}</span>
                <Chevron />
              </>
            )}
            <span style={{ fontSize: 11, color: meta.color, fontWeight: 500 }}>{meta.label}</span>
            {categoryName && (
              <>
                <Chevron />
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{categoryName}</span>
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

          {/* ── Episode browser (series only) ─────────────────────────── */}
          {item.type === 'series' && (
            <div style={{ marginBottom: 16 }}>
              <SectionLabel>Episodes</SectionLabel>

              {seriesFetching && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: 'var(--color-text-muted)', fontSize: 12 }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(124,77,255,0.25)', borderTopColor: '#7c4dff', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                  Loading episodes…
                </div>
              )}

              {!seriesFetching && seasonKeys.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No episodes found</p>
              )}

              {seasonKeys.length > 0 && (
                <>
                  {/* Season tabs */}
                  {seasonKeys.length > 1 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                      {seasonKeys.map((s) => (
                        <button key={s} onClick={() => setActiveSeason(s)}
                          style={{
                            padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                            background: currentSeason === s ? 'var(--color-primary-dim)' : 'var(--color-card)',
                            color: currentSeason === s ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            border: `1px solid ${currentSeason === s ? 'color-mix(in srgb, var(--color-primary) 30%, transparent)' : 'var(--color-border)'}`,
                            cursor: 'pointer',
                          }}>
                          S{s}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Episode list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                          display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                          borderRadius: 7, background: 'transparent', border: 'none', cursor: 'pointer',
                          textAlign: 'left', transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-card)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--color-text-muted)', flexShrink: 0, minWidth: 32 }}>
                          E{ep.episode_num}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, color: 'var(--color-text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ep.title}
                          </p>
                          {ep.duration && <p style={{ fontSize: 10, color: 'var(--color-text-muted)', margin: 0 }}>{ep.duration}</p>}
                        </div>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--color-text-muted)">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
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

function PosterIcon({ type, color }: { type: string; color: string }) {
  if (type === 'live') return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" opacity={0.5}>
      <rect x="2" y="7" width="20" height="15" rx="2" /><polyline points="17 2 12 7 7 2" />
    </svg>
  )
  if (type === 'series') return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" opacity={0.5}>
      <rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 2v20M17 2v20M2 12h20" />
    </svg>
  )
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" opacity={0.5}>
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <polygon points="10 8 16 12 10 16 10 8" fill={color} stroke="none" opacity={0.6} />
    </svg>
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

function ManualEnrichForm({ contentId, originalTitle, onSuccess, onSearching }: {
  contentId: string
  originalTitle: string
  onSuccess: () => void
  onSearching: (v: boolean) => void
}) {
  // Pre-clean the title for the input: strip prefix + year suffix
  const cleaned = originalTitle
    .replace(/^[A-Z]{2,4}[\s]*[\-–:|][\s]*/i, '')
    .replace(/\s*(HD|FHD|4K|SD|UHD)\s*$/i, '')
    .trim()

  const yearMatch = cleaned.match(/\((\d{4})\)\s*$/)
  const defaultYear = yearMatch ? yearMatch[1] : ''
  const defaultTitle = yearMatch ? cleaned.replace(/\s*\(\d{4}\)\s*$/, '').trim() : cleaned

  const [title, setTitle] = useState(defaultTitle)
  const [yearStr, setYearStr] = useState(defaultYear)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async () => {
    if (!title.trim()) return
    setError(null)
    onSearching(true)
    try {
      const year = yearStr ? parseInt(yearStr) : undefined
      const result = await api.enrichment.enrichManual({ contentId, title: title.trim(), year })
      onSearching(false)
      if (result?.success && result?.enrichedWithData) {
        onSuccess()
      } else {
        setError('No match found on TMDB. Try a different title.')
      }
    } catch {
      onSearching(false)
      setError('Search failed. Check your connection.')
    }
  }

  return (
    <div style={{
      marginTop: 4, padding: '12px 14px', borderRadius: 10,
      background: 'var(--color-card)', border: '1px solid var(--color-border)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Search TMDB manually</span>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); e.stopPropagation() }}
          placeholder="Movie title…"
          style={{
            flex: 1, padding: '5px 8px', borderRadius: 6, fontSize: 11,
            background: 'var(--color-bg)', border: '1px solid var(--color-border-strong)',
            color: 'var(--color-text-primary)', outline: 'none',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
          autoFocus
        />
        <input
          value={yearStr}
          onChange={(e) => setYearStr(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); e.stopPropagation() }}
          placeholder="Year"
          style={{
            width: 48, padding: '5px 6px', borderRadius: 6, fontSize: 11,
            background: 'var(--color-bg)', border: '1px solid var(--color-border-strong)',
            color: 'var(--color-text-primary)', outline: 'none', textAlign: 'center',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
        />
        <button
          onClick={handleSearch}
          style={{
            padding: '5px 12px', borderRadius: 6, border: 'none',
            background: 'var(--color-primary)', color: '#fff',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
            transition: 'opacity 0.1s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          Search
        </button>
      </div>

      {error && (
        <p style={{ fontSize: 10, color: 'var(--color-text-muted)', margin: 0 }}>{error}</p>
      )}
    </div>
  )
}
