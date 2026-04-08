import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app.store'
import { useUserStore } from '@/stores/user.store'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { api } from '@/lib/api'
import {
  useTheme,
  THEME_LABELS, THEME_SWATCHES,
  FONT_LABELS, FONT_NOTES,
  type ThemeId, type FontId,
} from '@/hooks/useTheme'

interface Props {
  onClose: () => void
}

type PlayerPref = 'artplayer' | 'mpv' | 'vlc'
type Tab = 'appearance' | 'player' | 'enrichment' | 'data' | 'about'

const ALL_FONTS: FontId[] = ['DM Sans', 'Inter', 'Rubik', 'IBM Plex Sans', 'Plus Jakarta Sans', 'Outfit', 'Nunito']

const TABS: { id: Tab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'player',     label: 'Player' },
  { id: 'enrichment', label: 'Enrichment' },
  { id: 'data',       label: 'Data' },
  { id: 'about',      label: 'About' },
]

export function SettingsPanel({ onClose }: Props) {
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
    <SlidePanel open={true} onClose={onClose} width={520}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)', fontFamily: 'var(--font-ui)' }}>
          Settings
        </span>
        <CloseButton onClick={onClose} />
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        height: 36,
      }}>
        {TABS.map(t => (
          <TabButton
            key={t.id}
            label={t.label}
            active={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
          />
        ))}
      </div>

      {/* Scrollable tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
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
          {activeTab === 'data' && (
            <TabPane key="data">
              <DataTab />
            </TabPane>
          )}
          {activeTab === 'about' && (
            <TabPane key="about">
              <AboutTab />
            </TabPane>
          )}
        </AnimatePresence>
      </div>
    </SlidePanel>
  )
}

/* ── Tab pane wrapper with fade/slide transition ──────────────── */
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

/* ── Shared header close button ───────────────────────────────── */
function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 28, height: 28, borderRadius: 6, border: 'none',
        background: 'transparent', display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: 'var(--text-2)', cursor: 'pointer',
        transition: 'background 0.1s, color 0.1s',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-3)'
        e.currentTarget.style.color = 'var(--text-1)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--text-2)'
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
        <path d="M1 1l10 10M11 1L1 11" />
      </svg>
    </button>
  )
}

/* ── Tab button ───────────────────────────────────────────────── */
function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0 14px',
        height: '100%',
        fontSize: 13,
        fontWeight: 500,
        fontFamily: 'var(--font-ui)',
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--accent-interactive)' : 'transparent'}`,
        background: 'transparent',
        color: active ? 'var(--accent-interactive)' : 'var(--text-2)',
        cursor: 'pointer',
        transition: 'color 0.12s, border-color 0.12s',
        marginBottom: -1,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-1)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-2)' }}
    >
      {label}
    </button>
  )
}

/* ── Appearance tab ────────────────────────────────────────────── */
function AppearanceTab({ theme, font, setTheme, setFont }: {
  theme: ThemeId; font: FontId
  setTheme: (t: ThemeId) => void; setFont: (f: FontId) => void
}) {
  const { pageSize, setPageSize, homeMode, setHomeMode } = useAppStore()
  const [searchLive, setSearchLive] = useState(() => Number(localStorage.getItem('fractals-search-live-limit')) || 20)
  const [searchMovies, setSearchMovies] = useState(() => Number(localStorage.getItem('fractals-search-movie-limit')) || 45)
  const [searchSeries, setSearchSeries] = useState(() => Number(localStorage.getItem('fractals-search-series-limit')) || 35)

  const saveSearchLimit = (key: string, val: number, setter: (v: number) => void) => {
    const clamped = Math.max(10, Math.min(200, val))
    setter(clamped)
    localStorage.setItem(key, String(clamped))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      <section>
        <SectionLabel>Theme</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <ThemeSwatch id="dark" active={theme === 'dark'} onSelect={setTheme} />
          <ThemeSwatch id="fractals-day" active={theme === 'fractals-day'} onSelect={setTheme} />
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
                gap: 8, padding: '8px 12px', borderRadius: 8, textAlign: 'left',
                border: `1px solid ${font === f ? 'var(--accent-interactive)' : 'var(--border-default)'}`,
                background: font === f ? 'var(--accent-interactive-dim)' : 'var(--bg-2)',
                cursor: 'pointer', transition: 'all 0.1s',
                fontFamily: `'${f}', sans-serif`,
              }}
            >
              <span style={{
                fontSize: 12, fontWeight: 500,
                color: font === f ? 'var(--accent-interactive)' : 'var(--text-0)',
                whiteSpace: 'nowrap',
              }}>
                {FONT_LABELS[f]}
              </span>
              <span style={{
                fontSize: 9.5, color: 'var(--text-2)',
                fontFamily: 'var(--font-ui)', textAlign: 'right', lineHeight: 1.3,
              }}>
                {FONT_NOTES[f]}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>Browse &amp; Search</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PagingInput label="Items per page" value={pageSize} min={100} max={5000} step={100}
            onChange={(v) => setPageSize(Math.max(100, Math.min(5000, v)))} />
          <PagingInput label="Search: live channels" value={searchLive} min={10} max={200} step={5}
            onChange={(v) => saveSearchLimit('fractals-search-live-limit', v, setSearchLive)} />
          <PagingInput label="Search: movies" value={searchMovies} min={10} max={200} step={5}
            onChange={(v) => saveSearchLimit('fractals-search-movie-limit', v, setSearchMovies)} />
          <PagingInput label="Search: series" value={searchSeries} min={10} max={200} step={5}
            onChange={(v) => saveSearchLimit('fractals-search-series-limit', v, setSearchSeries)} />
          <p style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 2 }}>
            Items per page: 100–5,000 (default 500). Pagination shown when total exceeds 1,000.
          </p>
        </div>
      </section>

      <section>
        <SectionLabel>Home Screen</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['discover', 'channels'] as const).map((mode) => {
            const active = homeMode === mode
            const label = mode === 'discover' ? 'Discover' : 'My Channels'
            const desc = mode === 'discover'
              ? 'Channels, movies & series strips'
              : 'Your favourite channels grid'
            return (
              <button
                key={mode}
                onClick={() => setHomeMode(mode)}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--accent-interactive)' : 'var(--border-default)'}`,
                  background: active ? 'var(--accent-interactive-dim)' : 'var(--bg-2)',
                  textAlign: 'left', transition: 'all 0.1s',
                  display: 'flex', flexDirection: 'column', gap: 3,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: active ? 'var(--accent-interactive)' : 'var(--text-0)', fontFamily: 'var(--font-ui)' }}>
                  {label}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-ui)' }}>
                  {desc}
                </span>
              </button>
            )
          })}
        </div>
        <p style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 6 }}>
          My Channels shows your favourited channels. If the list is empty, you'll be prompted to switch back.
        </p>
      </section>
    </div>
  )
}

function PagingInput({ label, value, onChange, min = 10, max = 200, step = 5 }: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-1)' }}>{label}</span>
      <input
        type="number" min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: 60, textAlign: 'center', borderRadius: 6, padding: '4px 6px',
          fontSize: 11, fontFamily: 'var(--font-mono)',
          background: 'var(--bg-2)', border: '1px solid var(--border-default)',
          color: 'var(--text-0)', outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-interactive)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)' }}
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
  const { minWatchSeconds, setMinWatchSeconds, controlsMode, setControlsMode } = useAppStore()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <SectionLabel>Video player</SectionLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['artplayer', 'mpv', 'vlc'] as PlayerPref[]).map((opt) => (
            <button
              key={opt}
              onClick={() => { setPlayerPref(opt); localStorage.setItem('fractals-player', opt) }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 11, fontWeight: 500,
                fontFamily: 'var(--font-ui)',
                border: `1px solid ${playerPref === opt ? 'var(--accent-interactive)' : 'var(--border-default)'}`,
                background: playerPref === opt ? 'var(--accent-interactive-dim)' : 'transparent',
                color: playerPref === opt ? 'var(--accent-interactive)' : 'var(--text-1)',
                cursor: 'pointer', transition: 'all 0.1s',
              }}
            >
              {opt === 'artplayer' ? 'ArtPlayer' : opt.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      {playerPref === 'artplayer' && (
        <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
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
        <SectionLabel>Watch tracking</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
            Minimum seconds watched before progress is saved to Continue Watching.
          </p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[5, 10, 30, 60].map((n) => (
              <button
                key={n}
                onClick={() => setMinWatchSeconds(n)}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 11, fontWeight: 500,
                  fontFamily: 'var(--font-ui)',
                  border: `1px solid ${minWatchSeconds === n ? 'var(--accent-interactive)' : 'var(--border-default)'}`,
                  background: minWatchSeconds === n ? 'var(--accent-interactive-dim)' : 'transparent',
                  color: minWatchSeconds === n ? 'var(--accent-interactive)' : 'var(--text-1)',
                  cursor: 'pointer', transition: 'all 0.1s',
                }}
              >
                {n < 60 ? `${n}s` : '1m'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <SectionLabel>Player controls</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
            When to show playback controls in fullscreen. Applies to the built-in player only.
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([
              { value: 'never',  label: 'Never' },
              { value: 'auto-2', label: 'Auto 2s' },
              { value: 'auto-3', label: 'Auto 3s' },
              { value: 'auto-5', label: 'Auto 5s' },
              { value: 'always', label: 'Always' },
            ] as const).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setControlsMode(value)}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 11, fontWeight: 500,
                  fontFamily: 'var(--font-ui)', minWidth: 60,
                  border: `1px solid ${controlsMode === value ? 'var(--accent-interactive)' : 'var(--border-default)'}`,
                  background: controlsMode === value ? 'var(--accent-interactive-dim)' : 'transparent',
                  color: controlsMode === value ? 'var(--accent-interactive)' : 'var(--text-1)',
                  cursor: 'pointer', transition: 'all 0.1s',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {controlsMode === 'never' && (
            <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
              Controls hidden. Keyboard shortcuts still work. Use <kbd style={{ background: 'var(--bg-3)', border: '1px solid var(--border-default)', borderRadius: 3, padding: '0 4px', fontSize: 10, fontFamily: 'var(--font-mono)' }}>Esc</kbd> to close.
            </p>
          )}
        </div>
      </section>

      <section>
        <SectionLabel>About the options</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PlayerNote title="ArtPlayer" color="var(--accent-interactive)">
            Built-in web player. Best for quick playback. HLS/m3u8 streams work natively.
            Direct video files (.mkv, .mp4) also supported. No extra software needed.
          </PlayerNote>
          <PlayerNote title="MPV" color="var(--accent-success)">
            Lightweight external player. Excellent codec support, GPU acceleration, custom shaders.
            Best choice for high-bitrate 4K content.
          </PlayerNote>
          <PlayerNote title="VLC" color="var(--accent-warning)">
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
      padding: '9px 12px', borderRadius: 8,
      background: 'var(--bg-2)', borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-0)', marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-1)', lineHeight: 1.55 }}>{children}</div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <SectionLabel style={{ marginBottom: 0 }}>TMDB Enrichment</SectionLabel>
          {enrichStatus && (
            <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
              <span style={{ color: 'var(--accent-success)' }}>{enrichStatus.enriched}</span>
              /{enrichStatus.total}
            </span>
          )}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.6, marginBottom: 12 }}>
          Fetches posters, ratings, plots, cast, and genres from TMDB.
          Get a free key at{' '}
          <span style={{ color: 'var(--accent-interactive)' }}>themoviedb.org/settings/api</span>
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              placeholder="TMDB API key (v3 auth)"
              value={tmdbKey}
              onChange={(e) => setTmdbKey(e.target.value)}
              style={{
                flex: 1, borderRadius: 8, padding: '8px 10px', fontSize: 11, outline: 'none',
                background: 'var(--bg-2)', border: '1px solid var(--border-default)',
                color: 'var(--text-0)', caretColor: 'var(--accent-interactive)',
                fontFamily: 'var(--font-ui)', transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-interactive)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)' }}
            />
            <button
              onClick={onStart}
              disabled={isPending || !!enrichProgress}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                background: 'var(--accent-success)', color: '#fff', border: 'none',
                cursor: 'pointer', whiteSpace: 'nowrap',
                opacity: (isPending || !!enrichProgress) ? 0.5 : 1,
                transition: 'opacity 0.15s', fontFamily: 'var(--font-ui)',
              }}
            >
              {enrichProgress ? `${pct}%` : 'Enrich'}
            </button>
          </div>

          {enrichProgress && (
            <div style={{ borderRadius: 99, overflow: 'hidden', height: 3, background: 'var(--bg-3)' }}>
              <div style={{
                height: '100%', background: 'var(--accent-success)',
                width: `${pct}%`, transition: 'width 0.3s',
              }} />
            </div>
          )}

          {enrichMsg && (
            <p style={{ fontSize: 11, color: 'var(--text-1)' }}>{enrichMsg}</p>
          )}
        </div>
      </section>
    </div>
  )
}

/* ── Data tab ──────────────────────────────────────────────────── */
function DataTab() {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<'history' | 'favorites' | 'all' | 'prefs' | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const run = async (action: 'history' | 'favorites' | 'all' | 'prefs') => {
    setBusy(true)
    setMsg(null)
    try {
      if (action === 'history')   await api.user.clearHistory()
      if (action === 'favorites') await api.user.clearFavorites()
      if (action === 'all')       await api.user.clearAllData()
      if (action === 'prefs') {
        // Reset persisted UI preferences to defaults
        useAppStore.setState({
          sort: 'updated:desc',
          viewMode: 'grid',
          pageSize: 500,
          homeMode: 'discover',
          hasSeenChannelsModePrompt: false,
          minWatchSeconds: 5,
        })
        setMsg('Preferences reset to defaults.')
        setBusy(false)
        setConfirm(null)
        return
      }

      // Wipe the in-memory user store so stale data doesn't linger
      useUserStore.setState({ data: {} })

      // Invalidate all user-data query caches
      qc.invalidateQueries({ queryKey: ['userdata'] })
      qc.invalidateQueries({ queryKey: ['browse-favorites'] })
      qc.invalidateQueries({ queryKey: ['library'] })
      qc.invalidateQueries({ queryKey: ['home-continue'] })
      qc.invalidateQueries({ queryKey: ['home-watchlist'] })

      const labels = { history: 'Watch history cleared.', favorites: 'Favorites & watchlist cleared.', all: 'All user data cleared.', prefs: '' }
      setMsg(labels[action])
    } catch (e) {
      setMsg(`Error: ${String(e)}`)
    }
    setBusy(false)
    setConfirm(null)
  }

  const ACTIONS = [
    {
      id: 'history' as const,
      label: 'Clear watch history',
      description: 'Removes all resume positions, progress, and completion marks. Keeps favorites and watchlist.',
      danger: false,
    },
    {
      id: 'favorites' as const,
      label: 'Clear favorites & watchlist',
      description: 'Removes all favorited and watchlisted items. Keeps watch history.',
      danger: false,
    },
    {
      id: 'all' as const,
      label: 'Clear all user data',
      description: 'Removes all watch history, favorites, watchlist, and ratings. Cannot be undone.',
      danger: true,
    },
    {
      id: 'prefs' as const,
      label: 'Reset preferences',
      description: 'Resets sort order, home mode, view settings, and min-watch threshold back to defaults.',
      danger: false,
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <SectionLabel>User data</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ACTIONS.map((a) => (
            <div key={a.id} style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'var(--bg-2)',
              border: `1px solid ${confirm === a.id ? (a.danger ? 'rgba(239,68,68,0.35)' : 'var(--border-default)') : 'var(--border-subtle)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: a.danger ? 'var(--accent-danger)' : 'var(--text-0)', marginBottom: 3 }}>
                    {a.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.45 }}>{a.description}</div>
                </div>
                {confirm === a.id ? (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => run(a.id)}
                      disabled={busy}
                      style={{
                        padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        background: a.danger ? 'var(--accent-danger)' : 'var(--accent-interactive)',
                        color: '#fff', border: 'none', opacity: busy ? 0.6 : 1,
                      }}
                    >
                      {busy ? '…' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setConfirm(null)}
                      style={{
                        padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                        background: 'var(--bg-3)', color: 'var(--text-1)', border: '1px solid var(--border-default)',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirm(a.id)}
                    style={{
                      padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', flexShrink: 0,
                      background: 'var(--bg-3)', color: a.danger ? 'var(--accent-danger)' : 'var(--text-1)',
                      border: `1px solid ${a.danger ? 'rgba(239,68,68,0.25)' : 'var(--border-default)'}`,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {msg && (
          <p style={{ fontSize: 11, color: 'var(--accent-success)', marginTop: 8 }}>{msg}</p>
        )}
      </section>
    </div>
  )
}

/* ── About tab ─────────────────────────────────────────────────── */
function AboutTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
        <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 10 }}>
          Press{' '}
          <kbd style={{
            padding: '1px 5px', borderRadius: 3, fontSize: 10,
            background: 'var(--bg-2)', border: '1px solid var(--border-default)',
            fontFamily: 'var(--font-mono)',
          }}>D</kbd>
          {' '}while the player is open to show stream info.
        </p>
        <button
          onClick={() => (window as any).electronDevTools?.()}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px',
            borderRadius: 8, border: '1px solid var(--border-default)',
            background: 'var(--bg-2)', color: 'var(--text-1)',
            fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', transition: 'all 0.1s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-interactive)'
            e.currentTarget.style.color = 'var(--accent-interactive)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-default)'
            e.currentTarget.style.color = 'var(--text-1)'
          }}
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

/* ── Shared helpers ────────────────────────────────────────────── */
function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 8,
      fontFamily: 'var(--font-ui)', ...style,
    }}>
      {children}
    </p>
  )
}

function ThemeSwatch({ id, active, onSelect }: { id: ThemeId; active: boolean; onSelect: (t: ThemeId) => void }) {
  const [bg, accent] = THEME_SWATCHES[id]
  return (
    <button
      onClick={() => onSelect(id)}
      title={THEME_LABELS[id]}
      style={{
        flex: 1, position: 'relative', height: 56, borderRadius: 8, overflow: 'hidden',
        border: `2px solid ${active ? 'var(--accent-interactive)' : 'var(--border-default)'}`,
        cursor: 'pointer', transition: 'border-color 0.12s',
        background: `linear-gradient(135deg, ${bg} 50%, ${accent} 150%)`,
      }}
    >
      {active && (
        <div style={{ position: 'absolute', top: 6, right: 8 }}>
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <path d="M2 6l3 3 5-5" />
          </svg>
        </div>
      )}
      <div style={{
        position: 'absolute', bottom: 5, left: 10,
        fontSize: 9, fontWeight: 700, textAlign: 'left',
        color: 'rgba(255,255,255,0.92)', textShadow: '0 1px 4px rgba(0,0,0,0.6)',
        letterSpacing: '0.03em',
      }}>
        {THEME_LABELS[id]}
      </div>
    </button>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
      <span style={{
        fontSize: 10, color: 'var(--text-2)', fontWeight: 600,
        letterSpacing: '0.04em', textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 11, color: 'var(--text-1)',
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-ui)', lineHeight: 1.5,
      }}>
        {value}
      </span>
    </div>
  )
}

function PathInput({ label, placeholder, value, onChange }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{
        fontSize: 10, color: 'var(--text-2)', fontWeight: 600,
        letterSpacing: '0.04em', textTransform: 'uppercase',
        fontFamily: 'var(--font-ui)',
      }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: 'var(--bg-1)', border: '1px solid var(--border-default)',
          borderRadius: 7, padding: '7px 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
          color: 'var(--text-0)', outline: 'none', width: '100%', boxSizing: 'border-box',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-interactive)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)' }}
      />
    </div>
  )
}
