import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const SearchResults = lazy(() =>
  import('@/components/search/SearchResults').then((m) => ({ default: m.SearchResults }))
)
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

interface Props {
  onSelectContent: (item: ContentItem) => void
}

export function HomeView({ onSelectContent }: Props) {
  const {
    setView, selectedSourceIds,
    homeMode, setHomeMode,
    hasSeenChannelsModePrompt, setHasSeenChannelsModePrompt,
    setShowSources, setChannelSurfContext,
  } = useAppStore()
  const { query, setQuery } = useSearchStore()
  const { sources } = useSourcesStore()
  const inputRef = useRef<HTMLInputElement>(null)

  // Favorite channels — drives both the prompt and Mode B content
  // selectedSourceIds applied client-side (favorites query doesn't support source filter yet)
  const { data: allFavChannels = [] } = useQuery<ContentItem[]>({
    queryKey: ['library', 'favorites', 'live'],
    queryFn: () => api.user.favorites({ type: 'live' }),
    staleTime: 30_000,
  })
  const favChannels = selectedSourceIds.length > 0
    ? allFavChannels.filter((c) => {
        const srcId = c.primarySourceId ?? c.primary_source_id ?? (c as any).source_ids ?? c.id?.split(':')[0]
        return srcId ? selectedSourceIds.includes(srcId) : true
      })
    : allFavChannels

  const hasFavChannels = favChannels.length > 0
  const effectiveMode = homeMode

  // Capture surf context for live channels launched from home
  const handleSelectContent = useCallback((item: ContentItem) => {
    if (item.type === 'live') {
      const idx = favChannels.findIndex((c) => c.id === item.id)
      setChannelSurfContext(favChannels, idx >= 0 ? idx : 0)
    }
    onSelectContent(item)
  }, [favChannels, onSelectContent, setChannelSurfContext])

  // Show the "switch to channels mode" prompt once, on mount, when conditions are met
  const [showPrompt, setShowPrompt] = useState(false)
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (allFavChannels.length > 0 && !hasSeenChannelsModePrompt && homeMode === 'discover') {
      setShowPrompt(true)
      promptTimerRef.current = setTimeout(() => {
        setShowPrompt(false)
        setHasSeenChannelsModePrompt(true)
      }, 10_000)
    }
    return () => {
      if (promptTimerRef.current) clearTimeout(promptTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dismissPrompt = (switchMode: boolean) => {
    if (promptTimerRef.current) clearTimeout(promptTimerRef.current)
    setShowPrompt(false)
    setHasSeenChannelsModePrompt(true)
    if (switchMode) setHomeMode('channels')
  }

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

      {/* Hero area — search + mode toggle */}
      <div style={{
        padding: '10px 24px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0,
      }}>
        {/* Search input */}
        <div style={{ flex: 1, position: 'relative' }}>
          <svg
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-2)', pointerEvents: 'none' }}
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies, channels, actors…"
            style={{
              width: '100%', height: 34,
              background: 'var(--bg-2)',
              border: `1px solid ${query ? 'var(--accent-interactive)' : 'var(--border-default)'}`,
              borderRadius: 7, color: 'var(--text-0)',
              fontSize: 13, padding: '0 68px 0 34px', outline: 'none',
              transition: 'border-color 0.15s',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-interactive)' }}
            onBlur={(e) => { if (!query) e.currentTarget.style.borderColor = 'var(--border-default)' }}
          />
          <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {query && (
              <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', fontSize: 11, padding: '2px 4px' }}>
                clear
              </button>
            )}
            <kbd style={{ fontSize: 10, color: 'var(--text-3)', background: 'var(--bg-3)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-subtle)' }}>/</kbd>
          </div>
        </div>

        {/* Mode toggle */}
        {!query && (
          <div style={{
            display: 'flex', background: 'var(--bg-3)',
            borderRadius: 7, padding: 2, gap: 1, flexShrink: 0,
          }}>
            {(['discover', 'channels'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setHomeMode(m)}
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 5,
                  border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-ui)', fontWeight: 500,
                  background: homeMode === m ? 'var(--bg-1)' : 'transparent',
                  color: homeMode === m ? 'var(--text-0)' : 'var(--text-2)',
                  boxShadow: homeMode === m ? '0 1px 3px rgba(0,0,0,0.4)' : 'none',
                  transition: 'background 0.1s, color 0.1s',
                }}
              >
                {m === 'discover' ? 'Discover' : 'My Channels'}
              </button>
            ))}
          </div>
        )}
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
          ? hasFavChannels
            ? <ChannelsMode items={favChannels} onSelectContent={handleSelectContent} />
            : <EmptyChannelsMode onSwitchToDiscover={() => setHomeMode('discover')} onBrowseLive={() => setView('live')} />
          : <DiscoverMode favChannels={favChannels} selectedSourceIds={selectedSourceIds} onSelectContent={handleSelectContent} onBrowseAll={setView} />
        }

        {!query && showPrompt && (
          <SwitchModePrompt
            onSwitch={() => dismissPrompt(true)}
            onDismiss={() => dismissPrompt(false)}
          />
        )}
      </div>
    </div>
  )
}

// ── Discover mode (current layout) ───────────────────────────────

function DiscoverMode({ favChannels, selectedSourceIds, onSelectContent, onBrowseAll }: {
  favChannels: ContentItem[]
  selectedSourceIds: string[]
  onSelectContent: (item: ContentItem) => void
  onBrowseAll: (view: 'live' | 'films' | 'series') => void
}) {
  const hasFavChannels = favChannels.length > 0
  return (
    <>
      <ContentRow
        title={hasFavChannels ? 'Favorite Channels' : 'Channels'}
        type="live"
        accent="var(--accent-live)"
        showLiveDot
        pinnedItems={hasFavChannels ? favChannels : undefined}
        selectedSourceIds={selectedSourceIds}
        onSelectContent={onSelectContent}
        onBrowseAll={() => onBrowseAll('live')}
      />
      <ContentRow
        title="Continue Watching"
        type="movie"
        accent="var(--accent-film)"
        continueWatching
        selectedSourceIds={selectedSourceIds}
        onSelectContent={onSelectContent}
        onBrowseAll={() => onBrowseAll('films')}
      />
      <ContentRow
        title="Continue Watching"
        type="series"
        accent="var(--accent-series)"
        continueWatching
        selectedSourceIds={selectedSourceIds}
        onSelectContent={onSelectContent}
        onBrowseAll={() => onBrowseAll('series')}
      />
      <ContentRow
        title="Watch Later"
        type="movie"
        accent="var(--accent-interactive)"
        watchlist
        selectedSourceIds={selectedSourceIds}
        onSelectContent={onSelectContent}
        onBrowseAll={() => onBrowseAll('films')}
      />
    </>
  )
}

// ── Channels mode (sortable favorite channels grid) ──────────────

function ChannelsMode({ items, onSelectContent }: {
  items: ContentItem[]
  onSelectContent: (item: ContentItem) => void
}) {
  const sources = useSourcesStore((s) => s.sources)
  const colorMap = buildColorMapFromSources(sources)
  const showSourceBar = sources.filter((s) => !s.disabled).length > 1
  const qc = useQueryClient()

  // Local order state — initialised from server, updated optimistically on drag
  const [orderedIds, setOrderedIds] = useState<string[]>(() => items.map((i) => i.id))

  // Keep in sync if query refreshes (new favorites added/removed)
  useEffect(() => {
    setOrderedIds((prev) => {
      const incoming = items.map((i) => i.id)
      // Preserve existing order, append any new ids, drop removed ones
      const kept = prev.filter((id) => incoming.includes(id))
      const added = incoming.filter((id) => !prev.includes(id))
      return [...kept, ...added]
    })
  }, [items])

  const orderedItems = orderedIds
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
      const payload = newOrder.map((contentId, idx) => ({ contentId, sortOrder: idx }))
      await api.user.reorderFavorites(payload)
      qc.invalidateQueries({ queryKey: ['browse-favorites'] })
      qc.invalidateQueries({ queryKey: ['library', 'favorites'] })
    } catch {
      setOrderedIds(previousOrder) // rollback to original order
    }
  }, [orderedIds, qc])

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
      }}
      {...attributes}
    >
      <FavChannelCard
        item={item}
        sourceColor={sourceColor}
        onClick={onClick}
        dragListeners={listeners}
        isDragging={isDragging}
      />
    </div>
  )
}

// ── Favorite channel card (Mode B) ──────────────────────────────

function FavChannelCard({ item, sourceColor, onClick, dragListeners, isDragging }: {
  item: ContentItem
  sourceColor?: string
  onClick: (item: ContentItem) => void
  dragListeners?: Record<string, unknown>
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
        cursor: isDragging ? 'grabbing' : 'pointer',
        transition: 'border-color 0.1s',
        position: 'relative',
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
        {/* Drag handle — visible on hover */}
        {hovered && dragListeners && (
          <span
            {...dragListeners}
            onClick={(e) => e.stopPropagation()}
            title="Drag to reorder"
            style={{
              cursor: 'grab', color: 'var(--text-3)', display: 'flex',
              alignItems: 'center', flexShrink: 0, padding: '0 2px',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
              <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
              <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
            </svg>
          </span>
        )}
      </div>
    </div>
  )
}

// ── Switch mode prompt ────────────────────────────────────────────

function SwitchModePrompt({ onSwitch, onDismiss }: { onSwitch: () => void; onDismiss: () => void }) {
  return (
    <div style={{
      position: 'sticky', bottom: 0,
      marginTop: 'auto',
      background: 'var(--bg-2)',
      border: '1px solid var(--border-default)',
      borderRadius: 12,
      padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 14,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      animation: 'slideUpPrompt 0.2s ease-out',
    }}>
      {/* Icon */}
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: 'color-mix(in srgb, var(--accent-live) 14%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-live)" strokeWidth="2" strokeLinecap="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginBottom: 2 }}>
          You have favorite channels saved
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.4 }}>
          Want your home screen to show your favorite channels instead?
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={onDismiss}
          style={{
            padding: '7px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
            background: 'transparent',
            border: '1px solid var(--border-default)',
            color: 'var(--text-1)',
            fontFamily: 'var(--font-ui)',
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          Keep current
        </button>
        <button
          onClick={onSwitch}
          style={{
            padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: 'var(--accent-interactive)',
            border: 'none',
            color: '#fff',
            fontFamily: 'var(--font-ui)',
            transition: 'opacity 0.1s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          Switch
        </button>
      </div>
    </div>
  )
}

// ── Empty channels mode ───────────────────────────────────────────

function EmptyChannelsMode({ onSwitchToDiscover, onBrowseLive }: {
  onSwitchToDiscover: () => void
  onBrowseLive: () => void
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 12, padding: '48px 24px', textAlign: 'center',
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14,
        background: 'color-mix(in srgb, var(--accent-live) 12%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-live)" strokeWidth="1.75" strokeLinecap="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)', marginBottom: 6 }}>
          No favorite channels yet
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.5, maxWidth: 320 }}>
          Browse your channels and tap the heart icon to add favorites. They'll appear here for quick access.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          onClick={onBrowseLive}
          style={{
            padding: '9px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: 'var(--accent-interactive)', border: 'none', color: '#fff',
            fontFamily: 'var(--font-ui)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          Browse channels
        </button>
        <button
          onClick={onSwitchToDiscover}
          style={{
            padding: '9px 18px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--border-default)',
            color: 'var(--text-1)', fontFamily: 'var(--font-ui)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          Switch to Discover
        </button>
      </div>
    </div>
  )
}

// ── Content Row (Discover mode) ───────────────────────────────────

interface RowProps {
  title: string
  type: 'live' | 'movie' | 'series'
  accent: string
  showLiveDot?: boolean
  /** If set, use these items directly instead of fetching */
  pinnedItems?: ContentItem[]
  /** If true, fetch in-progress items (not completed) instead of latest */
  continueWatching?: boolean
  /** If true, fetch watchlisted items (movies + series combined) */
  watchlist?: boolean
  /** Filter results to these source IDs (empty = all) */
  selectedSourceIds?: string[]
  onSelectContent: (item: ContentItem) => void
  onBrowseAll: () => void
}

function ContentRow({ title, type, accent, showLiveDot, pinnedItems, continueWatching: isContinueWatching, watchlist: isWatchlist, selectedSourceIds = [], onSelectContent, onBrowseAll }: RowProps) {
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [showCats, setShowCats] = useState(false)

  const isSpecial = !!pinnedItems || isContinueWatching || isWatchlist

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', type],
    queryFn: () => api.categories.list({ type }),
    staleTime: 60_000,
    enabled: !isSpecial,
  })

  // Continue watching query (movies/series in progress)
  const { data: continueData = [] } = useQuery<ContentItem[]>({
    queryKey: ['home-continue', type],
    queryFn: () => api.user.continueWatching({ type: type as 'movie' | 'series' }),
    staleTime: 30_000,
    enabled: !!isContinueWatching,
  })

  // Watchlist query — combined movies + series (ignores `type` param, fetches all)
  const { data: watchlistData = [] } = useQuery<ContentItem[]>({
    queryKey: ['home-watchlist'],
    queryFn: () => api.user.watchlist(),
    staleTime: 30_000,
    enabled: !!isWatchlist,
  })

  // Default browse query (only when not pinned and not continue watching)
  const { data: browseData } = useQuery({
    queryKey: ['home-row', type, activeCat],
    queryFn: () => api.content.browse({
      type,
      categoryName: activeCat ?? undefined,
      sortBy: 'updated',
      sortDir: 'desc',
      limit: 20,
      offset: 0,
    }),
    staleTime: 30_000,
    enabled: !isSpecial,
  })

  // Determine which items to show
  let items: ContentItem[]
  if (pinnedItems) {
    items = pinnedItems
  } else if (isContinueWatching) {
    // Apply source filter client-side
    items = selectedSourceIds.length > 0
      ? continueData.filter((item) => {
          const srcId = item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]
          return srcId ? selectedSourceIds.includes(srcId) : true
        })
      : continueData
  } else if (isWatchlist) {
    items = selectedSourceIds.length > 0
      ? watchlistData.filter((item) => {
          const srcId = item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]
          return srcId ? selectedSourceIds.includes(srcId) : true
        })
      : watchlistData
  } else {
    items = (browseData?.items ?? []) as ContentItem[]
  }

  // Don't render the row at all if it's a special row with nothing to show
  if ((isContinueWatching || isWatchlist) && items.length === 0) return null

  const showGenreToggle = !isSpecial && (categories as any[]).length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Row header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {showLiveDot && (
            <span style={{
              width: 7, height: 7, borderRadius: '50%', background: accent,
              display: 'inline-block', flexShrink: 0,
              boxShadow: `0 0 6px ${accent}`,
            }} />
          )}
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-0)' }}>
            {title}
          </span>
          {/* Type badge for special rows */}
          {isContinueWatching && (
            <span style={{
              fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              padding: '1px 5px', borderRadius: 3,
              background: `color-mix(in srgb, ${accent} 14%, transparent)`,
              color: accent,
            }}>
              {type === 'movie' ? 'Movies' : 'Series'}
            </span>
          )}
          {isWatchlist && (
            <span style={{
              fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              padding: '1px 5px', borderRadius: 3,
              background: `color-mix(in srgb, ${accent} 14%, transparent)`,
              color: accent,
            }}>
              Movies &amp; Series
            </span>
          )}
          {showGenreToggle && (
            <button
              onClick={() => setShowCats((v) => !v)}
              style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 11,
                background: showCats ? 'var(--bg-3)' : 'var(--bg-2)',
                border: `1px solid ${showCats ? 'var(--border-strong)' : 'var(--border-default)'}`,
                color: showCats ? 'var(--text-1)' : 'var(--text-2)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
              }}
            >
              {activeCat ?? 'Genre'} {showCats ? '▴' : '▾'}
            </button>
          )}
        </div>
        <button
          onClick={onBrowseAll}
          style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--text-1)', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = accent }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-1)' }}
        >
          Browse all →
        </button>
      </div>

      {/* Category pills */}
      {showCats && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
          <Pill label="All" active={activeCat === null} accent={accent} onClick={() => setActiveCat(null)} />
          {(categories as any[]).slice(0, 20).map((c: any) => (
            <Pill key={c.name} label={c.name} active={activeCat === c.name} accent={accent} onClick={() => setActiveCat(c.name)} />
          ))}
        </div>
      )}

      {/* Cards */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
        {items.length === 0
          ? Array.from({ length: 8 }).map((_, i) => (
              type === 'live' ? <ChannelSkeleton key={i} /> : <PosterSkeleton key={i} />
            ))
          : items.map((item) => (
              type === 'live'
                ? <ChannelCard key={item.id} item={item} accent={accent} onClick={onSelectContent} />
                : <PosterCard key={item.id} item={item} onClick={onSelectContent} />
            ))
        }
      </div>
    </div>
  )
}

function Pill({ label, active, accent, onClick }: { label: string; active: boolean; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0, padding: '3px 11px', borderRadius: 20, fontSize: 11,
        border: `1px solid ${active ? 'var(--border-strong)' : 'var(--border-default)'}`,
        color: active ? accent : 'var(--text-1)',
        background: active ? 'var(--bg-3)' : 'var(--bg-2)',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >{label}</button>
  )
}

// ── Cards ─────────────────────────────────────────────────────────

function PosterCard({ item, onClick }: { item: ContentItem; onClick: (i: ContentItem) => void }) {
  const poster = item.posterUrl ?? item.poster_url
  const [imgError, setImgError] = useState(false)
  const isMovie = item.type === 'movie'

  return (
    <div
      onClick={() => onClick(item)}
      style={{ flexShrink: 0, width: 100, background: 'var(--bg-2)', borderRadius: 6, border: '1px solid var(--border-default)', overflow: 'hidden', cursor: 'pointer' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)' }}
    >
      <div style={{ aspectRatio: '2/3', background: 'var(--bg-3)', position: 'relative' }}>
        {poster && !imgError
          ? <img src={poster} alt="" onError={() => setImgError(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : null}
        <div style={{ position: 'absolute', bottom: 5, left: 5, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', padding: '2px 5px', borderRadius: 3, background: `color-mix(in srgb, ${isMovie ? 'var(--accent-film)' : 'var(--accent-series)'} 18%, transparent)`, color: isMovie ? 'var(--accent-film)' : 'var(--accent-series)', letterSpacing: '0.04em' }}>
          {isMovie ? 'Movie' : 'Series'}
        </div>
      </div>
      <div style={{ padding: '5px 7px 7px' }}>
        <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-0)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</p>
        <p style={{ fontSize: 9, color: 'var(--text-2)', margin: '2px 0 0' }}>
          {item.year}{(item.ratingTmdb ?? item.rating_tmdb) ? ` · ★${(item.ratingTmdb ?? item.rating_tmdb)!.toFixed(1)}` : ''}
        </p>
      </div>
    </div>
  )
}

function ChannelCard({ item, accent, onClick }: { item: ContentItem; accent: string; onClick: (i: ContentItem) => void }) {
  const logo = item.posterUrl ?? item.poster_url
  const [imgError, setImgError] = useState(false)

  return (
    <div
      onClick={() => onClick(item)}
      style={{ flexShrink: 0, width: 148, background: 'var(--bg-2)', borderRadius: 6, border: '1px solid var(--border-default)', overflow: 'hidden', cursor: 'pointer' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)' }}
    >
      <div style={{ aspectRatio: '16/9', background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {logo && !imgError
          ? <img src={logo} alt="" onError={() => setImgError(true)} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8 }} />
          : <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.05em' }}>{item.title.slice(0, 4).toUpperCase()}</span>}
      </div>
      <div style={{ padding: '5px 8px 7px' }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-0)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</p>
      </div>
    </div>
  )
}

// Suppress unused accent warning (used for hover color in ChannelCard row header)
void ((_: string) => _)

function PosterSkeleton() {
  return <div style={{ flexShrink: 0, width: 100, borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border-default)' }}><div style={{ aspectRatio: '2/3' }} /><div style={{ height: 32 }} /></div>
}

function ChannelSkeleton() {
  return <div style={{ flexShrink: 0, width: 148, borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border-default)' }}><div style={{ aspectRatio: '16/9' }} /><div style={{ height: 28 }} /></div>
}

// ── Inline search results for Home view ──────────────────────────
// Shown inside HomeView when query is non-empty so the bottom search
// bar never unmounts (and never loses focus).

const SEARCH_INIT = 21
const SEARCH_FULL = 9999
const SEARCH_INITIAL_CAP = 20

function HomeSearchResults({ query, onSelectContent }: { query: string; onSelectContent: (item: ContentItem) => void }) {
  const { selectedSourceIds, setChannelSurfContext } = useAppStore()

  const [liveLimit, setLiveLimit] = useState(SEARCH_INIT)
  const [movieLimit, setMovieLimit] = useState(SEARCH_INIT)
  const [seriesLimit, setSeriesLimit] = useState(SEARCH_INIT)

  // Reset limits when query changes
  useEffect(() => { setLiveLimit(SEARCH_INIT); setMovieLimit(SEARCH_INIT); setSeriesLimit(SEARCH_INIT) }, [query])

  const searchArgs = (type: 'live' | 'movie' | 'series', limit: number) => ({
    query, type, sourceIds: selectedSourceIds.length ? selectedSourceIds : undefined, limit,
  })

  const { data: liveResults = [], isFetching: liveFetching } = useQuery<ContentItem[]>({
    queryKey: ['search', query, 'live', selectedSourceIds, liveLimit],
    queryFn: () => api.search.query(searchArgs('live', liveLimit)),
    staleTime: 10_000, enabled: !!query,
  })
  const { data: movieResults = [], isFetching: movieFetching } = useQuery<ContentItem[]>({
    queryKey: ['search', query, 'movie', selectedSourceIds, movieLimit],
    queryFn: () => api.search.query(searchArgs('movie', movieLimit)),
    staleTime: 10_000, enabled: !!query,
  })
  const { data: seriesResults = [], isFetching: seriesFetching } = useQuery<ContentItem[]>({
    queryKey: ['search', query, 'series', selectedSourceIds, seriesLimit],
    queryFn: () => api.search.query(searchArgs('series', seriesLimit)),
    staleTime: 10_000, enabled: !!query,
  })

  const isFetching = liveFetching && movieFetching && seriesFetching
  const hasResults = liveResults.length > 0 || movieResults.length > 0 || seriesResults.length > 0

  const handleSelect = useCallback((item: ContentItem) => {
    if (item.type === 'live') {
      const liveForSurf = (liveResults as ContentItem[]).slice(
        0, liveLimit > SEARCH_INIT ? liveResults.length : SEARCH_INITIAL_CAP
      )
      const idx = liveForSurf.findIndex((i) => i.id === item.id)
      setChannelSurfContext(liveForSurf, idx >= 0 ? idx : 0)
    }
    onSelectContent(item)
  }, [liveResults, liveLimit, onSelectContent, setChannelSurfContext])

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
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>No results for "{query}"</p>
        <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0 }}>Try a different search term</p>
      </div>
    )
  }

  return (
    <Suspense fallback={null}>
      <SearchResults
        live={{   results: liveResults   as ContentItem[], isExpanded: liveLimit   > SEARCH_INIT, onShowAll: () => setLiveLimit(SEARCH_FULL),   onShowLess: () => setLiveLimit(SEARCH_INIT) }}
        movies={{  results: movieResults  as ContentItem[], isExpanded: movieLimit  > SEARCH_INIT, onShowAll: () => setMovieLimit(SEARCH_FULL),  onShowLess: () => setMovieLimit(SEARCH_INIT) }}
        series={{  results: seriesResults as ContentItem[], isExpanded: seriesLimit > SEARCH_INIT, onShowAll: () => setSeriesLimit(SEARCH_FULL), onShowLess: () => setSeriesLimit(SEARCH_INIT) }}
        onSelect={handleSelect}
      />
    </Suspense>
  )
}
