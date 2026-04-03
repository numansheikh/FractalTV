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
      className="flex h-full w-52 flex-shrink-0 flex-col border-r"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <FractalsIcon size={24} />
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Fractals</span>
      </div>

      {/* Sources */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-text-muted)' }}>
            Sources
          </span>
          <button
            onClick={onAddSource}
            className="rounded px-1.5 py-0.5 text-xs transition-colors"
            style={{ color: 'var(--color-primary)' }}
            title="Add source"
          >
            + Add
          </button>
        </div>

        {sources.length === 0 ? (
          <p className="text-xs py-2" style={{ color: 'var(--color-text-muted)' }}>
            No sources yet
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {sources.map((src) => (
              <div key={src.id} className="group rounded-lg p-2.5"
                style={{ background: 'var(--color-card)' }}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="truncate text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {src.name}
                  </span>
                  <StatusDot status={src.status} />
                </div>
                <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  {src.itemCount > 0 ? `${src.itemCount.toLocaleString()} items` : src.status === 'syncing' ? 'Syncing...' : 'Not synced'}
                </p>
                {/* Action buttons — visible on hover */}
                <div className="mt-1.5 hidden gap-1 group-hover:flex">
                  <button onClick={() => onSyncSource(src.id)}
                    className="rounded px-2 py-0.5 text-[10px] transition-colors"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                    ↻ Sync
                  </button>
                  <button onClick={() => onRemoveSource(src.id)}
                    className="rounded px-2 py-0.5 text-[10px] transition-colors"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-error)' }}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Version */}
      <div className="border-t px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
        <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>v0.1.0</span>
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: Source['status'] }) {
  const colors = { active: '#4caf50', error: '#ef5350', syncing: '#ffab40' }
  return (
    <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
      style={{ background: colors[status], boxShadow: status === 'syncing' ? `0 0 4px ${colors.syncing}` : undefined }} />
  )
}
