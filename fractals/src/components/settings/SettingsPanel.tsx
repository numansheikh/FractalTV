import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app.store'
import { useUserStore } from '@/stores/user.store'
import { useSourcesStore } from '@/stores/sources.store'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { IptvOrgRow } from '@/components/settings/IptvOrgRow'
import { api } from '@/lib/api'
import {
  useTheme,
  THEME_LABELS, THEME_SWATCHES, LIGHT_THEMES,
  FONT_LABELS, FONT_NOTES,
  type ThemeId, type FontId,
} from '@/hooks/useTheme'

interface Props {
  onClose: () => void
}

type PlayerPref = 'artplayer' | 'mpv' | 'vlc'
type Tab = 'appearance' | 'interface' | 'player' | 'data' | 'about'

const ALL_FONTS: FontId[] = ['DM Sans', 'Inter', 'Rubik', 'IBM Plex Sans', 'Plus Jakarta Sans', 'Outfit', 'Nunito']

const TABS: { id: Tab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'interface',  label: 'Interface' },
  { id: 'player',     label: 'Player' },
  { id: 'data',       label: 'Data' },
  { id: 'about',      label: 'About' },
]

export function SettingsPanel({ onClose }: Props) {
  const { theme, font, setTheme, setFont } = useTheme()
  const [activeTab, setActiveTab] = useState<Tab>('appearance')

  const [playerPref, setPlayerPref] = useState<PlayerPref>(
    () => (localStorage.getItem('fractals-player') as PlayerPref) ?? 'artplayer'
  )
  const [mpvPath, setMpvPath] = useState(() => localStorage.getItem('fractals-player-mpv-path') ?? '')
  const [vlcPath, setVlcPath] = useState(() => localStorage.getItem('fractals-player-vlc-path') ?? '')
  return (
    <SlidePanel open={true} onClose={onClose} width={480}>
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
          {activeTab === 'interface' && (
            <TabPane key="interface">
              <InterfaceTab />
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
        justifyContent: 'center', color: 'var(--text-1)', cursor: 'pointer',
        transition: 'background 0.1s, color 0.1s',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-3)'
        e.currentTarget.style.color = 'var(--text-0)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--text-1)'
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
        color: active ? 'var(--accent-interactive)' : 'var(--text-1)',
        cursor: 'pointer',
        transition: 'color 0.12s, border-color 0.12s',
        marginBottom: -1,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-0)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-1)' }}
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
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
    </div>
  )
}

/* ── Interface tab ────────────────────────────────────────────── */
const COMMON_TIMEZONES = Intl.supportedValuesOf('timeZone')

function InterfaceTab() {
  const { pageSize, setPageSize, homeMode, setHomeMode, homeStripSize, setHomeStripSize, timezone, setTimezone } = useAppStore()
  const queryClient = useQueryClient()
  const [allowAdult, setAllowAdult] = useState(true)
  useEffect(() => {
    api.settings.get('allow_adult').then((v) => setAllowAdult(v !== '0'))
  }, [])
  const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [tzSearch, setTzSearch] = useState('')
  const filteredTz = tzSearch
    ? COMMON_TIMEZONES.filter((tz) => tz.toLowerCase().includes(tzSearch.toLowerCase()))
    : COMMON_TIMEZONES
  const snap = (v: number, opts: number[]) => opts.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a)
  const pageOpts = [25, 50, 100, 200, 500]
  const stripOpts = [5, 6, 7, 8, 9, 10, 12, 15]
  useEffect(() => {
    if (!pageOpts.includes(pageSize)) setPageSize(snap(pageSize, pageOpts))
    if (!stripOpts.includes(homeStripSize)) setHomeStripSize(snap(homeStripSize, stripOpts))
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <section>
        <SectionLabel>Home Screen</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['discover', 'channels'] as const).map((mode) => {
              const active = homeMode === mode
              const label = mode === 'discover' ? 'Discover' : 'TV'
              const desc = mode === 'discover'
                ? 'Strips of channels, movies & series'
                : 'Your favorite channels, drag to reorder'
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
          <SegmentedPicker label="Strip width (cards per row)" value={homeStripSize} options={[5, 6, 7, 8, 9, 10, 12, 15]}
            onChange={(v) => setHomeStripSize(v)} />
        </div>
      </section>

      <section>
        <SectionLabel>Browse</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SegmentedPicker label="Grid page size" value={pageSize} options={[25, 50, 75, 100, 200]}
            onChange={(v) => setPageSize(v)} />
        </div>
      </section>

      <section>
        <SectionLabel>Timezone</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-1)' }}>Use system timezone</span>
            <button
              onClick={() => setTimezone(timezone === null ? systemTz : null)}
              style={{
                width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
                background: timezone === null ? 'var(--accent-interactive)' : 'var(--bg-3)',
                position: 'relative', transition: 'background 0.15s',
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: 8, background: '#fff',
                position: 'absolute', top: 2,
                left: timezone === null ? 18 : 2,
                transition: 'left 0.15s',
              }} />
            </button>
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-2)' }}>
            System: {systemTz}
          </span>
          {timezone !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              <input
                value={tzSearch}
                onChange={(e) => setTzSearch(e.target.value)}
                placeholder="Search timezones..."
                style={{
                  fontSize: 11, padding: '5px 8px', borderRadius: 6,
                  border: '1px solid var(--border-default)', background: 'var(--bg-2)',
                  color: 'var(--text-0)', outline: 'none', fontFamily: 'var(--font-ui)',
                }}
              />
              <div style={{
                maxHeight: 160, overflowY: 'auto', borderRadius: 6,
                border: '1px solid var(--border-default)', background: 'var(--bg-2)',
              }}>
                {filteredTz.map((tz) => {
                  const active = timezone === tz
                  return (
                    <button
                      key={tz}
                      onClick={() => { setTimezone(tz); setTzSearch('') }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '4px 8px', fontSize: 10, fontFamily: 'var(--font-mono)',
                        background: active ? 'var(--accent-interactive-dim)' : 'transparent',
                        color: active ? 'var(--accent-interactive)' : 'var(--text-1)',
                        border: 'none', cursor: 'pointer',
                        fontWeight: active ? 600 : 400,
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-3)' }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? 'var(--accent-interactive-dim)' : 'transparent' }}
                    >
                      {tz}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <SectionLabel>Content</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-0)', fontFamily: 'var(--font-ui)' }}>Allow adult content</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-ui)', marginTop: 2 }}>
              Show categories marked as adult (18+)
            </div>
          </div>
          <button
            onClick={async () => {
              const next = !allowAdult
              setAllowAdult(next)
              await api.settings.set('allow_adult', next ? '1' : '0')
              queryClient.invalidateQueries()
            }}
            style={{
              width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: allowAdult ? 'var(--accent-interactive)' : 'var(--bg-3)',
              position: 'relative', transition: 'background 0.15s', flexShrink: 0,
            }}
          >
            <div style={{
              width: 16, height: 16, borderRadius: 8, background: '#fff',
              position: 'absolute', top: 2,
              left: allowAdult ? 18 : 2,
              transition: 'left 0.15s',
            }} />
          </button>
        </div>
      </section>
    </div>
  )
}

function SegmentedPicker({ label, value, options, onChange }: {
  label: string; value: number; options: number[]; onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-1)', flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
        {options.map((opt, i) => {
          const active = value === opt
          const isLast = i === options.length - 1
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              style={{
                padding: '4px 8px',
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                background: active ? 'var(--accent-interactive)' : 'var(--bg-2)',
                color: active ? '#fff' : 'var(--text-1)',
                border: 'none',
                borderRight: isLast ? 'none' : '1px solid var(--border-default)',
                cursor: 'pointer',
                fontWeight: active ? 600 : 400,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-3)' }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-2)' }}
            >
              {opt}
            </button>
          )
        })}
      </div>
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
        <p style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.6 }}>
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
        <SectionLabel>Player controls</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.5, margin: 0 }}>
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
            <p style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.5, margin: 0 }}>
              Controls hidden. Keyboard shortcuts still work. Use <kbd style={{ background: 'var(--bg-3)', border: '1px solid var(--border-default)', borderRadius: 3, padding: '0 4px', fontSize: 10, fontFamily: 'var(--font-mono)' }}>Esc</kbd> to close.
            </p>
          )}
        </div>
      </section>

      <section>
        <SectionLabel>Watch tracking</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.5, margin: 0 }}>
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

/* ── Data tab ──────────────────────────────────────────────────── */
function DataTab() {
  const qc = useQueryClient()
  const setSources = useSourcesStore((s) => s.setSources)
  const [confirm, setConfirm] = useState<'history' | 'favorites' | 'all' | 'prefs' | 'factory' | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [includeUserData, setIncludeUserData] = useState(false)

  const run = async (action: 'history' | 'favorites' | 'all' | 'prefs' | 'factory') => {
    setBusy(true)
    setMsg(null)
    try {
      if (action === 'history')   await api.user.clearHistory()
      if (action === 'favorites') await api.user.clearFavorites()
      if (action === 'all')       await api.user.clearAllData()
      if (action === 'factory')   await api.sources.factoryReset()
      if (action === 'prefs') {
        // Reset persisted UI preferences to defaults
        useAppStore.setState({
          sort: 'updated:desc',
          viewMode: 'grid',
          pageSize: 60,
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

      // Invalidate all caches
      qc.invalidateQueries({ queryKey: ['userdata'] })
      qc.invalidateQueries({ queryKey: ['browse-favorites'] })
      qc.invalidateQueries({ queryKey: ['library'] })
      qc.invalidateQueries({ queryKey: ['home-continue'] })
      qc.invalidateQueries({ queryKey: ['home-watchlist'] })
      qc.invalidateQueries({ queryKey: ['channels', 'favorites'] })
      if (action === 'factory') {
        qc.invalidateQueries({ queryKey: ['sources'] })
        qc.invalidateQueries({ queryKey: ['home-latest-movies'] })
        qc.invalidateQueries({ queryKey: ['home-latest-series'] })
        qc.invalidateQueries({ queryKey: ['browse'] })
      }

      const labels = { history: 'Watch history cleared.', favorites: 'Favorites & watchlist cleared.', all: 'All user data cleared.', prefs: '', factory: 'Factory reset complete. All data and sources removed.' }
      setMsg(labels[action])
    } catch (e) {
      setMsg(`Error: ${String(e)}`)
    }
    setBusy(false)
    setConfirm(null)
  }

  const handleExport = async () => {
    setBusy(true)
    setImportMsg(null)
    try {
      const result = await api.sources.exportBackup({ includeUserData })
      if (!result.canceled) setImportMsg(`Exported ${result.count} source${result.count !== 1 ? 's' : ''}${includeUserData ? ' + user data' : ''}.`)
    } catch (e) {
      setImportMsg(`Export failed: ${String(e)}`)
    }
    setBusy(false)
  }

  const handleImport = async () => {
    setImportMsg(null)
    const fileResult = await (window.api as any).dialog.openFile({ filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (fileResult.canceled) return
    setBusy(true)
    try {
      const result = await api.sources.import(fileResult.filePath)
      if (result.error) setImportMsg(`Import failed: ${result.error}`)
      else {
        setImportMsg(`Imported ${result.count} source${result.count !== 1 ? 's' : ''}. Sync to load content.`)
        const updated = await api.sources.list()
        setSources(updated as any)
      }
    } catch (e) {
      setImportMsg(`Import failed: ${String(e)}`)
    }
    setBusy(false)
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* ── Enrichment — hidden until TMDB integration (g2+) ── */}

      {/* ── iptv-org reference database ── */}
      <IptvOrgRow />

      {/* ── User data ── */}
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
                  <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.45 }}>{a.description}</div>
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

      {/* ── Backup/Import ── */}
      <section>
        <SectionLabel>Sources backup</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', marginBottom: 6 }}>Export backup</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--text-2)', cursor: 'default' }}>
                    <input type="checkbox" checked disabled style={{ accentColor: 'var(--accent-interactive)' }} />
                    Sources &amp; Settings (source list, colors, preferences)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--text-1)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={includeUserData} onChange={(e) => setIncludeUserData(e.target.checked)} style={{ accentColor: 'var(--accent-interactive)', cursor: 'pointer' }} />
                    User data (favorites, watchlist, history)
                  </label>
                </div>
              </div>
              <button
                onClick={handleExport}
                disabled={busy}
                style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', flexShrink: 0, background: 'var(--bg-3)', color: 'var(--text-1)', border: '1px solid var(--border-default)', opacity: busy ? 0.6 : 1 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
              >
                Export
              </button>
            </div>
          </div>
          <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', marginBottom: 3 }}>Import sources</div>
                <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.45 }}>Restore sources from a previously exported JSON file. Existing sources with the same ID will be updated.</div>
              </div>
              <button
                onClick={handleImport}
                disabled={busy}
                style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', flexShrink: 0, background: 'var(--bg-3)', color: 'var(--text-1)', border: '1px solid var(--border-default)', opacity: busy ? 0.6 : 1 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
              >
                Import
              </button>
            </div>
          </div>
        </div>
        {importMsg && (
          <p style={{ fontSize: 11, color: importMsg.includes('failed') ? 'var(--accent-danger)' : 'var(--accent-success)', marginTop: 8 }}>{importMsg}</p>
        )}
      </section>

      {/* ── Factory reset ── */}
      <section>
        <SectionLabel>Factory reset</SectionLabel>
        <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--bg-2)', border: `1px solid ${confirm === 'factory' ? 'rgba(239,68,68,0.35)' : 'var(--border-subtle)'}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-danger)', marginBottom: 3 }}>Factory reset</div>
              <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.45 }}>Removes all sources, content, user data, and history. The app will be completely empty. Export your sources first if you want to restore them.</div>
            </div>
            {confirm === 'factory' ? (
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => run('factory')}
                  disabled={busy}
                  style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: 'var(--accent-danger)', color: '#fff', border: 'none', opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? '…' : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirm(null)}
                  style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'var(--bg-3)', color: 'var(--text-1)', border: '1px solid var(--border-default)' }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirm('factory')}
                style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', flexShrink: 0, background: 'var(--bg-3)', color: 'var(--accent-danger)', border: '1px solid rgba(239,68,68,0.25)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-4)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
              >
                Reset
              </button>
            )}
          </div>
        </div>
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
        <p style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.6, marginBottom: 10 }}>
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
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      marginBottom: 12, ...style,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 600,
        color: 'var(--text-0)',
        fontFamily: 'var(--font-ui)',
        letterSpacing: '0.01em',
      }}>
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
    </div>
  )
}

function ThemeSwatch({ id, active, onSelect }: { id: ThemeId; active: boolean; onSelect: (t: ThemeId) => void }) {
  const [bg, accent] = THEME_SWATCHES[id]
  const isLight = LIGHT_THEMES.includes(id)
  const labelColor = isLight ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.92)'
  const labelShadow = isLight ? 'none' : '0 1px 4px rgba(0,0,0,0.6)'
  const checkColor = isLight ? accent : 'white'
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
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke={checkColor} strokeWidth="2.5" strokeLinecap="round">
            <path d="M2 6l3 3 5-5" />
          </svg>
        </div>
      )}
      <div style={{
        position: 'absolute', bottom: 5, left: 10,
        fontSize: 9, fontWeight: 700, textAlign: 'left',
        color: labelColor, textShadow: labelShadow,
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
