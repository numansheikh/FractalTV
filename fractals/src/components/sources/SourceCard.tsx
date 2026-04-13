import { useEffect, useState } from 'react'
import { Source, useSourcesStore } from '@/stores/sources.store'
import { useAppStore } from '@/stores/app.store'
import { getSourceColor, PALETTE_HEX } from '@/lib/sourceColors'
import { api } from '@/lib/api'

interface Props {
  source: Source
  onSync: (id: string) => void
  onRemove: (id: string) => void | Promise<void>
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

const PHASE_LABELS: Record<string, string> = {
  categories: 'Downloading categories…',
  live: 'Fetching channels…',
  movies: 'Fetching movies…',
  series: 'Fetching series…',
  fetching: 'Downloading playlist…',
  parsing: 'Parsing playlist…',
  content: 'Saving items…',
  done: 'Done',
  error: 'Error',
}

export function SourceCard({ source, onSync, onRemove }: Props) {
  const { sources, syncProgress, indexProgress, setIndexProgress } = useSourcesStore()
  const { setFtsEnabled } = useAppStore()
  const progress = syncProgress[source.id] ?? null
  const idxProgress = indexProgress[source.id] ?? null

  // Resolve color: use stored colorIndex if set, else auto-assign by position
  const autoIndex = sources.findIndex(s => s.id === source.id)
  const color = getSourceColor(source.colorIndex ?? autoIndex)

  const [editMode, setEditMode] = useState(false)
  // Edit form state
  const isM3u = source.type === 'm3u'
  const [editForm, setEditForm] = useState({
    name: source.name,
    serverUrl: source.serverUrl ?? '',
    username: source.username ?? '',
    password: '',
    m3uUrl: source.m3uUrl ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleTest = async () => {
    console.log(`[source-card] Test clicked for source "${source.name}"`)
    setTesting(true)
    setTestResult(null)
    try {
      if (isM3u) {
        const r = await api.sources.testM3u({ m3uUrl: editForm.m3uUrl })
        setTestResult(r.error
          ? { success: false, message: r.error }
          : { success: true, message: `${(r.count ?? 0).toLocaleString()} items` })
      } else {
        const r = await api.sources.testXtream({ serverUrl: editForm.serverUrl, username: editForm.username, password: editForm.password || source.password || '' })
        setTestResult(r.success
          ? { success: true, message: `${((r as any).itemCount ?? 0).toLocaleString()} items` }
          : { success: false, message: (r as any).error ?? 'Connection failed' })
      }
    } catch (e) {
      setTestResult({ success: false, message: String(e) })
    } finally {
      setTesting(false)
    }
  }


  const isIndexing = idxProgress !== null && idxProgress.phase !== 'done' && idxProgress.phase !== 'error'
  const idxPct = idxProgress && idxProgress.total > 0
    ? Math.min(100, Math.round((idxProgress.current / idxProgress.total) * 100))
    : 0

  const handleBuildFts = async () => {
    if (isIndexing || isSyncing) return
    console.log(`[source-card] Step 5: Index VoD FTS clicked for source "${source.name}"`)
    setIndexProgress(source.id, { phase: 'starting', current: 0, total: 0, message: 'Starting index…' })
    try {
      const result = await api.sources.buildFts(source.id)
      if (result.success) {
        setFtsEnabled(true)
      }
    } finally {
      setIndexProgress(source.id, null)
    }
  }

  const handleBuildCanonical = async () => {
    if (isIndexing || isSyncing) return
    console.log(`[source-card] Step 6: Build Canonical clicked for source "${source.name}"`)
    setIndexProgress(source.id, { phase: 'starting', current: 0, total: 0, message: 'Starting canonical build…' })
    try {
      await api.sources.buildCanonical(source.id)
    } finally {
      setIndexProgress(source.id, null)
    }
  }

  const handleBuildCanonicalFts = async () => {
    if (isIndexing || isSyncing) return
    console.log(`[source-card] Step 7: Canonical FTS clicked for source "${source.name}"`)
    setIndexProgress(source.id, { phase: 'starting', current: 0, total: 0, message: 'Indexing canonical FTS…' })
    try {
      await api.sources.buildCanonicalFts()
    } finally {
      setIndexProgress(source.id, null)
    }
  }

  const [epgRunning, setEpgRunning] = useState(false)
  const handleFetchEpg = async () => {
    if (epgRunning || isSyncing) return
    console.log(`[source-card] Step 4: Fetch EPG clicked for source "${source.name}"`)
    setEpgRunning(true)
    try {
      await api.epg.sync(source.id)
    } finally {
      setEpgRunning(false)
    }
  }

  const [iptvRunning, setIptvRunning] = useState(false)
  const handleFetchIptvOrg = async () => {
    if (iptvRunning) return
    console.log(`[source-card] Fetch iptv-org data clicked (global)`)
    setIptvRunning(true)
    try {
      await api.iptvOrg.refresh()
    } finally {
      setIptvRunning(false)
    }
  }

  const [tvgStats, setTvgStats] = useState<{ total: number; withTvgId: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    api.sources.tvgStats(source.id).then((s) => {
      if (!cancelled) setTvgStats(s)
    })
    return () => { cancelled = true }
  }, [source.id, source.lastSync])

  const isSyncing = progress !== null && progress.phase !== 'done' && progress.phase !== 'error'
  const syncPct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0

  const expInfo = formatExpDate(source.expDate)

  const handleColorPick = (idx: number) => {
    useSourcesStore.getState().updateSource(source.id, { colorIndex: idx })
    api.sources.setColor(source.id, idx) // persist in background
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      const result = await api.sources.update({
        sourceId: source.id,
        name: editForm.name || undefined,
        ...(isM3u
          ? { m3uUrl: editForm.m3uUrl || undefined }
          : {
              serverUrl: editForm.serverUrl || undefined,
              username: editForm.username || undefined,
              password: editForm.password || undefined,
            }
        ),
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

    const result = await api.sources.toggleDisabled(source.id)
    const nowDisabled = result?.disabled ?? !source.disabled
    useSourcesStore.getState().updateSource(source.id, { disabled: nowDisabled })
    // Remove from active filter when disabling so content doesn't ghost
    if (nowDisabled) {
      const { selectedSourceIds, toggleSourceFilter } = useAppStore.getState()
      if (selectedSourceIds.includes(source.id)) toggleSourceFilter(source.id)
    }
  }

  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!window.confirm('Remove this source? All its channels and movies will be deleted.')) return
    setDeleting(true)
    try {
      await onRemove(source.id)
    } catch {
      setDeleting(false)
    }
  }

  const dotColor = source.status === 'error'
    ? 'var(--accent-danger)'
    : source.disabled
      ? 'var(--text-3)'
      : color.accent

  return (
    <div style={{
      background: `color-mix(in srgb, ${color.accent} 5%, var(--bg-3))`,
      border: '1px solid var(--border-subtle)',
      borderLeft: `3px solid ${dotColor}`,
      borderRadius: 8,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      opacity: deleting ? 0.45 : source.disabled ? 0.6 : 1,
      pointerEvents: deleting ? 'none' : 'auto',
      transition: 'opacity 0.15s',
      position: 'relative',
    }}>
      {deleting && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'color-mix(in srgb, var(--bg-0) 60%, transparent)',
          zIndex: 10,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-1)',
            fontFamily: 'var(--font-ui)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
            Removing...
          </span>
        </div>
      )}
      {/* Top row: dot + name + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: dotColor, flexShrink: 0,
          boxShadow: source.status !== 'error' && !source.disabled ? `0 0 0 2px ${color.glow}` : 'none',
        }} />
        <span style={{
          flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-0)',
          fontFamily: 'var(--font-ui)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {source.name}
        </span>
        {!editMode && (
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            <IconButton
              title={source.disabled ? 'Enable' : 'Disable'}
              onClick={handleToggleDisable}
            >
              {source.disabled
                ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>
                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
              }
            </IconButton>
            <IconButton title="Edit" onClick={() => setEditMode(true)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            </IconButton>
            <IconButton title="Delete" color="var(--accent-danger)" onClick={handleDelete}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
            </IconButton>
          </div>
        )}
      </div>

      {/* URL row */}
      <div style={{
        fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {source.m3uUrl || source.serverUrl || '—'}
      </div>

      {/* Stats row */}
      <div style={{ fontSize: 11, color: 'var(--text-1)' }}>
        {source.itemCount.toLocaleString()} items · Last sync: {relativeTime(source.lastSync)}
      </div>
      {tvgStats && tvgStats.total > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
          {tvgStats.withTvgId.toLocaleString()} / {tvgStats.total.toLocaleString()} live streams have tvg_id
          ({((tvgStats.withTvgId / tvgStats.total) * 100).toFixed(0)}%)
        </div>
      )}

      {/* Account / expiry row */}
      {expInfo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: expInfo.color }}>{expInfo.label}</span>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text-1)', fontFamily: 'var(--font-ui)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {progress.message || PHASE_LABELS[progress.phase]}
            </span>
            {syncPct > 0 && (
              <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                {syncPct}%
              </span>
            )}
          </div>
          <div style={{
            height: 3, borderRadius: 99, overflow: 'hidden',
            background: 'var(--bg-3)', width: '100%',
          }}>
            {syncPct > 0 ? (
              <div style={{
                height: '100%', background: 'var(--accent-interactive)',
                width: `${syncPct}%`, transition: 'width 0.3s',
                borderRadius: 99,
              }} />
            ) : (
              <div style={{
                height: '100%', background: 'var(--accent-interactive)',
                width: '35%', borderRadius: 99,
                animation: 'shimmer 1.4s ease-in-out infinite',
              }} />
            )}
          </div>
        </div>
      )}

      {/* FTS index progress */}
      {isIndexing && idxProgress && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--accent-series)', fontFamily: 'var(--font-ui)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {idxProgress.message || idxProgress.phase}
            </span>
            {idxPct > 0 && (
              <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                {idxPct}%
              </span>
            )}
          </div>
          <div style={{
            height: 3, borderRadius: 99, overflow: 'hidden',
            background: 'var(--bg-3)', width: '100%',
          }}>
            {idxPct > 0 ? (
              <div style={{
                height: '100%', background: 'var(--accent-series)',
                width: `${idxPct}%`, transition: 'width 0.3s',
                borderRadius: 99,
              }} />
            ) : (
              <div style={{
                height: '100%', background: 'var(--accent-series)',
                width: '35%', borderRadius: 99,
                animation: 'shimmer 1.4s ease-in-out infinite',
              }} />
            )}
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
          {isM3u ? (
            <InlineField label="M3U URL" value={editForm.m3uUrl}
              onChange={(v) => setEditForm(f => ({ ...f, m3uUrl: v }))} />
          ) : (
            <>
              <InlineField label="Server URL" value={editForm.serverUrl}
                onChange={(v) => setEditForm(f => ({ ...f, serverUrl: v }))} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <InlineField label="Username" value={editForm.username}
                  onChange={(v) => setEditForm(f => ({ ...f, username: v }))} />
                <InlineField label="Password" value={editForm.password} type="password"
                  placeholder="(unchanged)"
                  onChange={(v) => setEditForm(f => ({ ...f, password: v }))} />
              </div>
            </>
          )}

          {/* Color picker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'var(--font-ui)' }}>
              Color
            </label>
            <ColorPicker selected={source.colorIndex ?? autoIndex} onPick={handleColorPick} />
          </div>

          {/* Test result */}
          {testResult && (
            <div style={{
              padding: '6px 8px', borderRadius: 5, fontSize: 10,
              background: testResult.success
                ? 'color-mix(in srgb, var(--accent-success) 10%, transparent)'
                : 'color-mix(in srgb, var(--accent-danger) 10%, transparent)',
              border: `1px solid color-mix(in srgb, ${testResult.success ? 'var(--accent-success)' : 'var(--accent-danger)'} 25%, transparent)`,
              color: testResult.success ? 'var(--accent-success)' : 'var(--accent-danger)',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              {testResult.success ? '✓ Connected' : '✗ Failed'} — {testResult.message}
            </div>
          )}

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
              onClick={handleTest}
              disabled={testing || saving}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 11,
                background: 'transparent', border: '1px solid var(--border-default)',
                color: 'var(--text-1)', cursor: testing ? 'default' : 'pointer',
                opacity: (testing || saving) ? 0.5 : 1, fontFamily: 'var(--font-ui)',
              }}
            >
              {testing ? 'Testing…' : 'Test'}
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

      {/* Test result (shown outside edit mode) */}
      {!editMode && testResult && (
        <div style={{
          padding: '5px 8px', borderRadius: 5, fontSize: 10,
          background: testResult.success
            ? 'color-mix(in srgb, var(--accent-success) 10%, transparent)'
            : 'color-mix(in srgb, var(--accent-danger) 10%, transparent)',
          border: `1px solid color-mix(in srgb, ${testResult.success ? 'var(--accent-success)' : 'var(--accent-danger)'} 25%, transparent)`,
          color: testResult.success ? 'var(--accent-success)' : 'var(--accent-danger)',
        }}>
          {testResult.success ? '✓ Connected' : '✗ Failed'} — {testResult.message}
        </div>
      )}

      {/* Bottom action row: 7-step manual pipeline.
          Steps 1–2 (Add + Test) live in the Add Source dialog. Steps 3–7 are per-source here. */}
      {!editMode && (
        <div style={{ display: 'flex', gap: 6, marginTop: 4, borderTop: '1px solid var(--border-subtle)', paddingTop: 8, flexWrap: 'wrap' }}>
          <ActionButton
            icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}
            onClick={handleTest} disabled={testing}>
            {testing ? 'Testing…' : 'Test'}
          </ActionButton>
          <ActionButton
            step={3}
            icon={isSyncing
              ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>
            }
            onClick={() => { console.log(`[source-card] Step 3: Sync clicked for source "${source.name}"`); onSync(source.id) }} disabled={isSyncing}>
            {isSyncing ? 'Syncing…' : 'Sync'}
          </ActionButton>
          <ActionButton
            step={4}
            icon={epgRunning
              ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            }
            onClick={handleFetchEpg} disabled={epgRunning || isSyncing}>
            {epgRunning ? 'Fetching…' : 'Fetch EPG'}
          </ActionButton>
          <ActionButton
            step={5}
            icon={isIndexing
              ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            }
            onClick={handleBuildFts} disabled={isIndexing || isSyncing}>
            {isIndexing ? 'Indexing…' : 'Index VoD FTS'}
          </ActionButton>
          <ActionButton
            icon={iptvRunning
              ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 2v10l7 7"/></svg>
            }
            onClick={handleFetchIptvOrg} disabled={iptvRunning}>
            {iptvRunning ? 'Fetching…' : 'Fetch iptv-org'}
          </ActionButton>
          <ActionButton
            step={6}
            icon={isIndexing
              ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h.01M15 9h.01M9 15h6"/></svg>
            }
            onClick={handleBuildCanonical} disabled={isIndexing || isSyncing}>
            {isIndexing ? 'Building…' : 'Build Canonical'}
          </ActionButton>
          <ActionButton
            step={7}
            icon={isIndexing
              ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M3 12h18M3 17h12"/><circle cx="19" cy="17" r="3"/></svg>
            }
            onClick={handleBuildCanonicalFts} disabled={isIndexing || isSyncing}>
            {isIndexing ? 'Indexing…' : 'Canonical FTS'}
          </ActionButton>
        </div>
      )}

    </div>
  )
}

/* ── Inner helpers ──────────────────────────────────────────────── */

/** Icon-only subtle button for top-right management actions. */
function IconButton({
  children, title, color, onClick,
}: {
  children: React.ReactNode; title: string; color?: string; onClick: () => void
}) {
  const idle = color ?? 'var(--text-3)'
  const hover = color ?? 'var(--text-1)'
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 24, height: 24, borderRadius: 5,
        background: 'transparent', border: 'none',
        color: idle, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.color = hover }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = idle }}
    >
      {children}
    </button>
  )
}

function ActionButton({
  children, icon, onClick, disabled, step,
}: {
  children: React.ReactNode; icon?: React.ReactNode; onClick: () => void; disabled?: boolean; step?: number
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={typeof children === 'string' ? (step ? `Step ${step}: ${children}` : children) : undefined}
      style={{
        padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 500,
        background: 'var(--bg-3)', border: '1px solid var(--border-subtle)',
        color: 'var(--text-1)', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1, fontFamily: 'var(--font-ui)',
        display: 'flex', alignItems: 'center', gap: 4,
        transition: 'background 0.1s, color 0.1s, opacity 0.1s',
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.color = 'var(--text-0)' } }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--text-1)' }}
    >
      {step != null && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 14, height: 14, padding: '0 3px', borderRadius: 7,
          background: 'var(--accent-interactive)', color: '#fff',
          fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)',
        }}>{step}</span>
      )}
      {icon && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
      {children}
    </button>
  )
}

/* ── ColorPicker ────────────────────────────────────────────────── */
export function ColorPicker({ selected, onPick }: { selected: number; onPick: (idx: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {PALETTE_HEX.map((hex, i) => (
        <div
          key={i}
          title={`Color ${i + 1}`}
          onClick={() => onPick(i)}
          style={{
            width: 22, height: 22, borderRadius: '50%',
            background: hex, cursor: 'pointer', flexShrink: 0,
            outline: selected === i ? `3px solid ${hex}` : '3px solid transparent',
            outlineOffset: 2,
            opacity: selected === i ? 1 : 0.7,
            transition: 'outline 0.1s, opacity 0.1s',
          }}
        />
      ))}
    </div>
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
