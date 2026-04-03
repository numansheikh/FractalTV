import { FractalsIcon } from '@/components/shared/FractalsIcon'
import { Source } from '@/stores/sources.store'

interface Props {
  sources: Source[]
  onAddSource: () => void
  onSyncSource: (id: string) => void
  onRemoveSource: (id: string) => void
  onOpenSettings: () => void
}

export function Sidebar({ sources, onAddSource, onSyncSource, onRemoveSource, onOpenSettings }: Props) {
  return (
    <div
      className="flex h-full flex-shrink-0 flex-col"
      style={{
        width: '212px',
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      {/* Logo — drag region with macOS traffic lights offset */}
      <div
        className="drag-region flex items-center gap-2.5"
        style={{
          paddingTop: '20px',
          paddingBottom: '12px',
          paddingLeft: '16px',
          paddingRight: '16px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div className="no-drag flex items-center gap-2.5">
          <FractalsIcon size={20} />
          <span
            className="text-sm font-semibold"
            style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}
          >
            Fractals
          </span>
        </div>
      </div>

      {/* Sources section */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '14px 10px 10px' }}>
        <div
          className="no-drag mb-2 flex items-center justify-between"
          style={{ padding: '0 6px 2px' }}
        >
          <span
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Sources
          </span>
          <button
            onClick={onAddSource}
            className="no-drag flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all"
            style={{ color: 'var(--color-primary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-primary-dim)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Add
          </button>
        </div>

        {sources.length === 0 ? (
          <div style={{ padding: '8px 6px' }}>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: '1.6' }}>
              No sources yet
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {sources.map((src) => (
              <SourceRow
                key={src.id}
                source={src}
                onSync={onSyncSource}
                onRemove={onRemoveSource}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between"
        style={{ padding: '10px 12px 10px 16px', borderTop: '1px solid var(--color-border)' }}
      >
        <span className="font-mono text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          v0.1.0
        </span>
        <button
          onClick={onOpenSettings}
          className="flex items-center justify-center rounded-md p-1.5 transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          title="Settings (⌘,)"
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.background = 'var(--color-card)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'transparent' }}
        >
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
  source,
  onSync,
  onRemove,
}: {
  source: Source
  onSync: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <div
      className="group rounded-lg"
      style={{ padding: '8px 8px 6px' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-card)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={source.status} />
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {source.name}
        </span>
        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <IconButton title="Sync" onClick={() => onSync(source.id)} disabled={source.status === 'syncing'}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </IconButton>
          <IconButton title="Remove" onClick={() => onRemove(source.id)} danger>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 1l8 8M9 1L1 9" />
            </svg>
          </IconButton>
        </div>
      </div>

      <div style={{ paddingLeft: '18px', marginTop: '2px' }}>
        <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          {source.status === 'syncing'
            ? 'Syncing…'
            : source.itemCount > 0
              ? `${source.itemCount.toLocaleString()} items`
              : 'Not synced'}
        </p>
      </div>
    </div>
  )
}

function IconButton({
  children, title, onClick, disabled, danger,
}: {
  children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean
}) {
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      disabled={disabled}
      className="flex items-center justify-center rounded p-1.5 transition-colors disabled:opacity-40"
      style={{ color: danger ? 'var(--color-error)' : 'var(--color-text-secondary)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'rgba(248,113,113,0.1)' : 'var(--color-card-hover)'
        e.currentTarget.style.color = danger ? 'var(--color-error)' : 'var(--color-text-primary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = danger ? 'var(--color-error)' : 'var(--color-text-secondary)'
      }}
    >
      {children}
    </button>
  )
}

function StatusDot({ status }: { status: Source['status'] }) {
  const color =
    status === 'active' ? 'var(--color-success)' :
    status === 'error' ? 'var(--color-error)' :
    'var(--color-warning)'
  return (
    <div
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color, boxShadow: status === 'syncing' ? `0 0 6px var(--color-warning)` : undefined }}
    />
  )
}
