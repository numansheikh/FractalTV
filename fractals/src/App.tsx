import { useEffect, useState, useRef, lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useSourcesStore, Source, SyncProgress } from '@/stores/sources.store'
import { useAppStore } from '@/stores/app.store'
import { useSearchStore } from '@/stores/search.store'
import { NavRail } from '@/components/layout/NavRail'
import { CommandBar } from '@/components/layout/CommandBar'
import { ContentArea } from '@/components/layout/ContentArea'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { ContextMenu } from '@/components/shared/ContextMenu'
import { ContentItem } from '@/lib/types'
// PlayerOverlay is NOT lazy — must be persistent (never unmounts) for mini-player
import { PlayerOverlay } from '@/components/player/PlayerOverlay'

// Detail + overlay panels loaded lazily
const MovieDetail = lazy(() => import('@/components/detail/MovieDetail').then((m) => ({ default: m.MovieDetail })))
const SeriesDetail = lazy(() => import('@/components/detail/SeriesDetail').then((m) => ({ default: m.SeriesDetail })))
const ChannelDetail = lazy(() => import('@/components/detail/ChannelDetail').then((m) => ({ default: m.ChannelDetail })))
const SettingsPanel = lazy(() => import('@/components/settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })))
const SourcesPanel = lazy(() => import('@/components/sources/SourcesPanel').then((m) => ({ default: m.SourcesPanel })))
const LiveView = lazy(() => import('@/components/live/LiveView').then((m) => ({ default: m.LiveView })))
const AddSourceModal = lazy(() => import('@/components/sources/AddSourceForm').then((m) => ({ default: m.AddSourceModal })))

export function App() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }))
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

// ─── Keyboard shortcuts overlay ───────────────────────────────────────────────

const SHORTCUTS = [
  { keys: ['/', 'Cmd+K'], action: 'Focus search' },
  { keys: ['Escape'], action: 'Clear search / go back / close' },
  { keys: ['Cmd+1'], action: 'Home' },
  { keys: ['Cmd+2'], action: 'Live TV' },
  { keys: ['Cmd+3'], action: 'Films' },
  { keys: ['Cmd+4'], action: 'Series' },
  { keys: ['Cmd+5'], action: 'Library' },
  { keys: ['Cmd+,'], action: 'Settings' },
  { keys: ['[', ']'], action: 'Channel surf (Live TV)' },
  { keys: ['↑', '↓'], action: 'Volume (player)' },
  { keys: ['←', '→'], action: 'Seek (player)' },
  { keys: ['Space'], action: 'Play / pause' },
  { keys: ['F'], action: 'Fullscreen' },
  { keys: ['M'], action: 'Mute' },
  { keys: ['?'], action: 'This help' },
]

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') { e.stopImmediatePropagation(); onClose() }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          padding: '20px 24px 24px',
          width: 400,
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)', fontFamily: 'var(--font-ui)' }}>
            Keyboard shortcuts
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', padding: 4, display: 'flex' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SHORTCUTS.map(({ keys, action }) => (
            <div key={action} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-1)', fontFamily: 'var(--font-ui)' }}>{action}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {keys.map((k) => (
                  <span key={k} style={{
                    fontSize: 11, fontFamily: 'var(--font-mono, monospace)',
                    background: 'var(--bg-3)', color: 'var(--text-0)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 4, padding: '1px 6px',
                    whiteSpace: 'nowrap',
                  }}>{k}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AppShell() {
  const queryClient = useQueryClient()
  const { setSources, updateSource, setSyncProgress, setEnrichProgress, setEnrichResult, setMetadataProgress, setMetadataResult } = useSourcesStore()
  const {
    selectedContent, playingContent, showSettings, showSources,
    liveViewChannel, setLiveViewChannel,
    setSelectedContent, setPlayingContent, setShowSettings, setShowSources,
    setView, setCategoryFilter, clearSourceFilter, toggleSourceFilter,
    sort, setSort, surfChannel, surfEpisode,
    playerMode, setPlayerMode,
  } = useAppStore()

  const [showAddModal, setShowAddModal] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const showShortcutsRef = useRef(false)
  const openShortcuts = () => { showShortcutsRef.current = true; setShowShortcuts(true) }
  const closeShortcuts = () => { showShortcutsRef.current = false; setShowShortcuts(false) }

  // Guard against StrictMode double-mount triggering duplicate syncs
  const syncingIds = useRef(new Set<string>())

  // Load sources + auto-sync new ones
  useEffect(() => {
    api.sources.list().then((list) => {
      const loaded = list as Source[]
      setSources(loaded)
      if (loaded.length === 0) {
        setShowAddModal(true)
      } else {
        for (const src of loaded) {
          if (!src.disabled && !src.lastSync) {
            handleSync(src.id)
          }
        }
        api.sources.startupCheck()
      }
    })

    // Global keyboard shortcuts — skip when user is typing in an input/textarea
    const isTyping = () => {
      const el = document.activeElement
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    }
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); setShowSettings(true); setShowSources(false); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') { e.preventDefault(); window.location.reload(); return }

      // Escape — universal "back" chain (bubble phase, so overlays win via capture+stopImmediatePropagation)
      // Works even when an input is focused (intentional — clears search query)
      if (e.key === 'Escape') {
        if (showShortcutsRef.current) { showShortcutsRef.current = false; setShowShortcuts(false); return }
        const s = useSearchStore.getState()
        const a = useAppStore.getState()
        // 1. Clear search query for current view
        if (s.queries[a.activeView]) { s.setQuery(''); return }
        // 2. Go back (previous view, or Home if none)
        if (a.activeView !== 'home') { a.goBack(); return }
        return
      }

      if (isTyping()) return
      if (e.key === '?') { openShortcuts(); return }
      if ((e.metaKey || e.ctrlKey) && e.key === '1') { e.preventDefault(); setView('home') }
      if ((e.metaKey || e.ctrlKey) && e.key === '2') { e.preventDefault(); setView('live') }
      if ((e.metaKey || e.ctrlKey) && e.key === '3') { e.preventDefault(); setView('films') }
      if ((e.metaKey || e.ctrlKey) && e.key === '4') { e.preventDefault(); setView('series') }
      if ((e.metaKey || e.ctrlKey) && e.key === '5') { e.preventDefault(); setView('library') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSources])

  // Source health events
  useEffect(() => {
    return api.on('source:health', (data: any) => {
      updateSource(data.sourceId, {
        status: data.ok ? 'active' : 'error',
        lastError: data.ok ? undefined : data.error,
      })
    })
  }, [updateSource])

  const invalidateContentQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['browse'] })
    queryClient.invalidateQueries({ queryKey: ['categories'] })
    queryClient.invalidateQueries({ queryKey: ['home-latest-movies'] })
    queryClient.invalidateQueries({ queryKey: ['home-latest-series'] })
    queryClient.invalidateQueries({ queryKey: ['channels'] })
    queryClient.invalidateQueries({ queryKey: ['home-watchlist'] })
    queryClient.invalidateQueries({ queryKey: ['home-continue'] })
    queryClient.invalidateQueries({ queryKey: ['search'] })
  }

  // Sync progress events
  useEffect(() => {
    const lastPhase: Record<string, string> = {}
    return api.on('sync:progress', (progress: any) => {
      const p = progress as SyncProgress & { sourceId: string }
      if (p.phase === 'done' || p.phase === 'cancelled') {
        setSyncProgress(p.sourceId, null)
        api.sources.list().then((list) => setSources(list as Source[]))
        if (p.phase === 'done') invalidateContentQueries()
      } else if (p.phase === 'error') {
        setSyncProgress(p.sourceId, null)
        updateSource(p.sourceId, { status: 'error', lastError: p.message })
      } else {
        setSyncProgress(p.sourceId, { phase: p.phase, current: p.current, total: p.total, message: p.message })
        updateSource(p.sourceId, { status: 'syncing' })
        if (lastPhase[p.sourceId] && lastPhase[p.sourceId] !== p.phase) {
          invalidateContentQueries()
        }
        lastPhase[p.sourceId] = p.phase
      }
    })
  }, [setSources, updateSource, setSyncProgress])

  // VoD enrichment progress events (global — survives SourcesPanel open/close)
  useEffect(() => {
    return api.on('vodEnrich:progress', (p: any) => {
      const { sourceId, phase, current, total, message, error } = p
      if (phase === 'done') {
        setEnrichProgress(sourceId, null)
        setEnrichResult(sourceId, { success: true, message: message ?? 'Enrichment complete' })
      } else if (phase === 'error') {
        setEnrichProgress(sourceId, null)
        setEnrichResult(sourceId, { success: false, message: error ?? 'Enrichment failed' })
      } else {
        setEnrichProgress(sourceId, { current: current ?? 0, total: total ?? 0, message })
      }
    })
  }, [setEnrichProgress, setEnrichResult])

  // Metadata population progress events
  useEffect(() => {
    return api.on('metadata:progress', (p: any) => {
      const { sourceId, phase, current, total, label, error } = p
      if (phase === 'done') {
        setMetadataProgress(sourceId, null)
        setMetadataResult(sourceId, { success: true, message: 'Metadata populated' })
      } else if (phase === 'error') {
        setMetadataProgress(sourceId, null)
        setMetadataResult(sourceId, { success: false, message: error ?? 'Failed' })
      } else {
        setMetadataProgress(sourceId, { current: current ?? 0, total: total ?? 0, message: label })
      }
    })
  }, [setMetadataProgress, setMetadataResult])

  const handleSync = async (sourceId: string) => {
    if (syncingIds.current.has(sourceId)) return
    syncingIds.current.add(sourceId)
    updateSource(sourceId, { status: 'syncing' })
    setSyncProgress(sourceId, { phase: 'categories', current: 0, total: 0, message: 'Connecting…' })
    try {
      await api.sources.sync(sourceId)
    } finally {
      syncingIds.current.delete(sourceId)
    }
    setSyncProgress(sourceId, null)
    const list = await api.sources.list()
    setSources(list as Source[])
    invalidateContentQueries()
  }

  const handleRemove = async (sourceId: string) => {
    await api.sources.remove(sourceId)
    const list = await api.sources.list()
    setSources(list as Source[])
    invalidateContentQueries()
  }

  const handleSourceAdded = async () => {
    const list = await api.sources.list()
    setSources(list as Source[])
    invalidateContentQueries()
  }

  const handleSelectContent = (item: ContentItem) => {
    if (item.type === 'live') {
      setSelectedContent(null)
      setLiveViewChannel(item)
    } else {
      setSelectedContent(item)
    }
  }

  const handlePlay = async (item: ContentItem) => {
    if (item.type === 'live') {
      const s = useAppStore.getState()
      if (!s.channelSurfList.some((ch) => ch.id === item.id)) {
        // Channel isn't in the current surf list (e.g. opened from ChannelDetail).
        // Try to load the full category so LiveView has a proper channel list to surf.
        const catName = (item as any).category_name ?? (item as any).categoryName ?? null
        if (catName) {
          try {
            const result = await api.content.browse({ type: 'live', categoryName: catName, limit: 500, offset: 0 })
            const items = (result?.items ?? []) as ContentItem[]
            const idx = items.findIndex((ch) => ch.id === item.id)
            s.setChannelSurfContext(items, idx >= 0 ? idx : 0, null, null)
          } catch {
            s.setChannelSurfContext([item], 0, null, null)
          }
        } else {
          s.setChannelSurfContext([item], 0, null, null)
        }
      }
      setSelectedContent(null)
      setLiveViewChannel(item)
    } else {
      // VoD — start in mini player; expand button in mini player goes fullscreen
      setPlayingContent(item)
      setPlayerMode('mini')
    }
  }

  const handlePlayerClose = () => {
    const wasLive = playingContent?.type === 'live'
    setPlayingContent(null)
    setPlayerMode('hidden')
    // Only close LiveView when the closed stream was actually a live channel
    if (wasLive) setLiveViewChannel(null)
  }

  const handlePlayerMinimize = () => {
    const content = playingContent
    if (!content) { setPlayerMode('hidden'); return }
    if (content.type === 'live') {
      // Return to live view rather than mini player
      setPlayerMode('hidden')
      if (!liveViewChannel) setLiveViewChannel(content)
    } else {
      setPlayerMode('mini')
    }
  }

  const handlePlayerChipClick = (item: ContentItem) => {
    const parent = (item as any)._parent
    if (parent) {
      // Episode — minimize to mini, open series detail panel
      setPlayerMode('mini')
      setLiveViewChannel(null)
      setSelectedContent({ ...item, id: parent.id, title: parent.title, type: 'series' } as ContentItem)
    } else {
      // Navigate to category — shrink to mini player, keep stream going
      setPlayerMode('mini')
      setLiveViewChannel(null)
      setSelectedContent(null)
      useSearchStore.getState().setQuery('')
      const cat = (item as any).category_name
      const viewMap = { live: 'live', movie: 'films', series: 'series' } as const
      setView(viewMap[item.type as keyof typeof viewMap] ?? 'films')
      if (cat) setCategoryFilter(cat.split(',')[0])
    }
  }

  const handleBreadcrumbNav = (nav: { type?: 'live' | 'movie' | 'series'; sourceId?: string; category?: string }) => {
    setSelectedContent(null)
    useSearchStore.getState().setQuery('')  // clear search so browse view shows, not search results
    if (nav.category) clearSourceFilter()  // category navigation = clean browse, no leftover source filter
    if (nav.type) {
      const viewMap = { live: 'live', movie: 'films', series: 'series' } as const
      setView(viewMap[nav.type])
    }
    if (nav.category) setCategoryFilter(nav.category) // set after setView
    if (nav.sourceId) { clearSourceFilter(); toggleSourceFilter(nav.sourceId) }
  }

  const isSeries = selectedContent?.type === 'series'
  const isLive = selectedContent?.type === 'live'

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      background: 'var(--bg-0)',
      color: 'var(--text-0)',
      fontFamily: 'var(--font-ui)',
      fontSize: 13,
      overflow: 'hidden',
    }}>
      {/* Nav Rail */}
      <NavRail
        onOpenSources={() => { const next = !showSources; setShowSources(next); if (next) setShowSettings(false) }}
        onOpenSettings={() => { const next = !showSettings; setShowSettings(next); if (next) setShowSources(false) }}
      />

      {/* Main column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <CommandBar sort={sort} onSortChange={setSort} />
        <ContentArea
          sort={sort}
          onSelectContent={handleSelectContent}
          onAddSource={() => setShowSources(true)}
        />
      </div>

      {/* Player — always mounted; drives embedded, fullscreen, and mini modes */}
      <PlayerOverlay
        content={playingContent}
        mode={playerMode}
        onClose={handlePlayerClose}
        onMinimize={handlePlayerMinimize}
        onExpand={() => setPlayerMode('fullscreen')}
        onSurfChannel={surfChannel}
        onSurfEpisode={(dir) => {
          const next = surfEpisode(dir)
          if (next) setPlayingContent(next)
          return next
        }}
        onChipClick={handlePlayerChipClick}
      />

      {/* Shared scrim for Settings/Sources panels — stays mounted through panel switches to prevent flicker */}
      {(showSettings || showSources) && (
        <div
          onClick={() => { setShowSettings(false); setShowSources(false) }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
            zIndex: 40,
          }}
        />
      )}

      {/* Overlay panels — rendered via Suspense/lazy */}
      <Suspense fallback={null}>
        {/* Movie detail */}
        {selectedContent && !isSeries && !isLive && (
          <MovieDetail
            item={selectedContent}
            onPlay={handlePlay}
            onClose={() => { setSelectedContent(null) }}
            onNavigate={handleBreadcrumbNav}
            isPlaying={playerMode === 'fullscreen'}
          />
        )}
        {/* Series detail */}
        {selectedContent && isSeries && (
          <SeriesDetail
            item={selectedContent}
            onPlay={handlePlay}
            onClose={() => { setSelectedContent(null) }}
            onNavigate={handleBreadcrumbNav}
            isPlaying={playerMode === 'fullscreen'}
          />
        )}
        {/* Channel detail */}
        {selectedContent && isLive && (
          <ChannelDetail
            item={selectedContent}
            onPlay={handlePlay}
            onClose={() => { setSelectedContent(null) }}
            onNavigate={handleBreadcrumbNav}
            isPlaying={!!playingContent}
          />
        )}
        {/* Live View — stays mounted during embedded mode; hidden only when fullscreen */}
        {liveViewChannel && playerMode !== 'fullscreen' && (
          <LiveView
            channel={liveViewChannel}
            onFullscreen={() => setPlayerMode('fullscreen')}
            onSwitchChannel={(ch) => { setSelectedContent(null); setLiveViewChannel(ch) }}
            onClose={() => { setLiveViewChannel(null) }}
          />
        )}
        {showSettings && (
          <SettingsPanel onClose={() => setShowSettings(false)} />
        )}
        {showSources && (
          <SourcesPanel
            onClose={() => setShowSources(false)}
            onSync={handleSync}
            onRemove={handleRemove}
            onAdded={async (_sourceId: string) => { await handleSourceAdded() }}
          />
        )}
        {/* First-launch / direct add source modal */}
        {showAddModal && (
          <AddSourceModal
            onAdded={async (_sourceId: string) => { setShowAddModal(false); await handleSourceAdded() }}
            onCancel={() => setShowAddModal(false)}
          />
        )}
      </Suspense>
      <ContextMenu />
      {showShortcuts && <ShortcutsOverlay onClose={closeShortcuts} />}
    </div>
  )
}
