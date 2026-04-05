import { useRef } from 'react'

interface Props {
  label: string
  children: React.ReactNode
}

export function HorizontalScroller({ label, children }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scroll = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: 8,
        padding: '0 2px',
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-2)',
          fontFamily: 'var(--font-ui)',
          userSelect: 'none',
        }}>
          {label}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => scroll(-400)}
          aria-label="Scroll left"
          style={arrowButtonStyle}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          onClick={() => scroll(400)}
          aria-label="Scroll right"
          style={{ ...arrowButtonStyle, marginLeft: 4 }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Scroll container */}
      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          gap: 10,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'none',
          paddingBottom: 4,
          // Hide webkit scrollbar via inline style isn't possible — handled globally in globals.css
        }}
      >
        {children}
      </div>
    </div>
  )
}

const arrowButtonStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-3)',
  border: '1px solid var(--border-default)',
  color: 'var(--text-2)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
  transition: 'background 0.1s, border-color 0.1s',
}
