import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Props {
  onClose: () => void
}

export function SettingsDialog({ onClose }: Props) {
  const qc = useQueryClient()
  const [tmdbKey, setTmdbKey] = useState('')
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null)
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null)

  const { data: enrichStatus } = useQuery({
    queryKey: ['enrichment:status'],
    queryFn: () => api.enrichment.status(),
    refetchInterval: enrichProgress ? 3000 : false,
  })

  // Listen for enrichment progress events
  useEffect(() => {
    const unsub = api.on('enrichment:progress', (p: any) => {
      if (p.error) {
        setEnrichMsg(`Error: ${p.error}`)
        setEnrichProgress(null)
        return
      }
      setEnrichProgress({ done: p.done, total: p.total })
      if (p.complete) {
        setEnrichMsg(`Done! ${p.done} items enriched.`)
        setEnrichProgress(null)
        qc.invalidateQueries({ queryKey: ['search'] })
        qc.invalidateQueries({ queryKey: ['browse'] })
        qc.invalidateQueries({ queryKey: ['enrichment:status'] })
      }
    })
    return unsub
  }, [qc])

  const startEnrichment = useMutation({
    mutationFn: () => api.enrichment.start(tmdbKey || undefined),
    onSuccess: (res: any) => {
      setEnrichMsg(res?.message ?? 'Started')
    },
    onError: (err) => setEnrichMsg(`Error: ${String(err)}`),
  })

  const pct = enrichProgress
    ? Math.round((enrichProgress.done / enrichProgress.total) * 100)
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6 }}
        transition={{ duration: 0.15 }}
        className="relative w-full max-w-sm rounded-xl shadow-2xl"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-strong)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: '16px 20px 0' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Settings</h2>
          <button onClick={onClose} className="flex items-center justify-center rounded-md p-1 transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '16px 20px 20px' }} className="flex flex-col gap-5">

          {/* TMDB enrichment */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                TMDB Enrichment
              </span>
              {enrichStatus && (
                <span className="font-mono text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  {enrichStatus.enriched}/{enrichStatus.total} enriched
                </span>
              )}
            </div>

            <p className="mb-3 text-xs" style={{ color: 'var(--color-text-secondary)', lineHeight: '1.6' }}>
              Fetches posters, ratings, plots, cast, and genres from TMDB.{' '}
              <span style={{ color: 'var(--color-text-muted)' }}>
                Get a free key at themoviedb.org/settings/api
              </span>
            </p>

            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="TMDB API key (v3 auth)"
                  value={tmdbKey}
                  onChange={(e) => setTmdbKey(e.target.value)}
                  className="flex-1 rounded-lg px-3 py-2 text-xs outline-none"
                  style={{
                    background: 'var(--color-card)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)',
                    caretColor: 'var(--color-primary)',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(124,77,255,0.4)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
                />
                <button
                  onClick={() => { setEnrichMsg(null); setEnrichProgress(null); startEnrichment.mutate() }}
                  disabled={startEnrichment.isPending || !!enrichProgress}
                  className="rounded-lg px-3 py-2 text-xs font-semibold transition-opacity disabled:opacity-50"
                  style={{ background: 'var(--color-primary)', color: '#fff', whiteSpace: 'nowrap' }}
                >
                  {enrichProgress ? `${pct}%` : 'Enrich'}
                </button>
              </div>

              {/* Progress bar */}
              {enrichProgress && (
                <div className="rounded-full overflow-hidden" style={{ height: '3px', background: 'var(--color-card)' }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'var(--color-primary)' }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              )}

              {enrichMsg && (
                <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                  {enrichMsg}
                </p>
              )}
            </div>
          </section>

          {/* Divider */}
          <div style={{ height: '1px', background: 'var(--color-border)' }} />

          {/* DB info */}
          <section>
            <span className="mb-2 block text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Database
            </span>
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)', lineHeight: '1.6' }}>
              SQLite · <span style={{ color: 'var(--color-text-muted)' }}>~/Library/Application Support/Fractals/data/fractals.db</span>
            </p>
          </section>
        </div>
      </motion.div>
    </div>
  )
}
