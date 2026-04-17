import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
  epg: 'Fetching EPG…',
  done: 'Done',
  error: 'Error',
}

export function SourceCard({ source, onSync, onRemove }: Props) {
  const queryClient = useQueryClient()
  const {
    sources, syncProgress,
    enrichProgress: allEnrichProgress, enrichResult: allEnrichResult, setEnrichResult,
  } = useSourcesStore()
  const progress = syncProgress[source.id] ?? null
  const enrichProgress = allEnrichProgress[source.id] ?? null
  const enrichResult = allEnrichResult[source.id] ?? null
  const enriching = enrichProgress !== null

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

  // EPG-only sync (Xtream only)
  const [epgSyncing, setEpgSyncing] = useState(false)
  const [epgResult, setEpgResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleEpgSync = async () => {
    setEpgSyncing(true)
    setEpgResult(null)
    try {
      const r = await api.sources.syncEpg(source.id)
      if (r.success) {
        setEpgResult({ success: true, message: r.inserted != null ? `${Number(r.inserted).toLocaleString()} entries` : 'Done' })
      } else {
        setEpgResult({ success: false, message: r.error ?? 'EPG sync failed' })
      }
    } catch (e) {
      setEpgResult({ success: false, message: String(e) })
    } finally {
      setEpgSyncing(false)
    }
  }

  // g2: VoD enrichment (per-source, manual) — state lives in store, survives panel close
  const handleEnrichVod = () => {
    setEnrichResult(source.id, null)
    api.vodEnrich.enrich(source.id)
  }

  const syncedOrEpg = source.ingestState === 'synced' || source.ingestState === 'epg_fetched'

  // Pipeline Test — tests the already-added source and advances ingest_state.
  const handlePipelineTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r: any = await api.sources.test(source.id)
      const ok = r?.success ?? !r?.error
      const msg = ok
        ? (r?.itemCount != null ? `${Number(r.itemCount).toLocaleString()} items` : (r?.count != null ? `${Number(r.count).toLocaleString()} items` : 'Connected'))
        : (r?.error ?? 'Connection failed')
      setTestResult({ success: !!ok, message: msg })
      if (ok && source.ingestState === 'added') {
        useSourcesStore.getState().updateSource(source.id, { ingestState: 'tested' })
      }
    } catch (e) {
      setTestResult({ success: false, message: String(e) })
    } finally {
      setTesting(false)
    }
  }

  // Edit-form Test — tests against form values while editing credentials.
  const handleEditTest = async () => {
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
        // Mirror DB write into the store so the card re-renders with the
        // edited values (otherwise it falls back to the stale prop).
        useSourcesStore.getState().updateSource(source.id, {
          name: editForm.name || source.name,
          ...(isM3u
            ? { m3uUrl: editForm.m3uUrl || undefined }
            : {
                serverUrl: editForm.serverUrl || undefined,
                username: editForm.username || undefined,
                password: editForm.password || undefined,
              }
          ),
        })
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
    // Source enable/disable changes visible content across every view
    queryClient.invalidateQueries()
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
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <IconButton
              title={source.disabled ? 'Enable' : 'Disable'}
              onClick={handleToggleDisable}
            >
              {source.disabled
                ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>
                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
              }
            </IconButton>
            <IconButton title="Edit" onClick={() => setEditMode(true)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            </IconButton>
            <IconButton title="Delete" onClick={handleDelete}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
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

      {/* Manual ingestion pipeline — forward-only gates, all past-unlocked steps stay clickable */}
      {!editMode && (
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <PipelineButton
            step={1}
            label={testing ? 'Testing…' : 'Test'}
            done={source.ingestState !== 'added'}
            enabled={true}
            loading={testing}
            onClick={handlePipelineTest}
          />
          <PipelineButton
            step={2}
            label={isSyncing ? 'Syncing…' : 'Sync'}
            done={source.ingestState === 'synced' || source.ingestState === 'epg_fetched'}
            enabled={source.ingestState !== 'added' && !isSyncing}
            loading={isSyncing}
            onClick={() => onSync(source.id)}
          />
          {(source.type === 'xtream' || source.epgUrl) && (
            <PipelineButton
              step={3}
              label={epgSyncing ? 'EPG…' : 'EPG'}
              done={source.ingestState === 'epg_fetched'}
              enabled={(source.ingestState === 'synced' || source.ingestState === 'epg_fetched') && !isSyncing && !epgSyncing}
              loading={epgSyncing}
              onClick={handleEpgSync}
            />
          )}
        </div>
      )}

      {/* EPG sync result */}
      {!editMode && epgResult && (
        <div style={{
          padding: '5px 8px', borderRadius: 5, fontSize: 10,
          background: epgResult.success
            ? 'color-mix(in srgb, var(--accent-success) 10%, transparent)'
            : 'color-mix(in srgb, var(--accent-danger) 10%, transparent)',
          border: `1px solid color-mix(in srgb, ${epgResult.success ? 'var(--accent-success)' : 'var(--accent-danger)'} 25%, transparent)`,
          color: epgResult.success ? 'var(--accent-success)' : 'var(--accent-danger)',
        }}>
          {epgResult.success ? '✓' : '✗'} EPG {epgResult.message}
        </div>
      )}

      {/* g2: VoD enrichment (movies + series, keyless) */}
      {!editMode && (
        <button
          onClick={handleEnrichVod}
          disabled={!syncedOrEpg || enriching}
          title={!syncedOrEpg ? 'Sync the source first' : 'Enrich movies + series with Wikipedia / Wikidata metadata'}
          style={{
            padding: '5px 8px', borderRadius: 6,
            fontSize: 11, fontWeight: 500,
            background: 'transparent',
            border: '1px solid var(--border-default)',
            color: (syncedOrEpg && !enriching) ? 'var(--text-1)' : 'var(--text-3)',
            cursor: (syncedOrEpg && !enriching) ? 'pointer' : 'default',
            opacity: (syncedOrEpg && !enriching) ? 1 : 0.6,
            fontFamily: 'var(--font-ui)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            transition: 'background 0.1s, color 0.1s',
          }}
          onMouseEnter={(e) => { if (syncedOrEpg && !enriching) { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.color = 'var(--text-0)' } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = (syncedOrEpg && !enriching) ? 'var(--text-1)' : 'var(--text-3)' }}
        >
          {enriching && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          )}
          {enriching ? 'Enriching VoD…' : 'Enrich VoD metadata'}
        </button>
      )}

      {!editMode && enriching && enrichProgress && enrichProgress.total > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text-1)', fontFamily: 'var(--font-ui)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {enrichProgress.message ?? 'Enriching…'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
              {enrichProgress.current}/{enrichProgress.total}
            </span>
          </div>
          <div style={{ height: 3, borderRadius: 99, overflow: 'hidden', background: 'var(--bg-3)', width: '100%' }}>
            <div style={{
              height: '100%', background: 'var(--accent-film)',
              width: `${Math.min(100, Math.round((enrichProgress.current / enrichProgress.total) * 100))}%`,
              transition: 'width 0.4s',
              borderRadius: 99,
            }} />
          </div>
        </div>
      )}

      {!editMode && enrichResult && (
        <div style={{
          padding: '5px 8px', borderRadius: 5, fontSize: 10,
          background: enrichResult.success
            ? 'color-mix(in srgb, var(--accent-success) 10%, transparent)'
            : 'color-mix(in srgb, var(--accent-danger) 10%, transparent)',
          border: `1px solid color-mix(in srgb, ${enrichResult.success ? 'var(--accent-success)' : 'var(--accent-danger)'} 25%, transparent)`,
          color: enrichResult.success ? 'var(--accent-success)' : 'var(--accent-danger)',
        }}>
          {enrichResult.success ? '✓' : '✗'} VoD {enrichResult.message}
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
              onClick={handleEditTest}
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


    </div>
  )
}

/* ── Inner helpers ──────────────────────────────────────────────── */
function IconButton({
  children, title, onClick,
}: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 26, height: 26, borderRadius: 6,
        background: 'transparent', border: '1px solid var(--border-subtle)',
        color: 'var(--text-1)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.color = 'var(--text-0)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-1)' }}
    >
      {children}
    </button>
  )
}

function PipelineButton({
  step, label, done, enabled, loading, onClick,
}: {
  step: number; label: string; done: boolean; enabled: boolean; loading: boolean; onClick: () => void
}) {
  const disabled = !enabled
  const accent = done ? 'var(--accent-success)' : 'var(--accent-interactive)'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{
        flex: 1, padding: '6px 8px', borderRadius: 6,
        fontSize: 11, fontWeight: 600,
        background: disabled ? 'var(--bg-3)' : accent,
        border: 'none',
        color: disabled ? 'var(--text-2)' : '#fff',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'var(--font-ui)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        transition: 'opacity 0.1s, background 0.1s',
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14, borderRadius: '50%',
        fontSize: 9, fontWeight: 700,
        background: disabled ? 'var(--bg-4)' : 'rgba(255,255,255,0.22)',
        color: disabled ? 'var(--text-2)' : '#fff',
      }}>
        {done ? '✓' : step}
      </span>
      {loading && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
      )}
      {label}
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
