import { useEffect, useRef } from 'react'
import { ContentItem } from '@/lib/types'
import { useSourcesStore } from '@/stores/sources.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'

interface Props {
  channels: ContentItem[]
  activeId: string
  onSwitch: (ch: ContentItem) => void
  onClose: () => void
}

export function ChannelSurfer({ channels, activeId, onSwitch, onClose }: Props) {
  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)
  const activeRef = useRef<HTMLDivElement>(null)
  const isFirstMount = useRef(true)

  // Scroll active channel into view — instant on mount, smooth on surf
  useEffect(() => {
    const behavior = isFirstMount.current ? 'instant' : 'smooth'
    isFirstMount.current = false
    requestAnimationFrame(() => {
      activeRef.current?.scrollIntoView({ block: 'center', behavior })
    })
  }, [activeId])

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, bottom: 0,
      width: 260,
      background: 'rgba(8,8,12,0.82)',
      backdropFilter: 'blur(20px)',
      borderRight: '1px solid rgba(255,255,255,0.08)',
      display: 'flex', flexDirection: 'column',
      zIndex: 10,
      animation: 'surfer-in 150ms cubic-bezier(0.32,0.72,0,1)',
    }}>
      <style>{`
        @keyframes surfer-in {
          from { opacity: 0; transform: translateX(-20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* Header */}
      <div style={{
        padding: '12px 14px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
          Channels
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono)' }}>
          {channels.length}
        </span>
        <kbd style={{
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 3, padding: '1px 5px', fontSize: 9,
          fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.35)',
        }}>Esc</kbd>
      </div>

      {/* Channel list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}
        // hide scrollbar visually
        className="surfer-list"
      >
        <style>{`.surfer-list::-webkit-scrollbar { width: 2px; } .surfer-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }`}</style>

        {channels.map((ch) => {
          const isActive = ch.id === activeId
          const srcId = ch.primarySourceId ?? ch.primary_source_id ?? (ch as any).source_ids ?? ''
          const srcColor = colorMap[srcId]

          return (
            <div
              key={ch.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => onSwitch(ch)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: isActive ? '10px 14px' : '8px 14px',
                cursor: 'pointer',
                background: isActive ? 'rgba(244,63,94,0.12)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--accent-live)' : '2px solid transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
            >
              {/* Logo */}
              <div style={{
                width: isActive ? 34 : 30, height: isActive ? 34 : 30,
                borderRadius: 5, flexShrink: 0,
                background: 'rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 7, fontWeight: 800, color: 'rgba(255,255,255,0.25)',
                overflow: 'hidden', transition: 'width 0.1s, height 0.1s',
              }}>
                {(ch.posterUrl || ch.poster_url)
                  ? <img src={ch.posterUrl ?? ch.poster_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      onError={(e) => { e.currentTarget.style.display = 'none' }} />
                  : ch.title.split(' ')[0].toUpperCase().substring(0, 4)
                }
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2,
                }}>
                  {srcColor && (
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: srcColor.accent, flexShrink: 0, display: 'inline-block' }} />
                  )}
                  <span style={{
                    fontSize: isActive ? 13 : 12,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? '#fff' : 'rgba(255,255,255,0.65)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    transition: 'font-size 0.1s',
                  }}>
                    {ch.title}
                  </span>
                </div>

                {/* Progress bar — placeholder until Phase 7 EPG */}
                <div style={{ height: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 1, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: isActive ? '40%' : '25%',
                    background: isActive ? 'var(--accent-live)' : 'rgba(255,255,255,0.2)',
                    borderRadius: 1,
                  }} />
                </div>
              </div>

              {/* Live dot for active */}
              {isActive && (
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--accent-live)', flexShrink: 0,
                  animation: 'pulse 1.5s ease-in-out infinite',
                  display: 'inline-block',
                }} />
              )}
            </div>
          )
        })}
      </div>

      {/* Footer hints */}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: '8px 14px',
        display: 'flex', alignItems: 'center', gap: 12,
        flexShrink: 0,
      }}>
        <Hint keys={['PgUp', 'PgDn']} label="Surf" />
        <Hint keys={['Esc']} label="Close" />
      </div>
    </div>
  )
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
      {keys.map((k) => (
        <kbd key={k} style={{
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 3, padding: '1px 5px', fontSize: 9,
          fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.35)',
        }}>{k}</kbd>
      ))}
      <span>{label}</span>
    </div>
  )
}
