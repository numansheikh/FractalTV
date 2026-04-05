import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
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
        color: active ? 'var(--text-0)' : 'var(--text-2)',
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

// ─── Section header ──────────────────────────────────────────────────
function SectionHeader({
  title,
  count,
  typeFilter,
  onTypeChange,
}: {
  title: string
  count: number
  typeFilter: TypeFilter
  onTypeChange: (t: TypeFilter) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      <span style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-0)',
        fontFamily: 'var(--font-ui)',
        userSelect: 'none',
      }}>
        {title}
      </span>
      <span style={{
        fontSize: 11,
        color: 'var(--text-2)',
        fontFamily: 'var(--font-mono)',
        userSelect: 'none',
      }}>
        {count}
      </span>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 4 }}>
        {TYPE_PILLS.map((p) => (
          <TypePill
            key={p.value}
            label={p.label}
            active={typeFilter === p.value}
            onClick={() => onTypeChange(p.value)}
          />
        ))}
      </div>
    </div>
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

// ─── Show all link ───────────────────────────────────────────────────
function ShowAllLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        padding: '0 4px',
        color: 'var(--accent-interactive)',
        fontSize: 11,
        cursor: 'pointer',
        flexShrink: 0,
        alignSelf: 'flex-start',
        marginTop: 2,
        fontFamily: 'var(--font-ui)',
      }}
    >
      Show all →
    </button>
  )
}

// ─── Scrollable card row ─────────────────────────────────────────────
function CardRow({
  items,
  onSelect,
  showAllAt = 20,
  onShowAll,
}: {
  items: ContentItem[]
  onSelect: (item: ContentItem) => void
  showAllAt?: number
  onShowAll?: () => void
}) {
  const sliced = items.slice(0, showAllAt)
  const hasMore = items.length > showAllAt

  return (
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', paddingBottom: 4 }}>
      {sliced.map((item) => {
        const isLive = item.type === 'live'
        return (
          <div key={item.id} style={{ width: isLive ? 168 : 130, flexShrink: 0 }}>
            {isLive
              ? <ChannelCard item={item} onClick={onSelect} />
              : <PosterCard item={item} onClick={onSelect} />
            }
          </div>
        )
      })}
      {hasMore && onShowAll && (
        <ShowAllLink onClick={onShowAll} />
      )}
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

  const [favoritesFilter, setFavoritesFilter] = useState<TypeFilter>('all')
  const [watchlistFilter, setWatchlistFilter] = useState<TypeFilter>('all')
  // History filter excluded (mixed, no live) — kept as 'all' only
  const [historyFilter] = useState<TypeFilter>('all')

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
    queryFn: () => api.user.history({ limit: 50 }),
  })

  // Bulk-load user data whenever queries resolve
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

  const displayedFavorites = favorites
  const displayedWatchlist = filterItems(watchlist, watchlistFilter)
  const displayedHistory = filterItems(history, historyFilter)

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

      {/* ── Favorites ── */}
      <div>
        <SectionHeader
          title="Favorites"
          count={displayedFavorites.length}
          typeFilter={favoritesFilter}
          onTypeChange={setFavoritesFilter}
        />
        {displayedFavorites.length === 0
          ? <EmptyText />
          : (
            <CardRow
              items={displayedFavorites}
              onSelect={onSelectContent}
              showAllAt={20}
              onShowAll={() => setFavoritesFilter('all')}
            />
          )
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
            color: 'var(--text-2)',
            fontFamily: 'var(--font-mono)',
            userSelect: 'none',
          }}>
            {displayedWatchlist.length}
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
          : (
            <CardRow
              items={displayedWatchlist}
              onSelect={onSelectContent}
            />
          )
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
            fontSize: 11,
            color: 'var(--text-2)',
            fontFamily: 'var(--font-mono)',
            userSelect: 'none',
          }}>
            {displayedHistory.length}
          </span>
        </div>
        {displayedHistory.length === 0
          ? <EmptyText />
          : (
            <CardRow
              items={displayedHistory}
              onSelect={onSelectContent}
            />
          )
        }
      </div>

    </div>
  )
}
