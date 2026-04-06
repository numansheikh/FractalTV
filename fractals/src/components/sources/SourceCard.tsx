import { useState, useRef, useEffect } from 'react'
import { Source, SyncProgress, useSourcesStore } from '@/stores/sources.store'
import { useAppStore } from '@/stores/app.store'
import { buildColorMap } from '@/lib/sourceColors'
import { api } from '@/lib/api'

interface Props {
  source: Source
  onSync: (id: string) => void
  onRemove: (id: string) => void
  onClose?: () => void
}

function relativeTime(ts?: number): string {
  if (!ts) return 'Never'
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatExpDate(expDate: string | null | undefined): { label: string; color: string } | null {
  if (!expDate) return null
  const ts = Number(expDate) * 1000
  if (!ts || isNaN(ts)) return null
  const now = Date.now()
  const daysLeft = Math.floor((ts - now) / 86400000)
  const date = new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

  if (daysLeft < 0) return { label: `Expired ${date}`, color: 'var(--accent-danger)' }
  if (daysLeft < 30) return { label: `Expires ${date} (${daysLeft}d)`, color: 'var(--accent-warning)' }
  return { label: `Expires ${date}`, color: 'var(--accent-success)' }
}

const PHASE_LABELS: Record<SyncProgress['phase'], string> = {
  categories: 'Syncing categories',
  live: 'Syncing live channels',
  movies: 'Syncing movies',
  series: 'Syncing series',
  done: 'Done',
  error: 'Error',
}

export function SourceCard({ source, onSync, onRemove }: Props) {
  const { sources, syncProgress } = useSourcesStore()
  const progress = syncProgress[source.id] ?? null

  // Build color map from all source ids
  const colorMap = buildColorMap(sources.map(s => s.id))
  const color = colorMap[source.id]

  const [menuOpen, setMenuOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: source.name,
    serverUrl: source.serverUrl ?? '',
    username: source.username ?? '',
    password: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const isSyncing = progress !== null && progress.phase !== 'done' && progress.phase !== 'error'
  const syncPct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0

  const expInfo = formatExpDate(source.expDate)

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      const result = await api.sources.update({
        sourceId: source.id,
        name: editForm.name || undefined,
        serverUrl: editForm.serverUrl || undefined,
        username: editForm.username || undefined,
        password: editForm.password || undefined,
      })
      if ((result as any).success === false) {
        setSaveError((result as any).error ?? 'Failed to save')
      } else {
        setEditMode(false)
      }
    } catch (e) {
      setSaveError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleDisable = async () => {
    setMenuOpen(false)
    await api.sources.toggleDisabled(source.id)
    // If disabling, remove this source from the active filter so content doesn't ghost
    if (!source.disabled) {
      const { selectedSourceIds, toggleSourceFilter } = useAppStore.getState()
      if (selectedSourceIds.includes(source.id)) toggleSourceFilter(source.id)
    }
  }

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setMenuOpen(false)
    setConfirmDelete(false)
    onRemove(source.id)
  }

  const dotColor = source.status === 'error'
    ? 'var(--accent-danger)'
    : source.disabled
      ? 'var(--text-3)'
      : color.accent

  return (
    <div style={{
      background: 'var(--bg-2)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 8,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      opacity: source.disabled ? 0.6 : 1,
      transition: 'opacity 0.15s',
    }}>
      {/* Top row: dot + name + menu */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Colored dot */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
          boxShadow: source.status !== 'error' && !source.disabled
            ? `0 0 0 2px ${color.glow}`
            : 'none',
        }} />

        {/* Source name */}
        <span style={{
          flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-0)',
          fontFamily: 'var(--font-ui)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {source.name}
        </span>

        {/* ··· menu button */}
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            onClick={() => { setMenuOpen(v => !v); setConfirmDelete(false) }}
            style={{
              width: 24, height: 24, borderRadius: 5, border: 'none',
              background: menuOpen ? 'var(--bg-3)' : 'transparent',
              color: 'var(--text-2)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, letterSpacing: 1, transition: 'background 0.1s, color 0.1s',
              fontFamily: 'var(--font-ui)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--text-0)' }}
            onMouseLeave={(e) => { if (!menuOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-2)' } }}
          >
            ···
          </button>

          {menuOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4,
              background: 'var(--bg-1)', border: '1px solid var(--border-default)',
              borderRadius: 8, padding: '4px 0',
              minWidth: 160, zIndex: 100,
              boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            }}>
              <MenuButton onClick={() => { setMenuOpen(false); onSync(source.id) }} disabled={isSyncing}>
                Sync now
              </MenuButton>
              <MenuButton onClick={() => { setMenuOpen(false); setEditMode(v => !v) }}>
                Edit credentials
              </MenuButton>
              <MenuButton onClick={handleToggleDisable}>
                {source.disabled ? 'Enable' : 'Disable'}
              </MenuButton>
              <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
              <MenuButton
                onClick={handleDelete}
                color={confirmDelete ? 'var(--accent-danger)' : undefined}
              >
                {confirmDelete ? 'Click again to confirm' : 'Delete'}
              </MenuButton>
            </div>
          )}
        </div>
      </div>

      {/* URL row */}
      <div style={{
        fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {source.serverUrl || '—'}
      </div>

      {/* Stats row */}
      <div style={{ fontSize: 11, color: 'var(--text-1)' }}>
        {source.itemCount.toLocaleString()} items · Last sync: {relativeTime(source.lastSync)}
      </div>

      {/* Account / expiry row */}
      {expInfo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: expInfo.color }}>
            {expInfo.label}
          </span>
          {source.maxConnections != null && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 6px',
              borderRadius: 4, background: 'var(--bg-3)',
              color: 'var(--text-2)', fontFamily: 'var(--font-ui)',
            }}>
              {source.maxConnections} conn
            </span>
          )}
        </div>
      )}

      {/* Sync progress */}
      {isSyncing && progress && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text-1)', fontFamily: 'var(--font-ui)' }}>
              {PHASE_LABELS[progress.phase]}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
              {progress.current.toLocaleString()} / {progress.total.toLocaleString()}
            </span>
          </div>
          <div style={{
            height: 3, borderRadius: 99, overflow: 'hidden',
            background: 'var(--bg-3)', width: '100%',
          }}>
            <div style={{
              height: '100%', background: 'var(--accent-interactive)',
              width: `${syncPct}%`, transition: 'width 0.3s',
              borderRadius: 99,
            }} />
          </div>
        </div>
      )}

      {/* Error message */}
      {source.status === 'error' && source.lastError && !isSyncing && (
        <div style={{
          fontSize: 10, color: 'var(--accent-danger)',
          padding: '5px 8px', borderRadius: 5,
          background: 'color-mix(in srgb, var(--accent-danger) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent-danger) 20%, transparent)',
          lineHeight: 1.5,
        }}>
          {source.lastError}
        </div>
      )}

      {/* Edit mode form */}
      {editMode && (
        <div style={{
          marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8,
          padding: '12px', borderRadius: 6,
          background: 'var(--bg-1)', border: '1px solid var(--border-subtle)',
        }}>
          <InlineField label="Name" value={editForm.name}
            onChange={(v) => setEditForm(f => ({ ...f, name: v }))} />
          <InlineField label="Server URL" value={editForm.serverUrl}
            onChange={(v) => setEditForm(f => ({ ...f, serverUrl: v }))} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <InlineField label="Username" value={editForm.username}
              onChange={(v) => setEditForm(f => ({ ...f, username: v }))} />
            <InlineField label="Password" value={editForm.password} type="password"
              placeholder="(unchanged)"
              onChange={(v) => setEditForm(f => ({ ...f, password: v }))} />
          </div>

          {saveError && (
            <p style={{ fontSize: 10, color: 'var(--accent-danger)', margin: 0 }}>{saveError}</p>
          )}

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => { setEditMode(false); setSaveError('') }}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 11,
                background: 'transparent', border: '1px solid var(--border-default)',
                color: 'var(--text-1)', cursor: 'pointer', fontFamily: 'var(--font-ui)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: 'var(--accent-interactive)', border: 'none',
                color: '#fff', cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.6 : 1, fontFamily: 'var(--font-ui)',
                transition: 'opacity 0.1s',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Bottom action buttons */}
      {!editMode && (
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <ActionButton
            onClick={() => onSync(source.id)}
            disabled={isSyncing}
          >
            {isSyncing ? 'Syncing…' : 'Sync'}
          </ActionButton>
          <ActionButton onClick={handleToggleDisable}>
            {source.disabled ? 'Enable' : 'Disable'}
          </ActionButton>
        </div>
      )}
    </div>
  )
}

/* ── Inner helpers ──────────────────────────────────────────────── */
function MenuButton({
  children, onClick, disabled, color,
}: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; color?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '6px 12px', fontSize: 11, fontWeight: 500,
        background: 'transparent', border: 'none',
        color: color ?? 'var(--text-0)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'var(--font-ui)',
        transition: 'background 0.08s',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--bg-2)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

function ActionButton({
  children, onClick, disabled,
}: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500,
        background: 'var(--bg-3)', border: '1px solid var(--border-subtle)',
        color: 'var(--text-1)', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1, fontFamily: 'var(--font-ui)',
        transition: 'background 0.1s, color 0.1s, opacity 0.1s',
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.color = 'var(--text-0)' } }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--text-1)' }}
    >
      {children}
    </button>
  )
}

function InlineField({
  label, value, onChange, type = 'text', placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; placeholder?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
        textTransform: 'uppercase', color: 'var(--text-2)',
        fontFamily: 'var(--font-ui)',
      }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--bg-2)', border: '1px solid var(--border-default)',
          borderRadius: 5, padding: '5px 8px', fontSize: 11,
          color: 'var(--text-0)', caretColor: 'var(--accent-interactive)',
          outline: 'none', fontFamily: 'var(--font-ui)', transition: 'border-color 0.12s',
          width: '100%', boxSizing: 'border-box',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-interactive)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)' }}
      />
    </div>
  )
}
