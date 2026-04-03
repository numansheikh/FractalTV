import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { api } from '@/lib/api'
import { useSourcesStore, Source } from '@/stores/sources.store'
import { SearchBar } from '@/components/search/SearchBar'
import { BrowseView } from '@/components/browse/BrowseView'
import { Sidebar } from '@/components/settings/Sidebar'
import { AddSourceDialog } from '@/components/settings/AddSourceDialog'
import { ContentItem } from '@/components/browse/ContentCard'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  )
}

function AppShell() {
  const { sources, setSources, updateSource } = useSourcesStore()
  const [showAddSource, setShowAddSource] = useState(false)
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(null)

  // Load sources on mount
  useEffect(() => {
    api.sources.list().then((list) => setSources(list as Source[]))
  }, [setSources])

  // Listen for sync progress
  useEffect(() => {
    const unsub = api.on('sync:progress', (progress: any) => {
      if (progress.phase === 'done') {
        // Refresh sources list after sync
        api.sources.list().then((list) => setSources(list as Source[]))
        queryClient.invalidateQueries({ queryKey: ['search'] })
      } else if (progress.phase === 'syncing' || progress.phase === 'error') {
        updateSource(progress.sourceId, {
          status: progress.phase === 'error' ? 'error' : 'syncing',
          lastError: progress.phase === 'error' ? progress.message : undefined,
        })
      }
    })
    return unsub
  }, [setSources, updateSource])

  const handleSync = async (sourceId: string) => {
    updateSource(sourceId, { status: 'syncing' })
    await api.sources.sync(sourceId)
    const list = await api.sources.list()
    setSources(list as Source[])
    queryClient.invalidateQueries({ queryKey: ['search'] })
  }

  const handleRemove = async (sourceId: string) => {
    await api.sources.remove(sourceId)
    setSources(sources.filter((s) => s.id !== sourceId))
    queryClient.invalidateQueries({ queryKey: ['search'] })
  }

  const handleSourceAdded = async () => {
    const list = await api.sources.list()
    setSources(list as Source[])
    queryClient.invalidateQueries({ queryKey: ['search'] })
  }

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      {/* Sidebar */}
      <Sidebar
        sources={sources}
        onAddSource={() => setShowAddSource(true)}
        onSyncSource={handleSync}
        onRemoveSource={handleRemove}
      />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <SearchBar />
        <BrowseView
          sourcesCount={sources.length}
          onAddSource={() => setShowAddSource(true)}
          onSelectContent={setSelectedContent}
        />
      </div>

      {/* Dialogs */}
      <AnimatePresence>
        {showAddSource && (
          <AddSourceDialog
            onClose={() => setShowAddSource(false)}
            onAdded={handleSourceAdded}
          />
        )}
      </AnimatePresence>

      {/* TODO: Content detail + Player (Phase 6) */}
      {selectedContent && (
        <div className="fixed bottom-4 right-4 rounded-lg px-3 py-2 text-xs shadow-lg"
          style={{ background: 'var(--color-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
          Selected: <span style={{ color: 'var(--color-text-primary)' }}>{selectedContent.title}</span>
          <button onClick={() => setSelectedContent(null)} className="ml-2" style={{ color: 'var(--color-text-muted)' }}>✕</button>
        </div>
      )}
    </div>
  )
}
