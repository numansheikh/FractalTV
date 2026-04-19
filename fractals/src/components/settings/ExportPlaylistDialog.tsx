import { useState, useEffect, useMemo } from 'react'
import { api } from '@/lib/api'
import {
  buildNodes,
  type ExportTree as ExportTreeData,
  type Selection,
  countSelectedItems,
  resolveSelection,
} from '@/lib/export-selection'
import { ExportTree } from './ExportTree'

interface Props {
  onClose: () => void
}

type Stage =
  | { kind: 'loading' }
  | { kind: 'picker'; tree: ExportTreeData }
  | { kind: 'progress'; phase: string; current: number; total: number; message: string }
  | { kind: 'done'; filePath: string; entryCount: number }
  | { kind: 'error'; message: string }

export function ExportPlaylistDialog({ onClose }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' })
  const [selection, setSelection] = useState<Selection>(new Set())

  useEffect(() => {
    let alive = true
    api.export.buildTree().then((tree) => {
      if (!alive) return
      if (!tree) {
        setStage({ kind: 'error', message: 'Export not available in this environment.' })
        return
      }
      setStage({ kind: 'picker', tree })
    }).catch((err: any) => {
      if (!alive) return
      setStage({ kind: 'error', message: err?.message ?? 'Failed to load export tree' })
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const unsubscribe = api.export.onProgress((progress) => {
      setStage((prev) => {
        if (prev.kind !== 'progress' && prev.kind !== 'picker') return prev
        if (progress.phase === 'done') return prev
        if (progress.phase === 'error') return { kind: 'error', message: progress.message }
        return {
          kind: 'progress',
          phase: progress.phase,
          current: progress.current,
          total: progress.total,
          message: progress.message,
        }
      })
    })
    return unsubscribe
  }, [])

  const nodes = useMemo(() => (stage.kind === 'picker' ? buildNodes(stage.tree) : []), [stage])
  const itemCount = useMemo(
    () => (stage.kind === 'picker' ? countSelectedItems(nodes, selection) : 0),
    [nodes, selection, stage.kind]
  )

  const canExport = stage.kind === 'picker' && selection.size > 0

  const onExport = async () => {
    if (stage.kind !== 'picker') return
    const pick = await api.export.pickFile()
    if (pick.canceled || !pick.filePath) return

    const resolved = resolveSelection(nodes, selection)
    setStage({ kind: 'progress', phase: 'resolving', current: 0, total: 0, message: 'Resolving selection…' })

    const result = await api.export.run({ selection: resolved, outputPath: pick.filePath })
    if (result.success && result.filePath && typeof result.entryCount === 'number') {
      setStage({ kind: 'done', filePath: result.filePath, entryCount: result.entryCount })
    } else {
      setStage({ kind: 'error', message: result.error ?? 'Export failed' })
    }
  }

  const dismissible = stage.kind !== 'progress'

  return (
    <div
      onClick={() => { if (dismissible) onClose() }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560, maxWidth: '92vw', maxHeight: '88vh',
          background: 'var(--bg-0)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          padding: 20,
          display: 'flex', flexDirection: 'column', gap: 14,
          boxShadow: '0 18px 48px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>Export Playlist</div>
          {dismissible && (
            <button
              onClick={onClose}
              style={{
                background: 'transparent', border: 'none', color: 'var(--text-2)',
                fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1,
              }}
            >✕</button>
          )}
        </div>

        {stage.kind === 'loading' && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-1)', fontSize: 12 }}>
            Loading…
          </div>
        )}

        {stage.kind === 'picker' && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.5 }}>
              Select categories to include. Checking a parent selects everything beneath it. Series categories will flatten to one line per episode (episodes will be fetched on demand if not yet cached locally).
            </div>
            <ExportTree nodes={nodes} selection={selection} onChange={setSelection} />
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              paddingTop: 4,
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                {selection.size === 0 ? 'Nothing selected' : `${itemCount.toLocaleString()} items across ${selection.size} categories`}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={onClose}
                  style={cancelBtn}
                >Cancel</button>
                <button
                  disabled={!canExport}
                  onClick={onExport}
                  style={{ ...primaryBtn, opacity: canExport ? 1 : 0.5, cursor: canExport ? 'pointer' : 'not-allowed' }}
                >Export…</button>
              </div>
            </div>
          </>
        )}

        {stage.kind === 'progress' && (
          <div style={{ padding: '20px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-0)', fontWeight: 600 }}>
              {phaseLabel(stage.phase)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-1)' }}>{stage.message}</div>
            <div style={{
              height: 6, background: 'var(--bg-2)', borderRadius: 999, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: stage.total > 0 ? `${Math.min(100, (stage.current / stage.total) * 100)}%` : '30%',
                background: 'var(--accent-interactive)',
                transition: 'width 200ms ease',
                animation: stage.total === 0 ? 'pulse 1.2s ease-in-out infinite' : undefined,
              }} />
            </div>
            {stage.total > 0 && (
              <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                {stage.current.toLocaleString()} / {stage.total.toLocaleString()}
              </div>
            )}
          </div>
        )}

        {stage.kind === 'done' && (
          <div style={{ padding: '16px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 600 }}>
              Exported {stage.entryCount.toLocaleString()} entries
            </div>
            <div style={{
              fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)',
              background: 'var(--bg-2)', padding: '8px 10px', borderRadius: 6,
              wordBreak: 'break-all',
            }}>{stage.filePath}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => api.export.reveal(stage.filePath)} style={cancelBtn}>
                Show in Finder
              </button>
              <button onClick={onClose} style={primaryBtn}>Done</button>
            </div>
          </div>
        )}

        {stage.kind === 'error' && (
          <div style={{ padding: '16px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--accent-danger)', fontWeight: 600 }}>Export failed</div>
            <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.5 }}>{stage.message}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={primaryBtn}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'resolving': return 'Resolving selection…'
    case 'fetching_series': return 'Fetching series episodes…'
    case 'writing': return 'Writing playlist…'
    default: return phase
  }
}

const primaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  background: 'var(--accent-interactive)',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
}

const cancelBtn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  background: 'transparent',
  color: 'var(--text-1)',
  border: '1px solid var(--border-default)',
  cursor: 'pointer',
}
