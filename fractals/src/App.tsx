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
const SettingsPanel = lazy(() => import('@/components/settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })))
const SourcesPanel = lazy(() => import('@/components/sources/SourcesPanel').then((m) => ({ default: m.SourcesPanel })))
const LiveSplitView = lazy(() => import('@/components/live/LiveSplitView').then((m) => ({ default: m.LiveSplitView })))
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

function AppShell() {
  const queryClient = useQueryClient()
  const { setSources, updateSource, setSyncProgress, setIndexProgress } = useSourcesStore()
  const {
    selectedContent, playingContent, showSettings, showSources,
    splitViewChannel, setSplitViewChannel,
    setSelectedContent, setPlayingContent, setShowSettings, setShowSources,
    setView, setCategoryFilter, clearSourceFilter, toggleSourceFilter,
    sort, setSort, surfChannel,
    playerMode, setPlayerMode,
    setFtsEnabled,
  } = useAppStore()

  const [showAddModal, setShowAddModal] = useState(false)

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
        const s = useSearchStore.getState()
        const a = useAppStore.getState()
        // 1. Clear search query for current view
        if (s.queries[a.activeView]) { s.setQuery(''); return }
        // 2. Go back (previous view, or Home if none)
        if (a.activeView !== 'home') { a.goBack(); return }
        return
      }

      if (isTyping()) return
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

  // FTS indexing progress events (g2). After every successful index build,
  // flip ftsEnabled on — sync→index→FTS-on is the default flow.
  useEffect(() => {
    return api.on('fts:progress', (progress: any) => {
      const p = progress as SyncProgress & { sourceId: string }
      if (p.phase === 'done' || p.phase === 'error') {
        setIndexProgress(p.sourceId, null)
        if (p.phase === 'done') setFtsEnabled(true)
      } else {
        setIndexProgress(p.sourceId, { phase: p.phase, current: p.current, total: p.total, message: p.message })
      }
    })
  }, [setIndexProgress, setFtsEnabled])

  // Canonical layer build progress (g3). On done, invalidate browse so channels appear.
  useEffect(() => {
    return api.on('canonical:progress', (progress: any) => {
      const p = progress as SyncProgress & { sourceId: string }
      if (p.phase === 'done' || p.phase === 'error') {
        setIndexProgress(p.sourceId, null)
        if (p.phase === 'done') invalidateContentQueries()
      } else {
        setIndexProgress(p.sourceId, { phase: p.phase, current: p.current, total: p.total, message: p.message })
      }
    })
  }, [setIndexProgress])

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
      setSplitViewChannel(item)
    } else {
      setSelectedContent(item)
    }
  }

  const handlePlay = (item: ContentItem) => {
    setPlayingContent(item)
    setPlayerMode('fullscreen')
  }

  const handlePlayerClose = () => {
    setPlayingContent(null)
    setPlayerMode('hidden')
  }

  const handlePlayerChipClick = (item: ContentItem) => {
    setPlayerMode('mini')
    const parent = (item as any)._parent
    if (parent) {
      // Episode — open series detail panel
      setSelectedContent({ ...item, id: parent.id, title: parent.title, type: 'series' } as ContentItem)
    } else {
      // Navigate to category in the appropriate view
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

      {/* Player — always mounted for persistent stream (mini-player support) */}
      <PlayerOverlay
        content={playingContent}
        mode={playerMode}
        onClose={handlePlayerClose}
        onMinimize={() => setPlayerMode('mini')}
        onExpand={() => setPlayerMode('fullscreen')}
        onSurfChannel={surfChannel}
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
        {selectedContent && !isSeries && (
          <MovieDetail
            item={selectedContent}
            onPlay={handlePlay}
            onClose={() => { setSelectedContent(null) }}
            onNavigate={handleBreadcrumbNav}
            isPlaying={!!playingContent}
          />
        )}
        {/* Series detail */}
        {selectedContent && isSeries && (
          <SeriesDetail
            item={selectedContent}
            onPlay={handlePlay}
            onClose={() => { setSelectedContent(null) }}
            onNavigate={handleBreadcrumbNav}
            isPlaying={!!playingContent}
          />
        )}
        {/* Live split view */}
        {splitViewChannel && playerMode === 'hidden' && (
          <LiveSplitView
            channel={splitViewChannel}
            onFullscreen={(ch) => handlePlay(ch)}
            onSwitchChannel={(ch) => setSplitViewChannel(ch)}
            onClose={() => setSplitViewChannel(null)}
          />
        )}
        {/* Settings — suppressScrim: shared scrim above handles it */}
        {showSettings && (
          <SettingsPanel onClose={() => setShowSettings(false)} suppressScrim />
        )}
        {/* Sources — suppressScrim: shared scrim above handles it */}
        {showSources && (
          <SourcesPanel
            onClose={() => setShowSources(false)}
            onSync={handleSync}
            onRemove={handleRemove}
            onAdded={async (sourceId: string) => { await handleSourceAdded(); handleSync(sourceId) }}
            suppressScrim
          />
        )}
        {/* First-launch / direct add source modal */}
        {showAddModal && (
          <AddSourceModal
            onAdded={async (sourceId: string) => { setShowAddModal(false); await handleSourceAdded(); handleSync(sourceId) }}
            onCancel={() => setShowAddModal(false)}
          />
        )}
      </Suspense>
      <ContextMenu />
    </div>
  )
}
