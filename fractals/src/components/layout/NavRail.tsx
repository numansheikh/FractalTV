import { ActiveView } from '@/lib/types'
import { useAppStore } from '@/stores/app.store'

const NAV_ITEMS: { id: ActiveView; label: string; shortcut: string; icon: React.ReactNode }[] = [
  { id: 'home',    label: 'Home',    shortcut: '⌘1', icon: <HomeIcon /> },
  { id: 'live',    label: 'Live TV', shortcut: '⌘2', icon: <LiveIcon /> },
  { id: 'films',   label: 'Films',   shortcut: '⌘3', icon: <FilmIcon /> },
  { id: 'series',  label: 'Series',  shortcut: '⌘4', icon: <SeriesIcon /> },
  { id: 'library', label: 'Library', shortcut: '⌘5', icon: <LibraryIcon /> },
]

const ACCENT: Record<ActiveView, string> = {
  home: 'var(--accent-interactive)',
  live: 'var(--accent-live)',
  films: 'var(--accent-film)',
  series: 'var(--accent-series)',
  library: 'var(--accent-interactive)',
}

interface Props {
  onOpenSources: () => void
  onOpenSettings: () => void
}

export function NavRail({ onOpenSources, onOpenSettings }: Props) {
  const { activeView, setView } = useAppStore()

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
      paddingTop: 8,
      paddingBottom: 8,
      gap: 2,
    }}>
      {NAV_ITEMS.map((item) => {
        const isActive = activeView === item.id
        const color = isActive ? ACCENT[item.id] : 'var(--text-2)'
        return (
          <RailButton
            key={item.id}
            label={item.label}
            shortcut={item.shortcut}
            isActive={isActive}
            activeColor={ACCENT[item.id]}
            onClick={() => setView(item.id)}
          >
            <span style={{ color }}>{item.icon}</span>
          </RailButton>
        )
      })}

      {/* Divider */}
      <div style={{ width: 24, height: 1, background: 'var(--border-default)', margin: '6px 0' }} />

      <RailButton label="Sources" shortcut="" isActive={false} activeColor="var(--accent-interactive)" onClick={onOpenSources}>
        <span style={{ color: 'var(--text-2)' }}><LayersIcon /></span>
      </RailButton>

      <div style={{ flex: 1 }} />

      <RailButton label="Settings" shortcut="⌘," isActive={false} activeColor="var(--accent-interactive)" onClick={onOpenSettings}>
        <span style={{ color: 'var(--text-2)' }}><GearIcon /></span>
      </RailButton>
    </div>
  )
}

function RailButton({ label, shortcut, isActive, activeColor, onClick, children }: {
  label: string; shortcut: string; isActive: boolean; activeColor: string; onClick: () => void; children: React.ReactNode
}) {
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
        borderRadius: 8,
        cursor: 'pointer',
        background: isActive ? `${activeColor}18` : 'transparent',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-3)' }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      {/* Active left bar */}
      {isActive && (
        <div style={{
          position: 'absolute',
          left: -4,
          top: 10, bottom: 10,
          width: 3,
          borderRadius: 2,
          background: activeColor,
        }} />
      )}
      {children}
    </div>
  )
}

// ── Icons ──────────────────────────────────────────────────────
function HomeIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
}
function LiveIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg>
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
function GearIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
}
