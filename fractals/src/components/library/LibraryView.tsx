import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ContentItem } from '@/lib/types'
import { useUserStore } from '@/stores/user.store'
import { PosterCard } from '@/components/cards/PosterCard'
import { ChannelCard } from '@/components/cards/ChannelCard'

type TypeFilter = 'all' | 'live' | 'movie' | 'series'

interface Props {
  onSelectContent: (item: ContentItem) => void
}

const TYPE_PILLS: { label: string; value: TypeFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Live', value: 'live' },
  { label: 'Movies', value: 'movie' },
  { label: 'Series', value: 'series' },
]

// ─── Pill button ────────────────────────────────────────────────────
function TypePill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '2px 8px',
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 500,
        border: active
          ? '1px solid var(--accent-interactive)'
          : '1px solid var(--border-default)',
        background: active
          ? 'var(--accent-interactive-dim)'
          : 'transparent',
        color: active ? 'var(--text-0)' : 'var(--text-1)',
        cursor: 'pointer',
        fontFamily: 'var(--font-ui)',
        transition: 'background 0.1s, border-color 0.1s, color 0.1s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}


// ─── Empty text ──────────────────────────────────────────────────────
function EmptyText() {
  return (
    <p style={{
      fontSize: 12,
      color: 'var(--text-2)',
      fontFamily: 'var(--font-ui)',
      padding: '10px 0',
      userSelect: 'none',
    }}>
      Nothing here yet
    </p>
  )
}

// ─── History card row (with per-item remove) ─────────────────────────
function HistoryCardRow({
  items,
  onSelect,
  onRemove,
  showAllAt = 20,
}: {
  items: ContentItem[]
  onSelect: (item: ContentItem) => void
  onRemove: (item: ContentItem) => void
  showAllAt?: number
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const sliced = items.slice(0, showAllAt)

  return (
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', paddingBottom: 4 }}>
      {sliced.map((item) => {
        const isLive = item.type === 'live'
        const isHovered = hoveredId === item.id
        return (
          <div
            key={item.id}
            style={{ width: isLive ? 168 : 130, flexShrink: 0 }}
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {isLive
              ? <ChannelCard item={item} onClick={onSelect} />
              : <PosterCard item={item} onClick={onSelect} />
            }
            {/* Remove strip — below the card, outside poster area */}
            <div style={{
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isHovered ? 1 : 0,
              transition: 'opacity 0.12s',
            }}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(item)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '2px 6px',
                  borderRadius: 3,
                  fontSize: 10,
                  color: 'var(--accent-danger)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontFamily: 'var(--font-ui)',
                }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Remove
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Continue Watching card row ──────────────────────────────────────
function ContinueWatchingRow({
  items,
  onSelect,
  onRemove,
}: {
  items: ContentItem[]
  onSelect: (item: ContentItem) => void
  onRemove: (item: ContentItem) => void
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', paddingBottom: 4 }}>
      {items.map((item) => {
        const isHovered = hoveredId === item.id
        const isSeries = item.type === 'series'
        const episodeLabel = isSeries && item.resume_season_number != null && item.resume_episode_number != null
          ? `S${item.resume_season_number} · E${item.resume_episode_number}`
          : null
        const episodeTitle = isSeries && item.resume_episode_title
          ? item.resume_episode_title
          : null

        return (
          <div
            key={item.id}
            style={{ width: 130, flexShrink: 0 }}
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {/* Poster — PosterCard handles progress bar for movies via useUserStore */}
            <PosterCard item={item} onClick={onSelect} />

            {/* Episode info — series only */}
            {episodeLabel && (
              <div style={{ padding: '3px 2px 0', display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--accent-series)',
                  fontFamily: 'var(--font-ui)',
                  lineHeight: 1,
                }}>
                  {episodeLabel}
                </span>
                {episodeTitle && (
                  <span style={{
                    fontSize: 10,
                    color: 'var(--text-1)',
                    fontFamily: 'var(--font-ui)',
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}>
                    {episodeTitle}
                  </span>
                )}
              </div>
            )}

            {/* Remove strip */}
            <div style={{
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isHovered ? 1 : 0,
              transition: 'opacity 0.12s',
            }}>
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(item) }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '2px 6px',
                  borderRadius: 3,
                  fontSize: 10,
                  color: 'var(--accent-danger)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontFamily: 'var(--font-ui)',
                }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Remove
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Divider ─────────────────────────────────────────────────────────
function Divider() {
  return (
    <hr style={{
      border: 'none',
      borderTop: '1px solid var(--border-subtle)',
      margin: '8px 0',
    }} />
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────
function filterItems(items: ContentItem[], filter: TypeFilter): ContentItem[] {
  if (filter === 'all') return items
  return items.filter((i) => i.type === filter)
}


// ─── Main component ──────────────────────────────────────────────────
export function LibraryView({ onSelectContent }: Props) {
  const loadBulk = useUserStore((s) => s.loadBulk)
  const qc = useQueryClient()

  const [favoritesFilter, setFavoritesFilter] = useState<TypeFilter>('all')
  const [watchlistFilter, setWatchlistFilter] = useState<TypeFilter>('all')
  // History filter excluded (mixed, no live) — kept as 'all' only

  // ── Continue Watching query ──────────────────────────────────────
  const { data: continueWatching = [] } = useQuery<ContentItem[]>({
    queryKey: ['library', 'continue-watching'],
    queryFn: () => api.user.continueWatching() as Promise<ContentItem[]>,
  })

  // ── Favorites query ──────────────────────────────────────────────
  const apiTypeArg = (f: TypeFilter) =>
    f === 'all' ? undefined : (f as 'live' | 'movie' | 'series')

  const { data: favorites = [] } = useQuery<ContentItem[]>({
    queryKey: ['library', 'favorites', favoritesFilter],
    queryFn: () => api.user.favorites({ type: apiTypeArg(favoritesFilter) }),
  })

  // ── Watchlist query ──────────────────────────────────────────────
  const { data: watchlist = [] } = useQuery<ContentItem[]>({
    queryKey: ['library', 'watchlist', watchlistFilter],
    queryFn: () => api.user.watchlist({ type: apiTypeArg(watchlistFilter) }),
  })

  // ── History query ────────────────────────────────────────────────
  const { data: history = [] } = useQuery<ContentItem[]>({
    queryKey: ['library', 'history'],
    queryFn: () => api.user.history({ limit: 30 }),
  })

  // Bulk-load user data whenever queries resolve
  useEffect(() => {
    if (continueWatching.length > 0) loadBulk(continueWatching.map((i) => i.id))
  }, [continueWatching, loadBulk])

  useEffect(() => {
    if (favorites.length > 0) loadBulk(favorites.map((i) => i.id))
  }, [favorites, loadBulk])

  useEffect(() => {
    if (watchlist.length > 0) loadBulk(watchlist.map((i) => i.id))
  }, [watchlist, loadBulk])

  useEffect(() => {
    if (history.length > 0) loadBulk(history.map((i) => i.id))
  }, [history, loadBulk])

  // Apply client-side watchlist type filter (no live in watchlist)
  const watchlistPills: { label: string; value: TypeFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Movies', value: 'movie' },
    { label: 'Series', value: 'series' },
  ]

  const handleRemoveContinue = async (item: ContentItem) => {
    // Remove from continue watching only — keeps watch history intact
    const clearId = item.resume_episode_id ?? item.id
    qc.setQueryData<ContentItem[]>(['library', 'continue-watching'], (prev) =>
      prev ? prev.filter((i) => i.id !== item.id) : []
    )
    try {
      await api.user.clearContinue(clearId)
    } catch { /* noop — already removed from UI */ }
    qc.invalidateQueries({ queryKey: ['library', 'continue-watching'] })
    qc.invalidateQueries({ queryKey: ['home-continue'] })
  }

  const handleRemoveFavorite = async (item: ContentItem) => {
    qc.setQueryData<ContentItem[]>(['library', 'favorites', favoritesFilter], (prev) =>
      prev ? prev.filter((i) => i.id !== item.id) : []
    )
    useUserStore.getState().setFavorite(item.id, false)
    try {
      await api.user.toggleFavorite(item.id)
    } catch { /* noop */ }
    qc.invalidateQueries({ queryKey: ['browse-favorites'] })
    qc.invalidateQueries({ queryKey: ['library', 'favorites'] })
    qc.invalidateQueries({ queryKey: ['channels', 'favorites'] })
  }

  const handleRemoveWatchlist = async (item: ContentItem) => {
    qc.setQueryData<ContentItem[]>(['library', 'watchlist', watchlistFilter], (prev) =>
      prev ? prev.filter((i) => i.id !== item.id) : []
    )
    useUserStore.getState().setWatchlist(item.id, false)
    try {
      await api.user.toggleWatchlist(item.id)
    } catch { /* noop */ }
    qc.invalidateQueries({ queryKey: ['library', 'watchlist'] })
    qc.invalidateQueries({ queryKey: ['home-watchlist'] })
  }

  const handleRemoveHistory = async (item: ContentItem) => {
    qc.setQueryData<ContentItem[]>(['library', 'history'], (prev) =>
      prev ? prev.filter((i) => i.id !== item.id) : []
    )
    useUserStore.getState().clearItemHistory(item.id)
    try {
      await api.user.clearItemHistory(item.id)
    } catch { /* noop */ }
    qc.invalidateQueries({ queryKey: ['library', 'history'] })
  }

  const displayedContinueWatching = continueWatching
  const displayedFavorites = favorites
  const displayedWatchlist = filterItems(watchlist, watchlistFilter)
  const displayedHistory = history

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      height: '100%',
      overflowY: 'auto',
      padding: '16px',
      fontFamily: 'var(--font-ui)',
    }}>

      {/* ── Continue Watching ── */}
      {displayedContinueWatching.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-0)',
              fontFamily: 'var(--font-ui)',
              userSelect: 'none',
            }}>
              Continue Watching
            </span>
            <span style={{
              fontSize: 11,
              color: 'var(--text-1)',
              fontFamily: 'var(--font-mono)',
              userSelect: 'none',
            }}>
              {continueWatching.length}
            </span>
          </div>
          <ContinueWatchingRow
            items={displayedContinueWatching}
            onSelect={onSelectContent}
            onRemove={handleRemoveContinue}
          />
        </div>
      )}

      {displayedContinueWatching.length > 0 && <Divider />}

      {/* ── Favorites ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-0)',
            fontFamily: 'var(--font-ui)',
            userSelect: 'none',
          }}>
            Favorites
          </span>
          <span style={{
            fontSize: 11,
            color: 'var(--text-1)',
            fontFamily: 'var(--font-mono)',
            userSelect: 'none',
          }}>
            {favorites.length}
          </span>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {TYPE_PILLS.map((p) => (
              <TypePill
                key={p.value}
                label={p.label}
                active={favoritesFilter === p.value}
                onClick={() => setFavoritesFilter(p.value)}
              />
            ))}
          </div>
        </div>
        {displayedFavorites.length === 0
          ? <EmptyText />
          : <HistoryCardRow items={displayedFavorites} onSelect={onSelectContent} onRemove={handleRemoveFavorite} />
        }
      </div>

      <Divider />

      {/* ── Watchlist ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-0)',
            fontFamily: 'var(--font-ui)',
            userSelect: 'none',
          }}>
            Watchlist
          </span>
          <span style={{
            fontSize: 11,
            color: 'var(--text-1)',
            fontFamily: 'var(--font-mono)',
            userSelect: 'none',
          }}>
            {watchlist.length}
          </span>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {watchlistPills.map((p) => (
              <TypePill
                key={p.value}
                label={p.label}
                active={watchlistFilter === p.value}
                onClick={() => setWatchlistFilter(p.value)}
              />
            ))}
          </div>
        </div>
        {displayedWatchlist.length === 0
          ? <EmptyText />
          : <HistoryCardRow items={displayedWatchlist} onSelect={onSelectContent} onRemove={handleRemoveWatchlist} />
        }
      </div>

      <Divider />

      {/* ── Watch History ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-0)',
            fontFamily: 'var(--font-ui)',
            userSelect: 'none',
          }}>
            Watch History
          </span>
          <span style={{
            fontSize: 10,
            color: 'var(--text-2)',
            fontStyle: 'italic',
            fontFamily: 'var(--font-ui)',
            userSelect: 'none',
          }}>
            latest 30
          </span>
        </div>
        {displayedHistory.length === 0
          ? <EmptyText />
          : (
            <HistoryCardRow
              items={displayedHistory}
              onSelect={onSelectContent}
              onRemove={handleRemoveHistory}
            />
          )
        }
      </div>

    </div>
  )
}
