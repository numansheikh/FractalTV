import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type Phase = 'idle' | 'fetching' | 'validating' | 'writing' | 'done' | 'error'

const PHASE_LABEL: Record<Exclude<Phase, 'idle'>, string> = {
  fetching:   'Fetching…',
  validating: 'Validating…',
  writing:    'Writing…',
  done:       'Done',
  error:      'Error',
}

function formatRelative(unixSec: number | null): string {
  if (!unixSec) return 'Not yet pulled'
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - unixSec)
  if (diffSec < 60)        return 'just now'
  if (diffSec < 3600)      return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400)     return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

export function IptvOrgRow() {
  const [count, setCount] = useState(0)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  async function refreshStatus() {
    const s = await api.iptvOrg.status()
    setCount(s.count)
    setLastRefreshedAt(s.lastRefreshedAt)
  }

  useEffect(() => { refreshStatus() }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api) return
    const off = window.api.on('iptvOrg:progress', (...args: unknown[]) => {
      const payload = args[0] as { phase: Phase; error?: string } | undefined
      if (!payload) return
      setPhase(payload.phase)
      if (payload.phase === 'error') setError(payload.error ?? 'Unknown error')
    })
    return () => { off() }
  }, [])

  const busy = phase !== 'idle' && phase !== 'done' && phase !== 'error'

  async function handlePull() {
    setError(null)
    setPhase('fetching')
    const result = await api.iptvOrg.pull()
    if (!result.ok) {
      setError(result.error ?? 'Unknown error')
      setPhase('error')
    } else {
      setPhase('done')
    }
    await refreshStatus()
  }

  const statusLine = count > 0
    ? `${count.toLocaleString()} channels · last refreshed ${formatRelative(lastRefreshedAt)}`
    : 'Not yet pulled'

  return (
    <section>
      <div style={{
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--text-3)', marginBottom: 8, fontFamily: 'var(--font-ui)',
      }}>
        iptv-org channel database
      </div>
      <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', marginBottom: 3 }}>
              Reference data
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.45 }}>
              {statusLine}
            </div>
            {busy && (
              <div style={{ fontSize: 11, color: 'var(--accent-interactive)', marginTop: 6 }}>
                {PHASE_LABEL[phase as Exclude<Phase, 'idle'>]}
              </div>
            )}
            {error && !busy && (
              <div style={{ fontSize: 11, color: 'var(--accent-danger)', marginTop: 6 }}>
                {error}
              </div>
            )}
          </div>
          <button
            onClick={handlePull}
            disabled={busy}
            style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', flexShrink: 0,
              background: 'var(--bg-3)', color: 'var(--text-1)',
              border: '1px solid var(--border-default)', opacity: busy ? 0.6 : 1,
            }}
            onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = 'var(--bg-4)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
          >
            {busy ? '…' : 'Pull latest'}
          </button>
        </div>
      </div>
    </section>
  )
}
