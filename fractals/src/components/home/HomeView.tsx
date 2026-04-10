import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, rectSortingStrategy,
  sortableKeyboardCoordinates, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppStore } from '@/stores/app.store'
import { useSearchStore } from '@/stores/search.store'
import { useSourcesStore } from '@/stores/sources.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { api } from '@/lib/api'
import { ContentItem } from '@/lib/types'
import { PosterCard as RichPosterCard } from '@/components/cards/PosterCard'
import { ChannelCard as RichChannelCard } from '@/components/cards/ChannelCard'
import { useTheme } from '@/hooks/useTheme'

// ── Hero search field ────────────────────────────────────────────────────────
// Single rounded input with internal positioning. The visible value strips the
// leading '@' (if any) — advanced mode is shown via an ADV chip overlay inside
// the input. Typing '@' at the start of an empty input enables advanced mode;
// clearing the input fully exits it. The keyboard shortcut hint on the right
// fades when the input is focused.
function HeroSearch({ query, setQuery, inputRef }: {
  query: string
  setQuery: (v: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const [focused, setFocused] = useState(false)
  const isAdvanced = query.startsWith('@')
  // The text the user sees inside the input (no leading '@')
  const visibleValue = isAdvanced ? query.slice(1) : query

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (isAdvanced) {
      // In advanced: prefix '@' to whatever the user types. Empty → exit advanced.
      setQuery(v === '' ? '' : '@' + v)
    } else {
      // Basic: typing '@' at the start enables advanced mode naturally.
      setQuery(v)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && isAdvanced && visibleValue === '') {
      e.preventDefault()
      setQuery('')
    }
  }

  const toggleAdvanced = () => {
    setQuery(isAdvanced ? visibleValue : '@' + visibleValue)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  // Layout constants for the absolute-positioned overlays.
  // The chip slot is always reserved (fixed label) so the input text never
  // jumps when toggling advanced mode.
  const CHIP_PAD = 100       // input padding-left — fits the ADV @ chip + breathing room
  const RIGHT_PAD = 44       // room for the keyboard shortcut hint

  // Border tracks focus only — advanced mode is communicated by the chip, not
  // by tinting the input border (which would compete with the chip color).
  const borderColor = focused ? 'var(--accent-interactive)' : 'var(--border-strong)'

  // Amber palette for the ADV chip — distinct from accent-interactive (purple)
  // so the chip and the focused input border don't blend into one color.
  const ADV_AMBER = '#f59e0b'

  return (
    <div style={{ flex: 1, position: 'relative', height: 40, minWidth: 0 }}>
      {/* Search icon — decorative, anchors the left side */}
      <svg
        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{
          position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-2)', pointerEvents: 'none',
        }}
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>

      {/* Mode chip — fixed label 'ADV @'. Amber when active (solid fill, dark
          text); subtle outline when inactive. Click toggles. */}
      <button
        onMouseDown={(e) => e.preventDefault() /* don't steal focus from input */}
        onClick={toggleAdvanced}
        title={isAdvanced ? 'Advanced mode on — click to disable' : 'Enable advanced search mode'}
        style={{
          position: 'absolute', left: 38, top: '50%', transform: 'translateY(-50%)',
          height: 24, padding: '0 9px',
          display: 'flex', alignItems: 'center', gap: 5,
          borderRadius: 5,
          border: `1px solid ${isAdvanced ? ADV_AMBER : 'var(--border-strong)'}`,
          background: isAdvanced ? ADV_AMBER : 'var(--bg-2)',
          color: isAdvanced ? '#1a1305' : 'var(--text-2)',
          fontSize: 10, fontWeight: 800, fontFamily: 'var(--font-mono)',
          letterSpacing: '0.08em', cursor: 'pointer', userSelect: 'none',
          boxShadow: isAdvanced ? `0 0 0 2px color-mix(in srgb, ${ADV_AMBER} 22%, transparent)` : 'none',
          transition: 'color 0.12s, border-color 0.12s, background 0.12s, box-shadow 0.12s',
        }}
        onMouseEnter={(e) => {
          if (!isAdvanced) {
            e.currentTarget.style.color = ADV_AMBER
            e.currentTarget.style.borderColor = ADV_AMBER
          }
        }}
        onMouseLeave={(e) => {
          if (!isAdvanced) {
            e.currentTarget.style.color = 'var(--text-2)'
            e.currentTarget.style.borderColor = 'var(--border-strong)'
          }
        }}
      >
        ADV
        <span style={{ fontSize: 12, lineHeight: 1, fontWeight: 700 }}>@</span>
      </button>

      {/* Input — single bordered field, no merged buttons */}
      <input
        ref={inputRef}
        value={visibleValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={isAdvanced ? 'fr matrix 1999 …' : 'Search your library…'}
        style={{
          width: '100%', height: '100%',
          background: 'var(--bg-3)',
          border: `1px solid ${borderColor}`,
          borderRadius: 8,
          color: 'var(--text-0)', fontSize: 14,
          paddingLeft: CHIP_PAD,
          paddingRight: RIGHT_PAD,
          outline: 'none',
          transition: 'border-color 0.12s, padding-left 0.12s',
          fontFamily: 'var(--font-ui)',
          boxSizing: 'border-box',
        }}
      />

      {/* Keyboard shortcut hint — fades when input is focused */}
      <div
        aria-hidden
        style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          opacity: focused ? 0 : 1,
          transition: 'opacity 0.12s',
          pointerEvents: 'none',
          display: 'flex', alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
            color: 'var(--text-2)',
            background: 'var(--bg-2)',
            border: '1px solid var(--border-strong)',
            borderRadius: 4,
            padding: '2px 7px',
            boxShadow: 'inset 0 -1px 0 var(--border-strong)',
          }}
        >
          /
        </span>
      </div>
    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

interface Props {
  onSelectContent: (item: ContentItem) => void
}

export function HomeView({ onSelectContent }: Props) {
  const {
    setView, selectedSourceIds,
    homeMode, setHomeMode,
    setShowSources, setChannelSurfContext,
  } = useAppStore()
  const { queries, setQuery, seedQuery } = useSearchStore()
  const query = queries['home'] ?? ''
  const { sources } = useSourcesStore()
  const { theme } = useTheme()
  const inputRef = useRef<HTMLInputElement>(null)

  // Favorite channels (old schema) — drives Discover mode prompt + Discover row
  // Favorite channels (new schema) — single source of truth for both modes
  const { data: channelsFavData = [], isSuccess: channelsFavLoaded } = useQuery<ContentItem[]>({
    queryKey: ['channels', 'favorites'],
    queryFn: () => api.channels.favorites(),
    staleTime: 30_000,
  })
  // Filter new-schema favorites by selected source (same logic as old)
  const favChannels = selectedSourceIds.length > 0
    ? channelsFavData.filter((c) => {
        const srcId = c.primarySourceId ?? c.primary_source_id ?? (c as any).source_ids ?? c.id?.split(':')[0]
        return srcId ? selectedSourceIds.includes(srcId) : true
      })
    : channelsFavData

  const effectiveMode = homeMode

  // Capture surf context — use filtered list so surfing stays within active source filter
  const handleSelectContent = useCallback((item: ContentItem) => {
    if (item.type === 'live') {
      const idx = favChannels.findIndex((c) => c.id === item.id)
      const action = effectiveMode === 'channels' ? 'home-channels' : 'home-discover'
      setChannelSurfContext(favChannels, idx >= 0 ? idx : 0, action)
    }
    onSelectContent(item)
  }, [favChannels, effectiveMode, onSelectContent, setChannelSurfContext])

  // No auto-fallback — let My Channels show an empty state instead

  // Focus search on /
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // First-launch: no sources at all
  if (sources.length === 0) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        padding: 32, textAlign: 'center',
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <div>
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)', marginBottom: 6, fontFamily: 'var(--font-ui)' }}>
            No sources yet
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-1)', fontFamily: 'var(--font-ui)', lineHeight: 1.5, maxWidth: 280 }}>
            Add an Xtream Codes account to start browsing your IPTV library.
          </p>
        </div>
        <button
          onClick={() => setShowSources(true)}
          style={{
            padding: '10px 24px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'var(--accent-interactive)', border: 'none', color: '#fff',
            cursor: 'pointer', fontFamily: 'var(--font-ui)',
          }}
        >
          Add source
        </button>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Hero area — search + mode toggle (always visible) + info strip */}
      <div style={{
        padding: '12px 24px 10px',
        borderBottom: '1px solid var(--border-default)',
        background: `radial-gradient(ellipse 80% 250% at 50% 100%, color-mix(in srgb, var(--accent-interactive) ${theme === 'dark' ? '25%' : '6%'}, transparent), transparent), var(--bg-1)`,
        display: 'flex', flexDirection: 'column', gap: 6,
        flexShrink: 0,
      }}>
        {/* Row 1 — search input + mode toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <HeroSearch query={query} setQuery={setQuery} inputRef={inputRef} />

          {/* Mode toggle — Discover is active during search; TV clears search and switches */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {(['discover', 'channels'] as const).map((m) => {
              // During search, treat Discover as active regardless of stored mode.
              const active = query ? m === 'discover' : homeMode === m
              const label = m === 'discover' ? 'Discover' : 'TV'
              const color = m === 'discover' ? 'var(--accent-interactive)' : 'var(--accent-live)'
              return (
                <button
                  key={m}
                  onClick={() => {
                    if (query) {
                      // Clicking TV during search → clear search and go to TV
                      if (m === 'channels') { setQuery(''); setHomeMode('channels') }
                      // Clicking Discover during search → no-op (already showing search results)
                    } else {
                      setHomeMode(m)
                    }
                  }}
                  style={{
                    width: 78, height: 32, borderRadius: 7,
                    fontSize: 12, fontWeight: 600,
                    cursor: (query && m === 'discover') ? 'default' : 'pointer',
                    fontFamily: 'var(--font-ui)', letterSpacing: '0.01em',
                    border: `1px solid ${active ? color : 'var(--border-default)'}`,
                    background: active ? `color-mix(in srgb, ${color} 12%, var(--bg-2))` : 'var(--bg-2)',
                    color: active ? color : 'var(--text-2)',
                    transition: 'border-color 0.12s, background 0.12s, color 0.12s',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Row 2 — informative strip (always present, never collapses) */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: 'var(--text-2)',
          fontFamily: 'var(--font-ui)',
          height: 14, lineHeight: '14px',
          paddingLeft: 2,
        }}>
          <span>{getGreeting()}</span>
          {sources.length > 0 && (
            <>
              <span style={{ color: 'var(--border-default)', fontSize: 10 }}>·</span>
              <span>{sources.reduce((sum, s) => sum + (s.itemCount ?? 0), 0).toLocaleString()} titles</span>
              <span style={{ color: 'var(--border-default)', fontSize: 10 }}>·</span>
              <span>{sources.length} {sources.length === 1 ? 'source' : 'sources'}</span>
            </>
          )}
        </div>
      </div>

      {/* Content area — scrollable */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: query ? '16px 24px' : '20px 24px 16px',
        display: 'flex', flexDirection: 'column', gap: query ? 0 : 24,
        position: 'relative',
      }}>
        {query ? (
          <HomeSearchResults query={query} onSelectContent={onSelectContent} />
        ) : effectiveMode === 'channels'
          ? (channelsFavLoaded && channelsFavData.length === 0
              ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40, color: 'var(--text-2)' }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.35 }}>
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>No favourite channels yet</p>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0, textAlign: 'center', maxWidth: 260, lineHeight: 1.6 }}>
                    Heart a channel from Live TV to add it here. Your list will be saved and reorderable.
                  </p>
                  <button
                    onClick={() => setView('live')}
                    style={{ marginTop: 4, padding: '7px 18px', borderRadius: 7, fontSize: 12, fontWeight: 600, background: 'var(--accent-interactive)', border: 'none', color: '#fff', cursor: 'pointer' }}
                  >
                    Browse Live TV
                  </button>
                </div>
              )
              : channelsFavLoaded && favChannels.length === 0
              ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>No channels from selected source</p>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0 }}>Switch source filter to see your favourites.</p>
                </div>
              )
              : <ChannelsMode items={favChannels} allItems={channelsFavData} onSelectContent={handleSelectContent} />
            )
          : <DiscoverMode favChannels={favChannels} selectedSourceIds={selectedSourceIds} onSelectContent={handleSelectContent} onNavigate={(t) => t === 'channels' ? setHomeMode('channels') : setView(t as any)} />
        }

      </div>
    </div>
  )
}

// ── Discover mode ────────────────────────────────────────────────

function DiscoverMode({ favChannels, selectedSourceIds, onSelectContent, onNavigate }: {
  favChannels: ContentItem[]
  selectedSourceIds: string[]
  onSelectContent: (item: ContentItem) => void
  onNavigate: (target: 'channels' | 'library' | 'films' | 'series') => void
}) {
  const STRIP_MAX = useAppStore((s) => s.homeStripSize)
  const STRIP_FETCH = STRIP_MAX + 1

  const filterBySrc = (items: ContentItem[]) =>
    selectedSourceIds.length > 0
      ? items.filter((i) => {
          const s = i.primarySourceId ?? i.primary_source_id ?? (i as any).source_ids ?? i.id?.split(':')[0]
          return s ? selectedSourceIds.includes(s) : true
        })
      : items

  const { data: watchlistRaw = [], isLoading: watchlistLoading } = useQuery<ContentItem[]>({
    queryKey: ['home-watchlist'],
    queryFn: () => api.user.watchlist(),
    staleTime: 30_000,
  })
  const { data: continueRaw = [], isLoading: continueLoading } = useQuery<ContentItem[]>({
    queryKey: ['home-continue'],
    queryFn: () => api.user.continueWatching(),
    staleTime: 30_000,
  })
  const { data: moviesData, isLoading: moviesLoading } = useQuery({
    queryKey: ['home-latest-movies', selectedSourceIds],
    queryFn: () => api.content.browse({ type: 'movie', sortBy: 'updated', sortDir: 'desc', limit: STRIP_FETCH, offset: 0, sourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined }),
    staleTime: 60_000,
  })
  const { data: seriesData, isLoading: seriesLoading } = useQuery({
    queryKey: ['home-latest-series', selectedSourceIds],
    queryFn: () => api.content.browse({ type: 'series', sortBy: 'updated', sortDir: 'desc', limit: STRIP_FETCH, offset: 0, sourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined }),
    staleTime: 60_000,
  })

  const watchlist = filterBySrc(watchlistRaw)
  const continueItems = filterBySrc(continueRaw)
  const movies = (moviesData?.items ?? []) as ContentItem[]
  const series = (seriesData?.items ?? []) as ContentItem[]

  const allLoading = watchlistLoading || continueLoading || moviesLoading || seriesLoading
  const allEmpty = !allLoading && favChannels.length === 0 && continueItems.length === 0 && watchlist.length === 0 && movies.length === 0 && series.length === 0

  if (allEmpty) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '64px 24px', textAlign: 'center' }}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.25" strokeLinecap="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 6px', fontFamily: 'var(--font-ui)' }}>Nothing here yet</p>
          <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0, lineHeight: 1.5, maxWidth: 280, fontFamily: 'var(--font-ui)' }}>
            Sync a source, browse channels, and start watching to populate your home screen.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <DiscoverStrip
        title="Favourite Channels" accent="var(--accent-live)" type="live"
        items={favChannels} hasMore={favChannels.length > STRIP_MAX} isLoading={false}
        onMore={() => onNavigate('channels')} onSelectContent={onSelectContent} stripMax={STRIP_MAX}
      />
      <DiscoverStrip
        title="Continue Watching" accent="var(--accent-film)" type="movie"
        items={continueItems} hasMore={continueItems.length > STRIP_MAX} isLoading={continueLoading}
        onMore={() => onNavigate('library')} onSelectContent={onSelectContent} stripMax={STRIP_MAX}
      />
      <DiscoverStrip
        title="Watchlist" accent="var(--accent-interactive)" type="movie"
        items={watchlist} hasMore={watchlist.length > STRIP_MAX} isLoading={watchlistLoading}
        onMore={() => onNavigate('library')} onSelectContent={onSelectContent} stripMax={STRIP_MAX}
      />
      <DiscoverStrip
        title="Latest Movies" accent="var(--accent-film)" type="movie"
        items={movies} hasMore={movies.length > STRIP_MAX} isLoading={moviesLoading}
        onMore={() => onNavigate('films')} onSelectContent={onSelectContent} stripMax={STRIP_MAX}
      />
      <DiscoverStrip
        title="Latest Series" accent="var(--accent-series)" type="series"
        items={series} hasMore={series.length > STRIP_MAX} isLoading={seriesLoading}
        onMore={() => onNavigate('series')} onSelectContent={onSelectContent} stripMax={STRIP_MAX}
      />
    </div>
  )
}

function DiscoverStrip({ title, accent, type, items, hasMore, isLoading, onMore, onSelectContent, stripMax, rows = 1 }: {
  title: string
  accent: string
  type: 'live' | 'movie' | 'series'
  items: ContentItem[]
  hasMore: boolean
  isLoading: boolean
  onMore: () => void
  onSelectContent: (item: ContentItem) => void
  stripMax: number
  rows?: number
}) {
  if (!isLoading && items.length === 0) return null
  const displayCap = stripMax * rows
  const visible = items.slice(0, displayCap)
  const skeletonCount = displayCap

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '20px 0',
      borderTop: '1px solid var(--border-subtle)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {type === 'live' && (
            <span style={{
              width: 7, height: 7, borderRadius: '50%', background: accent,
              display: 'inline-block', flexShrink: 0, boxShadow: `0 0 6px ${accent}`,
            }} />
          )}
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-0)' }}>
            {title}
          </span>
          {!isLoading && (
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              {items.length > displayCap ? `${displayCap}+` : items.length}
            </span>
          )}
        </div>
        {hasMore && (
          <button
            onClick={onMore}
            style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--text-1)', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = accent }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-1)' }}
          >
            More →
          </button>
        )}
      </div>

      {/* Cards — equal-width grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${stripMax}, 1fr)`,
        gap: 8,
      }}>
        {isLoading
          ? Array.from({ length: skeletonCount }).map((_, i) =>
              type === 'live' ? <ChannelSkeleton key={i} /> : <PosterSkeleton key={i} />
            )
          : visible.map((item) =>
              type === 'live'
                ? <RichChannelCard key={item.id} item={item} onClick={onSelectContent} />
                : <RichPosterCard key={item.id} item={item} onClick={onSelectContent} />
            )
        }
      </div>
    </div>
  )
}

// ── Channels mode (sortable favorite channels grid) ──────────────

function ChannelsMode({ items, allItems, onSelectContent }: {
  items: ContentItem[]
  allItems: ContentItem[]
  onSelectContent: (item: ContentItem) => void
}) {
  const sources = useSourcesStore((s) => s.sources)
  const colorMap = buildColorMapFromSources(sources)
  const showSourceBar = sources.filter((s) => !s.disabled).length > 1
  const qc = useQueryClient()

  // Local order state — initialised from full unfiltered list to preserve order across source filter toggles
  const [orderedIds, setOrderedIds] = useState<string[]>(() => allItems.map((i) => i.id))

  // Keep in sync with the full list (new favorites added/removed from server)
  useEffect(() => {
    setOrderedIds((prev) => {
      const incoming = allItems.map((i) => i.id)
      // Preserve existing order, append any new ids, drop removed ones
      const kept = prev.filter((id) => incoming.includes(id))
      const added = incoming.filter((id) => !prev.includes(id))
      return [...kept, ...added]
    })
  }, [allItems])

  // Display only channels present in the filtered items list, in the global order
  const visibleIds = new Set(items.map((i) => i.id))
  const orderedItems = orderedIds
    .filter((id) => visibleIds.has(id))
    .map((id) => items.find((i) => i.id === id))
    .filter(Boolean) as ContentItem[]

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = orderedIds.indexOf(active.id as string)
    const newIndex = orderedIds.indexOf(over.id as string)
    const previousOrder = orderedIds
    const newOrder = arrayMove(orderedIds, oldIndex, newIndex)
    setOrderedIds(newOrder)

    // Persist to DB — rollback if it fails
    try {
      const canonicalMap = Object.fromEntries(allItems.map((i) => [i.id, i.canonical_id ?? i.id]))
      const payload = newOrder.map((id, idx) => ({ canonicalId: canonicalMap[id] ?? id, sortOrder: idx }))
      await api.channels.reorderFavorites(payload)
      qc.invalidateQueries({ queryKey: ['channels', 'favorites'] })
    } catch {
      setOrderedIds(previousOrder) // rollback to original order
    }
  }, [orderedIds, allItems, qc])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'var(--accent-live)',
            display: 'inline-block', flexShrink: 0,
            boxShadow: '0 0 6px var(--accent-live)',
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-0)' }}>
            Favorite Channels
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
            {orderedItems.length}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-ui)' }}>
            drag to reorder
          </span>
        </div>
      </div>

      {/* Sortable grid */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedIds} strategy={rectSortingStrategy}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 10,
          }}>
            {orderedItems.map((item) => {
              const primarySrcId = item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]
              const srcColor = showSourceBar && primarySrcId ? colorMap[primarySrcId]?.accent : undefined
              return (
                <SortableFavCard
                  key={item.id}
                  item={item}
                  sourceColor={srcColor}
                  onClick={onSelectContent}
                />
              )
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

// ── Sortable wrapper for FavChannelCard ───────────────────────────

function SortableFavCard({ item, sourceColor, onClick }: {
  item: ContentItem
  sourceColor?: string
  onClick: (item: ContentItem) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      {...attributes}
      {...listeners}
    >
      <FavChannelCard
        item={item}
        sourceColor={sourceColor}
        onClick={onClick}
        isDragging={isDragging}
      />
    </div>
  )
}

// ── Favorite channel card (Mode B) ──────────────────────────────

function FavChannelCard({ item, sourceColor, onClick, isDragging }: {
  item: ContentItem
  sourceColor?: string
  onClick: (item: ContentItem) => void
  isDragging?: boolean
}) {
  const logo = item.posterUrl ?? item.poster_url
  const [imgError, setImgError] = useState(false)
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={() => { if (!isDragging) onClick(item) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--bg-2)',
        borderRadius: 8,
        border: `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border-default)'}`,
        overflow: 'hidden',
        cursor: 'inherit',
        transition: 'border-color 0.1s',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {/* Source color bar */}
      {sourceColor && (
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: 3, background: sourceColor, zIndex: 1,
        }} />
      )}

      {/* Logo area — 16:9 */}
      <div style={{
        aspectRatio: '16/9',
        background: 'var(--bg-3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        {logo && !imgError
          ? <img
              src={logo}
              alt=""
              onError={() => setImgError(true)}
              style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 10 }}
            />
          : <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.05em' }}>
              {item.title.slice(0, 4).toUpperCase()}
            </span>
        }

        {/* Play overlay on hover */}
        {hovered && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--accent-interactive)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Name row */}
      <div style={{
        padding: '7px 10px 8px',
        display: 'flex', alignItems: 'center', gap: 6,
        paddingLeft: sourceColor ? 14 : 10,
      }}>
        <span style={{
          flex: 1, fontSize: 11, fontWeight: 500,
          color: hovered ? 'var(--text-0)' : 'var(--text-1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          transition: 'color 0.1s',
        }}>
          {item.title}
        </span>
        {/* Live dot */}
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: 'var(--accent-live)', flexShrink: 0,
        }} />
      </div>
    </div>
  )
}

// ── Cards ─────────────────────────────────────────────────────────

function PosterSkeleton() {
  return (
    <div style={{ width: '100%', borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
      <div style={{ aspectRatio: '2/3', background: 'linear-gradient(90deg, var(--bg-2) 25%, var(--bg-3) 50%, var(--bg-2) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
      <div style={{ padding: '6px 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ height: 10, borderRadius: 3, background: 'var(--bg-3)', width: '80%' }} />
        <div style={{ height: 8, borderRadius: 3, background: 'var(--bg-3)', width: '50%' }} />
      </div>
    </div>
  )
}

function ChannelSkeleton() {
  return (
    <div style={{ width: '100%', borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
      <div style={{ aspectRatio: '16/9', background: 'linear-gradient(90deg, var(--bg-2) 25%, var(--bg-3) 50%, var(--bg-2) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
      <div style={{ padding: '6px 8px 8px' }}>
        <div style={{ height: 10, borderRadius: 3, background: 'var(--bg-3)', width: '70%' }} />
      </div>
    </div>
  )
}

// ── Inline search results for Home view ──────────────────────────
// Shown inside HomeView when query is non-empty so the bottom search
// bar never unmounts (and never loses focus).

const SEARCH_FETCH_LIMIT = 200

function HomeSearchResults({ query, onSelectContent }: { query: string; onSelectContent: (item: ContentItem) => void }) {
  const { selectedSourceIds, setChannelSurfContext, setView } = useAppStore()
  const { seedQuery } = useSearchStore()
  const STRIP_MAX = useAppStore((s) => s.homeStripSize)
  const SEARCH_ROWS = 2

  const searchArgs = (type: 'live' | 'movie' | 'series') => ({
    query, type, sourceIds: selectedSourceIds.length ? selectedSourceIds : undefined, limit: SEARCH_FETCH_LIMIT,
  })

  const { data: liveData, isFetching: liveFetching } = useQuery({
    queryKey: ['search', query, 'live', selectedSourceIds],
    queryFn: () => api.search.query(searchArgs('live')),
    staleTime: 10_000, enabled: !!query,
  })
  const { data: movieData, isFetching: movieFetching } = useQuery({
    queryKey: ['search', query, 'movie', selectedSourceIds],
    queryFn: () => api.search.query(searchArgs('movie')),
    staleTime: 10_000, enabled: !!query,
  })
  const { data: seriesData, isFetching: seriesFetching } = useQuery({
    queryKey: ['search', query, 'series', selectedSourceIds],
    queryFn: () => api.search.query(searchArgs('series')),
    staleTime: 10_000, enabled: !!query,
  })

  const liveResults = (liveData?.items ?? []) as ContentItem[]
  const movieResults = (movieData?.items ?? []) as ContentItem[]
  const seriesResults = (seriesData?.items ?? []) as ContentItem[]

  const isFetching = liveFetching || movieFetching || seriesFetching
  const hasResults = liveResults.length > 0 || movieResults.length > 0 || seriesResults.length > 0

  const handleSelect = useCallback((item: ContentItem) => {
    if (item.type === 'live') {
      const displayCap = STRIP_MAX * SEARCH_ROWS
      const liveForSurf = liveResults.slice(0, displayCap)
      const idx = liveForSurf.findIndex((i) => i.id === item.id)
      setChannelSurfContext(liveForSurf, idx >= 0 ? idx : 0, 'home-channels')
    }
    onSelectContent(item)
  }, [liveResults, STRIP_MAX, onSelectContent, setChannelSurfContext])

  if (isFetching && !hasResults) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, color: 'var(--text-2)', fontSize: 13 }}>
        Searching…
      </div>
    )
  }

  if (!isFetching && !hasResults) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 8, textAlign: 'center' }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>No results for "{query.startsWith('@') ? query.slice(1).trim() : query}"</p>
        <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0 }}>Try a different search term</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <DiscoverStrip
        title="Live Channels" accent="var(--accent-live)" type="live"
        items={liveResults as ContentItem[]} isLoading={liveFetching && liveResults.length === 0}
        hasMore={liveResults.length > STRIP_MAX * SEARCH_ROWS}
        onMore={() => { seedQuery('live', query); setView('live') }}
        onSelectContent={handleSelect}
        stripMax={STRIP_MAX} rows={SEARCH_ROWS}
      />
      <DiscoverStrip
        title="Movies" accent="var(--accent-film)" type="movie"
        items={movieResults as ContentItem[]} isLoading={movieFetching && movieResults.length === 0}
        hasMore={movieResults.length > STRIP_MAX * SEARCH_ROWS}
        onMore={() => { seedQuery('films', query); setView('films') }}
        onSelectContent={handleSelect}
        stripMax={STRIP_MAX} rows={SEARCH_ROWS}
      />
      <DiscoverStrip
        title="Series" accent="var(--accent-series)" type="series"
        items={seriesResults as ContentItem[]} isLoading={seriesFetching && seriesResults.length === 0}
        hasMore={seriesResults.length > STRIP_MAX * SEARCH_ROWS}
        onMore={() => { seedQuery('series', query); setView('series') }}
        onSelectContent={handleSelect}
        stripMax={STRIP_MAX} rows={SEARCH_ROWS}
      />
    </div>
  )
}
