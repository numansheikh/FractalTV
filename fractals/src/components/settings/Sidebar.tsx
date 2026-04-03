import { FractalsIcon } from '@/components/shared/FractalsIcon'
import { Source } from '@/stores/sources.store'

interface Props {
  sources: Source[]
  onAddSource: () => void
  onSyncSource: (id: string) => void
  onRemoveSource: (id: string) => void
}

export function Sidebar({ sources, onAddSource, onSyncSource, onRemoveSource }: Props) {
  return (
    <div
      className="flex h-full flex-shrink-0 flex-col"
      style={{
        width: '200px',
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      {/* Logo — drag region safe zone with macOS traffic lights offset */}
      <div
        className="drag-region flex items-center gap-2.5"
        style={{
          paddingTop: '18px',
          paddingBottom: '10px',
          paddingLeft: '16px',
          paddingRight: '16px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div className="no-drag flex items-center gap-2.5">
          <FractalsIcon size={20} />
          <span
            className="text-sm font-semibold tracking-tight"
            style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}
          >
            Fractals
          </span>
        </div>
      </div>

      {/* Sources section */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '12px 8px' }}>
        {/* Section header */}
        <div
          className="no-drag mb-1 flex items-center justify-between"
          style={{ padding: '0 8px 4px' }}
        >
          <span
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}
          >
            Sources
          </span>
          <button
            onClick={onAddSource}
            className="no-drag flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-all"
            style={{ color: 'var(--color-primary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--color-primary-dim)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Add
          </button>
        </div>

        {sources.length === 0 ? (
          <div style={{ padding: '8px 8px' }}>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
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
        style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <span
          className="font-mono text-[10px]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          v0.1.0
        </span>
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
      className="group rounded-md"
      style={{ padding: '6px 8px' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--color-card)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={source.status} />
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {source.name}
        </span>
        {/* Action icons — appear on hover */}
        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <IconButton
            title="Sync"
            onClick={() => onSync(source.id)}
            disabled={source.status === 'syncing'}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ transform: source.status === 'syncing' ? 'rotate(360deg)' : undefined }}
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </IconButton>
          <IconButton
            title="Remove"
            onClick={() => onRemove(source.id)}
            danger
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M1 1l8 8M9 1L1 9" />
            </svg>
          </IconButton>
        </div>
      </div>

      <div style={{ paddingLeft: '16px' }}>
        <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          {source.status === 'syncing'
            ? 'Syncing...'
            : source.itemCount > 0
              ? `${source.itemCount.toLocaleString()} items`
              : 'Not synced'}
        </p>
      </div>
    </div>
  )
}

function IconButton({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      className="flex items-center justify-center rounded p-1 transition-colors disabled:opacity-40"
      style={{ color: danger ? 'var(--color-error)' : 'var(--color-text-secondary)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger
          ? 'rgba(248, 113, 113, 0.1)'
          : 'var(--color-card-hover)'
        e.currentTarget.style.color = danger
          ? 'var(--color-error)'
          : 'var(--color-text-primary)'
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
    status === 'active'
      ? 'var(--color-success)'
      : status === 'error'
        ? 'var(--color-error)'
        : 'var(--color-warning)'

  return (
    <div
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{
        background: color,
        boxShadow: status === 'syncing' ? `0 0 5px var(--color-warning)` : undefined,
      }}
    />
  )
}
