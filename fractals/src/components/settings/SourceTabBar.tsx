import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Source, SyncProgress, useSourcesStore } from '@/stores/sources.store'
import { buildColorMap, SourceColor } from '@/lib/sourceColors'
import { api } from '@/lib/api'

interface Props {
  sources: Source[]
  onAddSource: () => void
  onSyncSource: (id: string) => void
  onRemoveSource: (id: string) => void
  /** When true, renders as a fragment (no outer div) — for embedding in another bar */
  inline?: boolean
}

const PHASE_LABEL: Record<string, string> = {
  categories: 'Categories',
  live: 'Live',
  movies: 'Movies',
  series: 'Series',
  done: 'Done',
  error: 'Error',
}

/** Returns days until expiry. Negative = already expired. null = unknown. */
function daysUntilExpiry(expDate?: string | null): number | null {
  if (!expDate) return null
  const ts = parseInt(expDate) * 1000
  if (isNaN(ts)) return null
  return Math.floor((ts - Date.now()) / 86_400_000)
}

function expiryColor(days: number | null): string {
  if (days === null) return 'var(--color-success)'
  if (days < 0)   return 'var(--color-danger)'
  if (days < 30)  return 'var(--color-warning)'
  return 'var(--color-success)'
}

function expiryLabel(days: number | null): string {
  if (days === null) return 'Unknown expiry'
  if (days < 0)   return `Expired ${Math.abs(days)}d ago`
  if (days === 0) return 'Expires today'
  if (days < 30)  return `Expires in ${days}d`
  const ms = (parseInt('0') || Date.now()) // placeholder
  return `${days}d remaining`
}

export function SourceTabBar({ sources, onAddSource, onSyncSource, onRemoveSource, inline }: Props) {
  const { selectedSourceIds, toggleSourceFilter, clearSourceFilter } = useSourcesStore()
  const colorMap = buildColorMap(sources.map((s) => s.id))
  const allSelected = selectedSourceIds.length === 0
  const totalItems = sources.filter(s => !s.disabled).reduce((n, s) => n + s.itemCount, 0)

  const content = (<>

      {/* ── Source "All" tab ─────────────────────────────────────────────── */}
      <button
        onClick={clearSourceFilter}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '0 12px', border: 'none',
          borderTop: allSelected ? '2px solid var(--color-primary)' : '2px solid transparent',
          borderRight: '1px solid var(--color-border)',
          background: 'transparent', cursor: 'pointer', transition: 'all 0.12s',
        }}
        onMouseEnter={(e) => { if (!allSelected) (e.currentTarget.querySelector('span') as HTMLElement).style.color = 'var(--color-text-primary)' }}
        onMouseLeave={(e) => { if (!allSelected) (e.currentTarget.querySelector('span') as HTMLElement).style.color = 'var(--color-text-secondary)' }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: allSelected ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
          All
        </span>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'monospace', marginLeft: 4 }}>
          {totalItems.toLocaleString()}
        </span>
      </button>

      {sources.map((src) => (
        <SourceTab
          key={src.id}
          source={src}
          colorObj={colorMap[src.id]}
          selected={selectedSourceIds.includes(src.id)}
          onSelect={() => toggleSourceFilter(src.id)}
          onSync={onSyncSource}
          onRemove={onRemoveSource}
        />
      ))}

      <button
        onClick={onAddSource}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '0 10px', border: 'none', borderTop: '2px solid transparent',
          background: 'transparent',
          color: 'var(--color-text-muted)',
          fontSize: 11, cursor: 'pointer', transition: 'color 0.12s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Add source
      </button>
    </>
  )

  if (inline) return content

  return (
    <div style={{
      display: 'flex', alignItems: 'center', overflow: 'hidden', flexShrink: 0,
      background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)',
      minHeight: 40, justifyContent: 'flex-end',
    }}>
      {content}
    </div>
  )
}

function SourceTab({ source, colorObj, selected, onSelect, onSync, onRemove }: {
  source: Source; colorObj: SourceColor; selected: boolean
  onSelect: () => void; onSync: (id: string) => void; onRemove: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { updateSource, syncProgress } = useSourcesStore()
  const qc = useQueryClient()
  const isSyncing = source.status === 'syncing'
  const progress: SyncProgress | null = syncProgress[source.id] ?? null
  const days = daysUntilExpiry(source.expDate)

  // Dot color = source identity color, with status shown via overlay/opacity
  const hasIssue = source.status === 'error' || (days !== null && days < 0)
  const isWarning = days !== null && days > 0 && days < 30

  const handleToggleDisabled = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const res = await api.sources.toggleDisabled(source.id)
    updateSource(source.id, { disabled: (res as any).disabled })
    // Invalidate all content queries so disabled source content disappears
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['browse'] })
    qc.invalidateQueries({ queryKey: ['search'] })
  }

  if (confirmDelete) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 7, background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-danger) 25%, transparent)', fontSize: 11 }}>
        <span style={{ color: 'var(--color-error)', fontWeight: 500 }}>Remove "{source.name}"?</span>
        <button onClick={() => setConfirmDelete(false)} style={cancelBtnStyle}>Cancel</button>
        <button onClick={() => { setConfirmDelete(false); onRemove(source.id) }} style={deleteBtnStyle}>Delete</button>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        onClick={onSelect}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '0 10px', borderRadius: 0,
          border: 'none',
          borderTop: `2px solid ${selected ? colorObj.accent : 'transparent'}`,
          borderRight: '1px solid var(--color-border)',
          background: hovered ? colorObj.dim : 'transparent',
          cursor: 'pointer', transition: 'all 0.12s',
          opacity: source.disabled ? 0.45 : 1, userSelect: 'none',
          minHeight: 40,
        }}
      >
        {/* Source identity dot — color = source, ring = status */}
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: hasIssue ? 'var(--color-danger)' : colorObj.accent,
          flexShrink: 0,
          boxShadow: hasIssue
            ? '0 0 5px color-mix(in srgb, var(--color-danger) 55%, transparent)'
            : isWarning
              ? `0 0 5px color-mix(in srgb, var(--color-warning) 55%, transparent)`
              : `0 0 5px color-mix(in srgb, ${colorObj.accent} 40%, transparent)`,
          ...(isSyncing ? { animation: 'pulse 1.2s ease-in-out infinite' } : {}),
        }} />

        {/* Name — always source color, stronger when selected */}
        <span style={{
          fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
          color: colorObj.accent,
        }}>
          {source.name}
        </span>

        {/* Fixed-width right section: count + overlaid hover actions */}
        {isSyncing && progress ? (
          <SyncProgressPill progress={progress} color={colorObj.accent} />
        ) : (
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', minWidth: 92, justifyContent: 'flex-end' }}>
            {/* Count — always present for stable width */}
            <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontFamily: 'monospace', opacity: hovered ? 0 : 1, transition: 'opacity 0.1s' }}>
              {source.itemCount.toLocaleString()}
            </span>
            {/* Actions — overlaid on top, same space */}
            <div style={{
              position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
              display: 'flex', alignItems: 'center', gap: 1,
              opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none',
              transition: 'opacity 0.1s',
            }} onClick={(e) => e.stopPropagation()}>
              <IconBtn title="Account info" onClick={(e) => { e.stopPropagation(); setShowInfo(v => !v) }} active={showInfo}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </IconBtn>
              <IconBtn title="Sync" onClick={() => onSync(source.id)} disabled={source.disabled}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />
                </svg>
              </IconBtn>
              <IconBtn title={source.disabled ? 'Enable' : 'Disable'} onClick={handleToggleDisabled}>
                {source.disabled
                  ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                  : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                }
              </IconBtn>
              <IconBtn title="Delete" onClick={() => setConfirmDelete(true)} danger>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </IconBtn>
            </div>
          </div>
        )}
      </div>

      {/* Account info popover — rendered via fixed positioning to escape overflow:hidden */}
      {showInfo && (
        <AccountInfoPopover source={source} color={colorObj.accent} days={days} dotColor={colorObj.accent}
          onClose={() => setShowInfo(false)} anchorRef={ref} />
      )}
    </div>
  )
}

function SyncProgressPill({ progress, color }: { progress: SyncProgress; color: string }) {
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null
  const label = PHASE_LABEL[progress.phase] ?? progress.phase

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
          {label}{progress.current > 0 ? ` ${progress.current.toLocaleString()}` : '…'}
          {progress.total > 0 && progress.current > 0 && `/${progress.total.toLocaleString()}`}
        </span>
        {pct !== null && (
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>
            {pct}%
          </span>
        )}
      </div>
      <div style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        {pct !== null ? (
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 1, transition: 'width 0.3s ease' }} />
        ) : (
          <div style={{ height: '100%', width: '40%', background: color, borderRadius: 1, animation: 'shimmer 1.4s ease-in-out infinite' }} />
        )}
      </div>
    </div>
  )
}

function AccountInfoPopover({ source, color, days, dotColor, onClose, anchorRef }: {
  source: Source; color: string; days: number | null; dotColor: string; onClose: () => void
  anchorRef: React.RefObject<HTMLDivElement | null>
}) {
  const [liveInfo, setLiveInfo] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(source.name)
  const [editServer, setEditServer] = useState(source.serverUrl ?? '')
  const [editUser, setEditUser] = useState(source.username ?? '')
  const [editPass, setEditPass] = useState(source.password ?? '')
  const [saving, setSaving] = useState(false)
  const { updateSource } = useSourcesStore()
  const ref = useRef<HTMLDivElement>(null)

  // Measure anchor position after mount, anchor popover to right edge of tab
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  useEffect(() => {
    const r = anchorRef.current?.getBoundingClientRect()
    if (r) {
      setPos({ top: r.bottom + 8, right: window.innerWidth - r.right })
    }
  }, [])

  useEffect(() => {
    api.sources.accountInfo(source.id).then((res: any) => {
      setLiveInfo(res)
      setLoading(false)
    })
  }, [source.id])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => window.addEventListener('mousedown', handler), 0)
    return () => window.removeEventListener('mousedown', handler)
  }, [onClose])

  const handleSave = async () => {
    setSaving(true)
    const args: any = { sourceId: source.id }
    if (editName !== source.name) args.name = editName
    if (editServer !== (source.serverUrl ?? '')) args.serverUrl = editServer
    if (editUser !== (source.username ?? '')) args.username = editUser
    if (editPass !== (source.password ?? '')) args.password = editPass
    const res = await api.sources.update(args)
    if ((res as any).success) {
      updateSource(source.id, {
        name: editName,
        serverUrl: editServer,
        username: editUser,
        password: editPass,
      })
    }
    setSaving(false)
    setEditing(false)
  }

  const info = liveInfo?.userInfo ?? {}
  const expDays = liveInfo?.success ? daysUntilExpiry(info.exp_date) : days
  const statusColor = liveInfo?.success === false || (expDays !== null && expDays < 0)
    ? 'var(--color-danger)'
    : expDays !== null && expDays < 30
      ? 'var(--color-warning)'
      : 'var(--color-success)'

  // Format expiry date
  let expiryText = '—'
  if (info.exp_date) {
    const ts = parseInt(info.exp_date) * 1000
    if (!isNaN(ts)) {
      expiryText = new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      if (expDays !== null && expDays < 30) expiryText += ` (${expDays < 0 ? 'expired' : expDays + 'd left'})`
    }
  }

  // Last sync
  let lastSyncText = 'Never'
  if (source.lastSync) {
    const diff = Math.floor((Date.now() - source.lastSync * 1000) / 60000)
    if (diff < 1) lastSyncText = 'Just now'
    else if (diff < 60) lastSyncText = `${diff}m ago`
    else if (diff < 1440) lastSyncText = `${Math.floor(diff / 60)}h ago`
    else lastSyncText = `${Math.floor(diff / 1440)}d ago`
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '4px 7px', borderRadius: 5, fontSize: 11,
    background: 'var(--color-bg)', border: '1px solid var(--color-border-strong)',
    color: 'var(--color-text-primary)', outline: 'none', fontFamily: 'inherit',
  }

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0, right: Math.max(12, pos?.right ?? 0),
        width: 260, opacity: pos ? 1 : 0,
        background: 'var(--color-card)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        zIndex: 200,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', flex: 1 }}>{source.name}</span>
        {loading && <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>checking…</span>}
        {!loading && !editing && (
          <span style={{ fontSize: 10, fontWeight: 600, color: statusColor, padding: '1px 6px', borderRadius: 4, background: statusColor + '18' }}>
            {liveInfo?.success === false ? 'Unreachable' : expDays !== null && expDays < 0 ? 'Expired' : 'Active'}
          </span>
        )}
      </div>

      {editing ? (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <label style={{ fontSize: 9, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Name</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 9, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Server URL</label>
            <input value={editServer} onChange={(e) => setEditServer(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 9, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Username</label>
            <input value={editUser} onChange={(e) => setEditUser(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 9, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Password</label>
            <input type="password" value={editPass} onChange={(e) => setEditPass(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button onClick={() => setEditing(false)}
              style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: 'none', fontSize: 11, background: 'var(--color-surface)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, background: 'var(--color-primary)', color: '#fff', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Rows */}
          <div style={{ padding: '8px 0' }}>
            <Row label="Expires"     value={loading ? '…' : expiryText}             valueColor={expDays !== null && expDays < 30 ? statusColor : undefined} />
            <Row label="Connections" value={loading ? '…' : info.active_cons && info.max_connections ? `${info.active_cons} / ${info.max_connections}` : '—'} />
            <Row label="Plan"        value={loading ? '…' : info.subscription_type || (info.is_trial === '1' ? 'Trial' : '—')} />
            <Row label="Last synced" value={lastSyncText} />
            <Row label="Items"       value={source.itemCount.toLocaleString()} />
            {source.serverUrl && <Row label="Server" value={source.serverUrl.replace(/^https?:\/\//, '')} mono />}
            {source.username && <Row label="Username" value={source.username} mono />}
          </div>

          {/* Edit button */}
          <div style={{ padding: '0 10px 10px' }}>
            <button onClick={() => setEditing(true)}
              style={{
                width: '100%', padding: '5px 0', borderRadius: 6, border: '1px solid var(--color-border-strong)',
                fontSize: 11, fontWeight: 500, background: 'transparent', color: 'var(--color-text-secondary)',
                cursor: 'pointer', transition: 'all 0.1s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.color = 'var(--color-primary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}
            >
              Edit source
            </button>
          </div>

          {/* Error message */}
          {liveInfo?.success === false && (
            <div style={{ margin: '0 10px 10px', padding: '6px 8px', borderRadius: 6, background: 'rgba(224,108,117,0.08)', border: '1px solid rgba(224,108,117,0.15)' }}>
              <p style={{ fontSize: 10, color: 'var(--color-error)', lineHeight: 1.5 }}>
                {liveInfo.error?.includes('401') || liveInfo.error?.includes('403')
                  ? 'Subscription may have expired or credentials are invalid.'
                  : liveInfo.error ?? 'Could not reach server.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Row({ label, value, valueColor, mono }: { label: string; value: string; valueColor?: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '3px 12px' }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0, marginRight: 8 }}>{label}</span>
      <span style={{ fontSize: 11, color: valueColor ?? 'var(--color-text-primary)', fontFamily: mono ? 'monospace' : 'inherit', textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )
}

function IconBtn({ children, title, onClick, disabled, danger, active }: {
  children: React.ReactNode; title: string
  onClick: (e: React.MouseEvent) => void; disabled?: boolean; danger?: boolean; active?: boolean
}) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      style={{
        width: 22, height: 22, borderRadius: 5, border: 'none',
        background: active ? 'var(--color-primary-dim)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: active ? 'var(--color-primary)' : danger ? 'var(--color-danger)' : 'var(--color-text-secondary)',
        transition: 'all 0.1s', opacity: disabled ? 0.35 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.background = danger ? 'color-mix(in srgb, var(--color-danger) 15%, transparent)' : active ? 'color-mix(in srgb, var(--color-primary) 22%, transparent)' : 'var(--color-card)'
        e.currentTarget.style.color = danger ? 'var(--color-danger)' : active ? 'var(--color-primary)' : 'var(--color-text-primary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? 'var(--color-primary-dim)' : 'transparent'
        e.currentTarget.style.color = active ? 'var(--color-primary)' : danger ? 'var(--color-danger)' : 'var(--color-text-secondary)'
      }}
    >
      {children}
    </button>
  )
}

const cancelBtnStyle: React.CSSProperties = {
  padding: '2px 8px', borderRadius: 5, border: 'none',
  background: 'var(--color-card)', color: 'var(--color-text-primary)',
  cursor: 'pointer', fontSize: 11,
}
const deleteBtnStyle: React.CSSProperties = {
  padding: '2px 8px', borderRadius: 5, border: 'none',
  background: 'rgba(224,108,117,0.2)', color: 'var(--color-error)',
  cursor: 'pointer', fontSize: 11, fontWeight: 600,
}
