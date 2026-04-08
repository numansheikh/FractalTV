import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FractalsIcon } from '@/components/shared/FractalsIcon'
import { Source, useSourcesStore } from '@/stores/sources.store'
import { buildColorMapFromSources, SourceColor } from '@/lib/sourceColors'
import { api } from '@/lib/api'

interface Props {
  sources: Source[]
  onAddSource: () => void
  onSyncSource: (id: string) => void
  onRemoveSource: (id: string) => void
  onOpenSettings: () => void
}

export function Sidebar({ sources, onAddSource, onSyncSource, onRemoveSource, onOpenSettings }: Props) {
  const { selectedSourceIds, toggleSourceFilter, clearSourceFilter } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)

  return (
    <div
      className="flex h-full flex-shrink-0 flex-col"
      style={{ width: '220px', background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}
    >
      {/* Logo */}
      <div className="drag-region flex items-center gap-2.5"
        style={{ paddingTop: '20px', paddingBottom: '12px', paddingLeft: '16px', paddingRight: '16px', borderBottom: '1px solid var(--color-border)' }}>
        <div className="no-drag flex items-center gap-2.5">
          <FractalsIcon size={20} />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
            Fractals
          </span>
        </div>
      </div>

      {/* Sources */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '14px 10px 10px' }}>
        <div className="no-drag mb-3 flex items-center justify-between" style={{ padding: '0 6px 0' }}>
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
            Sources
          </span>
          <div className="flex items-center gap-1">
            {selectedSourceIds.length > 0 && (
              <button onClick={clearSourceFilter} className="rounded-md px-2 py-0.5 text-[10px] transition-all"
                style={{ color: 'var(--color-accent)', background: 'var(--color-primary-dim)' }}>
                Show all
              </button>
            )}
            <button onClick={onAddSource}
              className="no-drag flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all"
              style={{ color: 'var(--color-primary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-primary-dim)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Add
            </button>
          </div>
        </div>

        {sources.length === 0 ? (
          <p className="px-2 py-2 text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: '1.6' }}>No sources yet</p>
        ) : (
          <div className="flex flex-col gap-1">
            {sources.map((src) => (
              <SourceRow
                key={src.id}
                source={src}
                color={colorMap[src.id]}
                selected={selectedSourceIds.includes(src.id)}
                onToggleFilter={() => toggleSourceFilter(src.id)}
                onSync={onSyncSource}
                onRemove={onRemoveSource}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between"
        style={{ padding: '10px 12px 10px 16px', borderTop: '1px solid var(--color-border)' }}>
        <span className="font-mono text-[10px]" style={{ color: 'var(--color-text-muted)' }}>v0.1.0</span>
        <button onClick={onOpenSettings} title="Settings (⌘,)"
          className="flex items-center justify-center rounded-md p-1.5 transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.background = 'var(--color-card)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'transparent' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function SourceRow({
  source, color, selected, onToggleFilter, onSync, onRemove,
}: {
  source: Source
  color: SourceColor
  selected: boolean
  onToggleFilter: () => void
  onSync: (id: string) => void
  onRemove: (id: string) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { updateSource } = useSourcesStore()
  const qc = useQueryClient()

  const handleToggleDisabled = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const res = await api.sources.toggleDisabled(source.id)
    updateSource(source.id, { disabled: (res as any).disabled })
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['browse'] })
    qc.invalidateQueries({ queryKey: ['search'] })
  }

  if (confirmDelete) {
    return (
      <div className="rounded-xl p-3" style={{ background: 'rgba(224,108,117,0.08)', border: '1px solid rgba(224,108,117,0.2)' }}>
        <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--color-error)' }}>Remove "{source.name}"?</p>
        <p className="mb-3 text-[10px]" style={{ color: 'var(--color-text-muted)', lineHeight: '1.6' }}>
          Permanently deletes all synced content from this account.
        </p>
        <div className="flex gap-1.5">
          <button onClick={() => setConfirmDelete(false)}
            className="flex-1 rounded-lg py-1.5 text-[11px] transition-colors"
            style={{ background: 'var(--color-card)', color: 'var(--color-text-secondary)' }}>
            Cancel
          </button>
          <button onClick={() => { setConfirmDelete(false); onRemove(source.id) }}
            className="flex-1 rounded-lg py-1.5 text-[11px] font-semibold"
            style={{ background: 'rgba(224,108,117,0.2)', color: 'var(--color-error)' }}>
            Delete
          </button>
        </div>
      </div>
    )
  }

  const isActive = !source.disabled
  const isSyncing = source.status === 'syncing'

  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-xl transition-all"
      style={{
        background: selected ? color.dim : 'var(--color-card)',
        border: `1px solid ${selected ? color.accent + '40' : 'var(--color-border)'}`,
        opacity: source.disabled ? 0.5 : 1,
      }}
      onClick={onToggleFilter}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.borderColor = color.accent + '30' }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.borderColor = 'var(--color-border)' }}
    >
      {/* Colored left stripe */}
      <div
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ background: isActive ? color.accent : 'var(--color-text-muted)', opacity: selected ? 1 : 0.5 }}
      />

      <div style={{ padding: '10px 10px 8px 14px' }}>
        <div className="flex items-center gap-2">
          {/* Source name */}
          <span className="min-w-0 flex-1 truncate text-xs font-semibold"
            style={{ color: selected ? color.accent : 'var(--color-text-primary)' }}>
            {source.name}
          </span>

          {/* Status indicator */}
          {isSyncing && (
            <div className="h-1.5 w-1.5 animate-pulse rounded-full shrink-0"
              style={{ background: 'var(--color-warning)', boxShadow: '0 0 5px var(--color-warning)' }} />
          )}
          {!isSyncing && source.status === 'error' && (
            <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: 'var(--color-error)' }} />
          )}

          {/* Hover actions */}
          <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
            <IconBtn title={source.disabled ? 'Enable' : 'Disable'} onClick={handleToggleDisabled}>
              {source.disabled ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </IconBtn>
            {isActive && (
              <IconBtn title="Sync" onClick={() => onSync(source.id)} disabled={isSyncing}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />
                </svg>
              </IconBtn>
            )}
            <IconBtn title="Delete" onClick={() => setConfirmDelete(true)} danger>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </IconBtn>
          </div>
        </div>

        {/* Subtitle */}
        <p className="mt-0.5 text-[10px]" style={{ color: selected ? color.accent + 'aa' : 'var(--color-text-muted)' }}>
          {source.disabled ? 'Disabled' :
           isSyncing ? 'Syncing…' :
           source.itemCount > 0 ? `${source.itemCount.toLocaleString()} items` : 'Not synced'}
        </p>
      </div>
    </div>
  )
}

function IconBtn({ children, title, onClick, disabled, danger }: {
  children: React.ReactNode; title: string
  onClick: (e: React.MouseEvent) => void; disabled?: boolean; danger?: boolean
}) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className="flex items-center justify-center rounded-md p-1.5 transition-colors disabled:opacity-40"
      style={{ color: danger ? 'var(--color-error)' : 'var(--color-text-muted)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'rgba(224,108,117,0.15)' : 'rgba(255,255,255,0.08)'
        e.currentTarget.style.color = danger ? 'var(--color-error)' : 'var(--color-text-primary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = danger ? 'var(--color-error)' : 'var(--color-text-muted)'
      }}>
      {children}
    </button>
  )
}
