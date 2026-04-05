import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  useTheme,
  DARK_THEMES, LIGHT_THEMES,
  THEME_LABELS, THEME_SWATCHES,
  FONT_LABELS, FONT_NOTES,
  type ThemeId, type FontId,
} from '@/hooks/useTheme'

interface Props {
  onClose: () => void
}

type PlayerPref = 'artplayer' | 'mpv' | 'vlc'
type Tab = 'appearance' | 'player' | 'enrichment' | 'info'

const ALL_FONTS: FontId[] = ['DM Sans', 'Inter', 'Rubik', 'IBM Plex Sans', 'Plus Jakarta Sans', 'Outfit', 'Nunito']

const TABS: { id: Tab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'player',     label: 'Player' },
  { id: 'enrichment', label: 'Enrichment' },
  { id: 'info',       label: 'Info' },
]

export function SettingsDialog({ onClose }: Props) {
  const qc = useQueryClient()
  const { theme, font, setTheme, setFont } = useTheme()
  const [activeTab, setActiveTab] = useState<Tab>('appearance')

  const [tmdbKey, setTmdbKey] = useState('')
  useEffect(() => {
    api.settings.get('tmdb_api_key').then((v) => { if (v) setTmdbKey(v) })
  }, [])
  const [playerPref, setPlayerPref] = useState<PlayerPref>(
    () => (localStorage.getItem('fractals-player') as PlayerPref) ?? 'artplayer'
  )
  const [mpvPath, setMpvPath] = useState(() => localStorage.getItem('fractals-player-mpv-path') ?? '')
  const [vlcPath, setVlcPath] = useState(() => localStorage.getItem('fractals-player-vlc-path') ?? '')
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null)
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null)

  // Close on Escape — capture phase so it doesn't also clear search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose])

  const { data: enrichStatus } = useQuery({
    queryKey: ['enrichment:status'],
    queryFn: () => api.enrichment.status(),
    refetchInterval: enrichProgress ? 3000 : false,
  })

  useEffect(() => {
    const unsub = api.on('enrichment:progress', (p: any) => {
      if (p.error) { setEnrichMsg(`Error: ${p.error}`); setEnrichProgress(null); return }
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
    onSuccess: (res: any) => setEnrichMsg(res?.message ?? 'Started'),
    onError: (err) => setEnrichMsg(`Error: ${String(err)}`),
  })

  const pct = enrichProgress ? Math.round((enrichProgress.done / enrichProgress.total) * 100) : null

  return (
    <div className="fixed inset-0 z-50" style={{ pointerEvents: 'none' }}>
      {/* Click-outside dismissal — no blur, no dark overlay */}
      <div
        className="absolute inset-0"
        style={{ pointerEvents: 'auto' }}
        onClick={onClose}
      />

      {/* Drawer — slides in from the right */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: 320,
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border-strong)',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.35)',
          display: 'flex', flexDirection: 'column',
          pointerEvents: 'auto',
          zIndex: 1,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 0',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>Settings</span>
          <button
            onClick={onClose}
            style={{
              width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-card)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div style={{
          display: 'flex', gap: 2, padding: '10px 12px 0',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: '6px 10px', fontSize: 11, fontWeight: 500,
                borderRadius: '6px 6px 0 0', border: 'none',
                borderBottom: `2px solid ${activeTab === t.id ? 'var(--color-primary)' : 'transparent'}`,
                background: activeTab === t.id ? 'var(--color-primary-dim)' : 'transparent',
                color: activeTab === t.id ? 'var(--color-primary)' : 'var(--color-text-muted)',
                cursor: 'pointer', transition: 'all 0.12s', fontFamily: 'inherit',
                marginBottom: -1,
              }}
              onMouseEnter={(e) => { if (activeTab !== t.id) e.currentTarget.style.color = 'var(--color-text-secondary)' }}
              onMouseLeave={(e) => { if (activeTab !== t.id) e.currentTarget.style.color = 'var(--color-text-muted)' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          <AnimatePresence mode="wait">
            {activeTab === 'appearance' && (
              <TabPane key="appearance">
                <AppearanceTab theme={theme} font={font} setTheme={setTheme} setFont={setFont} />
              </TabPane>
            )}
            {activeTab === 'player' && (
              <TabPane key="player">
                <PlayerTab
                  playerPref={playerPref} setPlayerPref={setPlayerPref}
                  mpvPath={mpvPath} setMpvPath={setMpvPath}
                  vlcPath={vlcPath} setVlcPath={setVlcPath}
                />
              </TabPane>
            )}
            {activeTab === 'enrichment' && (
              <TabPane key="enrichment">
                <EnrichmentTab
                  tmdbKey={tmdbKey} setTmdbKey={setTmdbKey}
                  enrichStatus={enrichStatus}
                  enrichProgress={enrichProgress}
                  enrichMsg={enrichMsg}
                  pct={pct}
                  isPending={startEnrichment.isPending}
                  onStart={() => { setEnrichMsg(null); setEnrichProgress(null); startEnrichment.mutate() }}
                />
              </TabPane>
            )}
            {activeTab === 'info' && (
              <TabPane key="info">
                <InfoTab />
              </TabPane>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

/* ── Tab pane wrapper with fade transition ─────────────────────── */
function TabPane({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12 }}
    >
      {children}
    </motion.div>
  )
}

/* ── Appearance tab ────────────────────────────────────────────── */
function AppearanceTab({ theme, font, setTheme, setFont }: {
  theme: ThemeId; font: FontId
  setTheme: (t: ThemeId) => void; setFont: (f: FontId) => void
}) {
  const [browsePageSize, setBrowsePageSize] = useState(() => Number(localStorage.getItem('fractals-browse-page-size')) || 60)
  const [searchLive, setSearchLive] = useState(() => Number(localStorage.getItem('fractals-search-live-limit')) || 20)
  const [searchMovies, setSearchMovies] = useState(() => Number(localStorage.getItem('fractals-search-movie-limit')) || 45)
  const [searchSeries, setSearchSeries] = useState(() => Number(localStorage.getItem('fractals-search-series-limit')) || 35)

  const savePaging = (key: string, val: number, setter: (v: number) => void) => {
    const clamped = Math.max(10, Math.min(200, val))
    setter(clamped)
    localStorage.setItem(key, String(clamped))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <SectionLabel>Dark themes</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {DARK_THEMES.map(t => (
            <ThemeSwatch key={t} id={t} active={theme === t} onSelect={setTheme} />
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>Light themes</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {LIGHT_THEMES.filter(t => t !== 'light').map(t => (
            <ThemeSwatch key={t} id={t} active={theme === t} onSelect={setTheme} />
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>Font</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ALL_FONTS.map(f => (
            <button
              key={f}
              onClick={() => setFont(f)}
              style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                gap: 8, padding: '7px 10px', borderRadius: 8, textAlign: 'left',
                border: `1px solid ${font === f ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
                background: font === f ? 'var(--color-primary-dim)' : 'var(--color-card)',
                cursor: 'pointer', transition: 'all 0.1s',
                fontFamily: `'${f}', sans-serif`,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 500, color: font === f ? 'var(--color-primary)' : 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
                {FONT_LABELS[f]}
              </span>
              <span style={{ fontSize: 9.5, color: 'var(--color-text-muted)', fontFamily: 'var(--font-sans)', textAlign: 'right', lineHeight: 1.3 }}>
                {FONT_NOTES[f]}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>Browse &amp; Search</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PagingInput label="Browse page size" value={browsePageSize}
            onChange={(v) => savePaging('fractals-browse-page-size', v, setBrowsePageSize)} />
          <PagingInput label="Search: live channels" value={searchLive}
            onChange={(v) => savePaging('fractals-search-live-limit', v, setSearchLive)} />
          <PagingInput label="Search: movies" value={searchMovies}
            onChange={(v) => savePaging('fractals-search-movie-limit', v, setSearchMovies)} />
          <PagingInput label="Search: series" value={searchSeries}
            onChange={(v) => savePaging('fractals-search-series-limit', v, setSearchSeries)} />
          <p style={{ fontSize: 10, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            How many items to show per page (browse) or per section (search). Range: 10–200.
          </p>
        </div>
      </section>
    </div>
  )
}

function PagingInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{label}</span>
      <input
        type="number" min={10} max={200} step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: 56, textAlign: 'center', borderRadius: 6, padding: '4px 6px',
          fontSize: 11, fontFamily: 'monospace',
          background: 'var(--color-card)', border: '1px solid var(--color-border-strong)',
          color: 'var(--color-text-primary)', outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
      />
    </div>
  )
}

/* ── Player tab ────────────────────────────────────────────────── */
function PlayerTab({ playerPref, setPlayerPref, mpvPath, setMpvPath, vlcPath, setVlcPath }: {
  playerPref: PlayerPref; setPlayerPref: (p: PlayerPref) => void
  mpvPath: string; setMpvPath: (v: string) => void
  vlcPath: string; setVlcPath: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section>
        <SectionLabel>Video player</SectionLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['artplayer', 'mpv', 'vlc'] as PlayerPref[]).map((opt) => (
            <button
              key={opt}
              onClick={() => { setPlayerPref(opt); localStorage.setItem('fractals-player', opt) }}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 11, fontWeight: 500,
                border: `1px solid ${playerPref === opt ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
                background: playerPref === opt ? 'var(--color-primary-dim)' : 'transparent',
                color: playerPref === opt ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                cursor: 'pointer', transition: 'all 0.1s', fontFamily: 'inherit',
              }}
            >
              {opt === 'artplayer' ? 'ArtPlayer' : opt.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      {playerPref === 'artplayer' && (
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          Built-in player with HLS support. Works without any additional software.
        </p>
      )}
      {playerPref === 'mpv' && (
        <PathInput label="MPV path (optional)" placeholder="auto-detected"
          value={mpvPath} onChange={(v) => { setMpvPath(v); localStorage.setItem('fractals-player-mpv-path', v) }} />
      )}
      {playerPref === 'vlc' && (
        <PathInput label="VLC path (optional)" placeholder="auto-detected"
          value={vlcPath} onChange={(v) => { setVlcPath(v); localStorage.setItem('fractals-player-vlc-path', v) }} />
      )}

      <section>
        <SectionLabel>About the options</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PlayerNote title="ArtPlayer" color="var(--color-info)">
            Built-in web player. Best for quick playback. HLS/m3u8 streams work natively.
            Direct video files (.mkv, .mp4) also supported. No extra software needed.
          </PlayerNote>
          <PlayerNote title="MPV" color="var(--color-success)">
            Lightweight external player. Excellent codec support, GPU acceleration, custom shaders.
            Best choice for high-bitrate 4K content.
          </PlayerNote>
          <PlayerNote title="VLC" color="var(--color-warning)">
            Versatile external player. Handles virtually any format. Good fallback if MPV isn't installed.
          </PlayerNote>
        </div>
      </section>
    </div>
  )
}

function PlayerNote({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: '8px 10px', borderRadius: 8,
      background: 'var(--color-card)', borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 10.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{children}</div>
    </div>
  )
}

/* ── Enrichment tab ────────────────────────────────────────────── */
function EnrichmentTab({ tmdbKey, setTmdbKey, enrichStatus, enrichProgress, enrichMsg, pct, isPending, onStart }: {
  tmdbKey: string; setTmdbKey: (v: string) => void
  enrichStatus: any; enrichProgress: { done: number; total: number } | null
  enrichMsg: string | null; pct: number | null; isPending: boolean
  onStart: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <SectionLabel style={{ marginBottom: 0 }}>TMDB Enrichment</SectionLabel>
          {enrichStatus && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
              <span style={{ color: 'var(--color-success)' }}>{enrichStatus.enriched}</span>
              /{enrichStatus.total}
            </span>
          )}
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
          Fetches posters, ratings, plots, cast, and genres from TMDB.
          Get a free key at <span style={{ color: 'var(--color-info)' }}>themoviedb.org/settings/api</span>
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              placeholder="TMDB API key (v3 auth)"
              value={tmdbKey}
              onChange={(e) => setTmdbKey(e.target.value)}
              style={{
                flex: 1, borderRadius: 8, padding: '7px 10px', fontSize: 11, outline: 'none',
                background: 'var(--color-card)', border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)', caretColor: 'var(--color-primary)',
                fontFamily: 'inherit', transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
            />
            <button
              onClick={onStart}
              disabled={isPending || !!enrichProgress}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                background: 'var(--color-success)', color: '#fff', border: 'none',
                cursor: 'pointer', whiteSpace: 'nowrap', opacity: (isPending || !!enrichProgress) ? 0.5 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {enrichProgress ? `${pct}%` : 'Enrich'}
            </button>
          </div>

          {enrichProgress && (
            <div style={{ borderRadius: 99, overflow: 'hidden', height: 3, background: 'var(--color-card)' }}>
              <div style={{
                height: '100%', background: 'var(--color-success)',
                width: `${pct}%`, transition: 'width 0.3s',
              }} />
            </div>
          )}

          {enrichMsg && (
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{enrichMsg}</p>
          )}
        </div>
      </section>
    </div>
  )
}

/* ── Info tab ──────────────────────────────────────────────────── */
function InfoTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section>
        <SectionLabel>Database</SectionLabel>
        <InfoRow label="Engine" value="SQLite (better-sqlite3)" />
        <InfoRow label="Location" value="~/Library/Application Support/Fractals/data/fractals.db" mono />
      </section>
      <section>
        <SectionLabel>About</SectionLabel>
        <InfoRow label="Version" value="0.1.0" />
        <InfoRow label="Stack" value="Electron · React 19 · Vite · Tailwind 4" />
      </section>
      <section>
        <SectionLabel>Developer</SectionLabel>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.6, marginBottom: 8 }}>
          Press <kbd style={{ padding: '1px 5px', borderRadius: 3, fontSize: 10, background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', fontFamily: 'monospace' }}>D</kbd> while the player is open to show stream info.
        </p>
        <button
          onClick={() => (window as any).electronDevTools?.()}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px',
            borderRadius: 8, border: '1px solid var(--color-border-strong)',
            background: 'var(--color-card)', color: 'var(--color-text-secondary)',
            fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.1s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.color = 'var(--color-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
          </svg>
          Open Developer Tools
        </button>
      </section>
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontFamily: mono ? 'monospace' : 'inherit', lineHeight: 1.5 }}>{value}</span>
    </div>
  )
}

/* ── Shared components ─────────────────────────────────────────── */
function ThemeSwatch({ id, active, onSelect }: { id: ThemeId; active: boolean; onSelect: (t: ThemeId) => void }) {
  const [bg, accent] = THEME_SWATCHES[id]
  return (
    <button
      onClick={() => onSelect(id)}
      title={THEME_LABELS[id]}
      style={{
        position: 'relative', height: 42, borderRadius: 8, overflow: 'hidden',
        border: `2px solid ${active ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
        cursor: 'pointer', transition: 'border-color 0.12s',
        background: `linear-gradient(135deg, ${bg} 50%, ${accent} 150%)`,
      }}
    >
      {active && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <path d="M2 6l3 3 5-5" />
          </svg>
        </div>
      )}
      <div style={{
        position: 'absolute', bottom: 3, left: 0, right: 0,
        fontSize: 7.5, fontWeight: 700, textAlign: 'center',
        color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 3px rgba(0,0,0,0.7)',
        letterSpacing: '0.02em',
      }}>
        {THEME_LABELS[id].replace(' Dark', '').replace(' Light', '')}
      </div>
    </button>
  )
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8, ...style }}>
      {children}
    </p>
  )
}

function PathInput({ label, placeholder, value, onChange }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: 'var(--color-bg)', border: '1px solid var(--color-border-strong)',
          borderRadius: 7, padding: '6px 10px', fontSize: 11, fontFamily: 'monospace',
          color: 'var(--color-text-primary)', outline: 'none', width: '100%',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
      />
    </div>
  )
}
