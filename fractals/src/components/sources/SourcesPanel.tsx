import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { EmptyState } from '@/components/shared/EmptyState'
import { useSourcesStore } from '@/stores/sources.store'
import { api } from '@/lib/api'
import { SourceCard } from './SourceCard'
import { AddSourceModal } from './AddSourceForm'

interface Props {
  onClose: () => void
  onSync: (id: string) => void
  onRemove: (id: string) => void
  onAdded: (sourceId: string) => void
}

export function SourcesPanel({ onClose, onSync, onRemove, onAdded }: Props) {
  const queryClient = useQueryClient()
  const { sources, updateSource } = useSourcesStore()
  const [showAddModal, setShowAddModal] = useState(false)

  // Source enable/disable changes visible content across every view —
  // invalidate all queries rather than chasing individual keys.
  const invalidateAll = () => queryClient.invalidateQueries()

  const handleEnableAll = async () => {
    for (const src of sources) {
      if (src.disabled) {
        await api.sources.toggleDisabled(src.id)
        updateSource(src.id, { disabled: false })
      }
    }
    invalidateAll()
  }

  const handleDisableAll = async () => {
    for (const src of sources) {
      if (!src.disabled) {
        await api.sources.toggleDisabled(src.id)
        updateSource(src.id, { disabled: true })
      }
    }
    invalidateAll()
  }

  const allEnabled = sources.length > 0 && sources.every((s) => !s.disabled)
  const allDisabled = sources.length > 0 && sources.every((s) => s.disabled)

  const handleAdded = (sourceId: string) => {
    setShowAddModal(false)
    onAdded(sourceId)
  }

  return (
    <>
      <SlidePanel open={true} onClose={onClose} width={480}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 15, fontWeight: 600, color: 'var(--text-0)',
            fontFamily: 'var(--font-ui)',
          }}>
            Sources
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {sources.length > 1 && (
              <>
                <button
                  onClick={handleEnableAll}
                  disabled={allEnabled}
                  title="Enable all sources"
                  style={{
                    fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-ui)',
                    padding: '3px 8px', borderRadius: 5, cursor: allEnabled ? 'default' : 'pointer',
                    background: 'transparent', border: '1px solid var(--border-default)',
                    color: allEnabled ? 'var(--text-3)' : 'var(--text-1)',
                    transition: 'all 0.1s',
                  }}
                  onMouseEnter={(e) => { if (!allEnabled) e.currentTarget.style.color = 'var(--text-0)' }}
                  onMouseLeave={(e) => { if (!allEnabled) e.currentTarget.style.color = 'var(--text-1)' }}
                >
                  Enable all
                </button>
                <button
                  onClick={handleDisableAll}
                  disabled={allDisabled}
                  title="Disable all sources"
                  style={{
                    fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-ui)',
                    padding: '3px 8px', borderRadius: 5, cursor: allDisabled ? 'default' : 'pointer',
                    background: 'transparent', border: '1px solid var(--border-default)',
                    color: allDisabled ? 'var(--text-3)' : 'var(--text-1)',
                    transition: 'all 0.1s',
                  }}
                  onMouseEnter={(e) => { if (!allDisabled) e.currentTarget.style.color = 'var(--text-0)' }}
                  onMouseLeave={(e) => { if (!allDisabled) e.currentTarget.style.color = 'var(--text-1)' }}
                >
                  Disable all
                </button>
              </>
            )}
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 6, border: 'none',
              background: 'transparent', display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'var(--text-2)', cursor: 'pointer',
              transition: 'background 0.1s, color 0.1s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-3)'
              e.currentTarget.style.color = 'var(--text-1)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-2)'
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 20px' }}>
          {sources.length === 0 ? (
            <EmptyState
              icon={
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              }
              title="No sources yet"
              description="Add an Xtream Codes source or M3U playlist to start browsing your IPTV library."
              action={{ label: '＋ Add source', onClick: () => setShowAddModal(true) }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sources.map(source => (
                <SourceCard
                  key={source.id}
                  source={source}
                  onSync={onSync}
                  onRemove={onRemove}
                  onClose={onClose}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer: add source button */}
        {sources.length > 0 && (
          <div style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}>
            <button
              onClick={() => setShowAddModal(true)}
              style={{
                width: '100%', padding: '8px 0', borderRadius: 7,
                fontSize: 12, fontWeight: 600,
                background: 'var(--bg-2)', border: '1px solid var(--border-default)',
                color: 'var(--text-0)', cursor: 'pointer',
                fontFamily: 'var(--font-ui)', transition: 'all 0.1s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-2)' }}
            >
              ＋ Add source
            </button>
          </div>
        )}
      </SlidePanel>

      {/* Add Source Modal — rendered above everything */}
      {showAddModal && (
        <AddSourceModal
          onAdded={handleAdded}
          onCancel={() => setShowAddModal(false)}
        />
      )}
    </>
  )
}
