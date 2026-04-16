import { ActiveView } from '@/lib/types'
import { useAppStore } from '@/stores/app.store'
import { useSourcesStore } from '@/stores/sources.store'
import { useTheme } from '@/hooks/useTheme'

const NAV_ITEMS: { id: ActiveView; label: string; shortcut: string }[] = [
  { id: 'home',    label: 'Home',    shortcut: '⌘1' },
  { id: 'live',    label: 'Channels', shortcut: '⌘2' },
  { id: 'films',   label: 'Films',   shortcut: '⌘3' },
  { id: 'series',  label: 'Series',  shortcut: '⌘4' },
  { id: 'library', label: 'Library', shortcut: '⌘5' },
]

const ACCENT: Record<ActiveView, string> = {
  home:    'var(--accent-interactive)',
  live:    'var(--accent-live)',
  films:   'var(--accent-film)',
  series:  'var(--accent-series)',
  library: 'var(--accent-interactive)',
}

interface Props {
  onOpenSources: () => void
  onOpenSettings: () => void
}

export function NavRail({ onOpenSources, onOpenSettings }: Props) {
  const { activeView, setView } = useAppStore()
  const { theme, setTheme } = useTheme()
  const syncProgress = useSourcesStore((s) => s.syncProgress)
  const enrichProgress = useSourcesStore((s) => s.enrichProgress)
  const isSyncing = Object.values(syncProgress).some((p) => p && p.phase !== 'done' && p.phase !== 'error')
  const isEnriching = Object.values(enrichProgress).some((p) => p !== null)
  const isBusy = isSyncing || isEnriching

  return (
    <div style={{
      width: 48,
      height: '100%',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      background: 'var(--bg-1)',
      borderRight: '1px solid var(--border-subtle)',
      position: 'relative',
      zIndex: 50,
      paddingTop: 8,
      paddingBottom: 8,
      gap: 2,
    }}>
      {NAV_ITEMS.map((item) => {
        const isActive = activeView === item.id
        const accent = ACCENT[item.id]
        return (
          <RailButton
            key={item.id}
            label={item.label}
            shortcut={item.shortcut}
            isActive={isActive}
            activeColor={accent}
            inactiveColor={accent}
            onClick={() => {
              setView(item.id)
              if (item.id !== 'live') {
                const s = useAppStore.getState()
                s.setLiveViewChannel(null)
                if (s.playerMode === 'fullscreen') {
                  s.setPlayerMode('hidden')
                  s.setPlayingContent(null)
                }
              }
            }}
          >
            <NavIcon id={item.id} />
          </RailButton>
        )
      })}

      <div style={{ flex: 1 }} />

      {/* DEV: theme toggle — remove before ship */}
      <RailButton label={theme === 'dark' ? 'Light mode' : 'Dark mode'} shortcut="" isActive={false} activeColor="var(--accent-interactive)" onClick={() => setTheme(theme === 'dark' ? 'fractals-day' : 'dark')}>
        <span style={{ color: 'var(--text-2)' }}>{theme === 'dark' ? <SunIcon /> : <MoonIcon />}</span>
      </RailButton>

      <RailButton label="Sources" shortcut="" isActive={false} activeColor="var(--accent-interactive)" onClick={onOpenSources}>
        <span style={{ color: isBusy ? 'var(--accent-interactive)' : 'var(--text-2)', animation: isBusy ? 'nav-pulse 2s ease-in-out infinite' : 'none' }}>
          <LayersIcon />
        </span>
      </RailButton>

      <RailButton label="Settings" shortcut="⌘," isActive={false} activeColor="var(--accent-interactive)" onClick={onOpenSettings}>
        <span style={{ color: 'var(--text-2)' }}><GearIcon /></span>
      </RailButton>
    </div>
  )
}

function RailButton({ label, shortcut, isActive, activeColor, inactiveColor, onClick, children }: {
  label: string; shortcut: string; isActive: boolean; activeColor: string; inactiveColor?: string; onClick: () => void; children: React.ReactNode
}) {
  const idleColor = inactiveColor
    ? `color-mix(in srgb, ${inactiveColor} 55%, var(--text-2))`
    : 'var(--text-2)'
  return (
    <div
      onClick={onClick}
      title={shortcut ? `${label} ${shortcut}` : label}
      style={{
        position: 'relative',
        width: 40,
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        cursor: 'pointer',
        background: isActive ? `color-mix(in srgb, ${activeColor} 16%, transparent)` : 'transparent',
        border: isActive ? `1.5px solid color-mix(in srgb, ${activeColor} 40%, transparent)` : '1.5px solid transparent',
        color: isActive ? activeColor : idleColor,
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.color = inactiveColor ?? 'var(--text-1)'
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.color = idleColor
      }}
    >
      {children}
    </div>
  )
}

// ── Per-view icon dispatcher ───────────────────────────────────
function NavIcon({ id }: { id: ActiveView }) {
  switch (id) {
    case 'home':    return <HomeIcon />
    case 'live':    return <LiveIcon />
    case 'films':   return <FilmIcon />
    case 'series':  return <SeriesIcon />
    case 'library': return <LibraryIcon />
  }
}

// ── Icons (original outlines) ──────────────────────────────────
function HomeIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
}
function LiveIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>
}
function FilmIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
}
function SeriesIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
}
function LibraryIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
}
function LayersIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
}
function SunIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
}
function MoonIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
}
function GearIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
}

/*
 * ── Filled icon variants (for future use) ──────────────────────
 * When ready, pass filled={isActive} to NavIcon and swap in these.
 *
 * HomeIcon filled:   <svg fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
 * FilmIcon filled:   <svg fill="currentColor"><path d="M18 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3zM8 17H6v-2h2v2zm0-4H6v-2h2v2zm0-4H6V7h2v2zm10 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2z"/></svg>
 * SeriesIcon filled: <svg fill="currentColor"><path d="M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18v12z"/></svg>
 * LibraryIcon filled:<svg fill="currentColor"><path d="M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2z"/></svg>
 */
