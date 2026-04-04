import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { api } from '@/lib/api'
import { useSourcesStore, Source, SyncProgress } from '@/stores/sources.store'
import { SearchBar } from '@/components/search/SearchBar'
import { BrowseView } from '@/components/browse/BrowseView'
import { BrowseViewH } from '@/components/browse/BrowseViewH'
import { AddSourceDialog } from '@/components/settings/AddSourceDialog'
import { Player } from '@/components/player/Player'
import { ContentDetail } from '@/components/content/ContentDetail'
import { SeriesView } from '@/components/content/SeriesView'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { ContentItem } from '@/components/browse/ContentCard'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

function AppShell() {
  const { sources, setSources, updateSource, setSyncProgress } = useSourcesStore()
  const [showAddSource, setShowAddSource] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(null)
  const [selectedSeries, setSelectedSeries] = useState<ContentItem | null>(null)
  const [playingContent, setPlayingContent] = useState<ContentItem | null>(null)
  const [layoutH, setLayoutH] = useState(() => {
    const saved = localStorage.getItem('fractals-layout-h')
    return saved !== null ? saved === 'true' : true
  })

  useEffect(() => {
    api.sources.list().then((list) => {
      const loaded = list as Source[]
      setSources(loaded)
      // Auto-sync sources that have never been synced
      for (const src of loaded) {
        if (!src.disabled && !src.lastSync) {
          handleSync(src.id)
        }
      }
      // Check connectivity for all sources and update status (clears stale 'error' dots)
      if (loaded.length > 0) api.sources.startupCheck()
    })

    // ⌘, opens settings / ⌘R reloads renderer
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); setShowSettings(true) }
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') { e.preventDefault(); window.location.reload() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSources])

  useEffect(() => {
    const unsub = api.on('source:health', (data: any) => {
      updateSource(data.sourceId, {
        status: data.ok ? 'active' : 'error',
        lastError: data.ok ? undefined : data.error,
      })
    })
    return unsub
  }, [updateSource])

  useEffect(() => {
    // Track the last phase per source to detect phase transitions
    const lastPhase: Record<string, string> = {}

    const unsub = api.on('sync:progress', (progress: any) => {
      const p = progress as SyncProgress & { sourceId: string }

      if (p.phase === 'done') {
        setSyncProgress(p.sourceId, null)
        api.sources.list().then((list) => setSources(list as Source[]))
        queryClient.invalidateQueries({ queryKey: ['browse'] })
        queryClient.invalidateQueries({ queryKey: ['categories'] })
      } else if (p.phase === 'error') {
        setSyncProgress(p.sourceId, null)
        updateSource(p.sourceId, { status: 'error', lastError: p.message })
      } else {
        setSyncProgress(p.sourceId, { phase: p.phase, current: p.current, total: p.total, message: p.message })
        updateSource(p.sourceId, { status: 'syncing' })

        // When phase transitions (live→movies, movies→series), the previous phase's
        // content is fully in the DB — invalidate so the UI shows it immediately
        if (lastPhase[p.sourceId] && lastPhase[p.sourceId] !== p.phase) {
          queryClient.invalidateQueries({ queryKey: ['browse'] })
          queryClient.invalidateQueries({ queryKey: ['categories'] })
        }
        lastPhase[p.sourceId] = p.phase
      }
    })
    return unsub
  }, [setSources, updateSource, setSyncProgress])

  const handleSync = async (sourceId: string) => {
    updateSource(sourceId, { status: 'syncing' })
    setSyncProgress(sourceId, { phase: 'categories', current: 0, total: 0, message: 'Connecting…' })
    await api.sources.sync(sourceId)
    setSyncProgress(sourceId, null)
    const list = await api.sources.list()
    setSources(list as Source[])
    queryClient.invalidateQueries({ queryKey: ['browse'] })
    queryClient.invalidateQueries({ queryKey: ['categories'] })
  }

  const handleRemove = async (sourceId: string) => {
    await api.sources.remove(sourceId)
    setSources(sources.filter((s) => s.id !== sourceId))
    queryClient.invalidateQueries({ queryKey: ['browse'] })
    queryClient.invalidateQueries({ queryKey: ['categories'] })
  }

  const handleSourceAdded = async () => {
    const list = await api.sources.list()
    setSources(list as Source[])
    queryClient.invalidateQueries({ queryKey: ['browse'] })
    queryClient.invalidateQueries({ queryKey: ['categories'] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: 'var(--color-bg)', overflow: 'hidden' }}>

      {/* Header: logo + search + settings */}
      <SearchBar
        onOpenSettings={() => setShowSettings(true)}
        layoutH={layoutH}
        onToggleLayout={() => setLayoutH(v => { const next = !v; localStorage.setItem('fractals-layout-h', String(next)); return next })}
      />

      {/* Content: category nav + poster grid */}
      {layoutH ? (
        <BrowseViewH
          sourcesCount={sources.length}
          onAddSource={() => setShowAddSource(true)}
          onSyncSource={handleSync}
          onRemoveSource={handleRemove}
          onSelectContent={(item) => {
            if (item.type === 'live') setPlayingContent(item)
            else if (item.type === 'series') setSelectedSeries(item)
            else setSelectedContent(item)
          }}
        />
      ) : (
        <BrowseView
          sourcesCount={sources.length}
          onAddSource={() => setShowAddSource(true)}
          onSyncSource={handleSync}
          onRemoveSource={handleRemove}
          onSelectContent={(item) => {
            if (item.type === 'live') setPlayingContent(item)
            else if (item.type === 'series') setSelectedSeries(item)
            else setSelectedContent(item)
          }}
        />
      )}

      {/* Dialogs */}
      <AnimatePresence>
        {showAddSource && (
          <AddSourceDialog
            onClose={() => setShowAddSource(false)}
            onAdded={handleSourceAdded}
          />
        )}
        {showSettings && (
          <SettingsDialog onClose={() => setShowSettings(false)} />
        )}
      </AnimatePresence>

      {/* Series view — full page */}
      <AnimatePresence>
        {selectedSeries && !playingContent && (
          <SeriesView
            item={selectedSeries}
            onPlay={(item) => { setPlayingContent(item); setSelectedSeries(null) }}
            onBack={() => setSelectedSeries(null)}
          />
        )}
      </AnimatePresence>

      {/* Content detail panel */}
      <AnimatePresence>
        {selectedContent && !playingContent && (
          <ContentDetail
            item={selectedContent}
            onPlay={(item) => { setPlayingContent(item); setSelectedContent(null) }}
            onClose={() => setSelectedContent(null)}
          />
        )}
      </AnimatePresence>

      {/* Player */}
      <AnimatePresence>
        {playingContent && (
          <Player
            content={playingContent}
            onClose={() => setPlayingContent(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
