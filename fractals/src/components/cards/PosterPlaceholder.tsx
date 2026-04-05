import React from 'react'

const GRADIENT_PAIRS: [string, string][] = [
  ['#1a0a2e', '#6b21a8'],   // deep purple → purple
  ['#0f1729', '#1e3a5f'],   // dark navy → navy
  ['#0a1820', '#164e63'],   // dark teal → teal
  ['#0f1a1a', '#134e4a'],   // dark emerald → emerald
  ['#1a0a0a', '#7f1d1d'],   // dark red → red
  ['#180a1a', '#701a75'],   // dark fuchsia → fuchsia
  ['#1a0a14', '#9d174d'],   // dark rose → rose
  ['#1a0f0a', '#7c2d12'],   // dark orange → orange
  ['#1a1200', '#78350f'],   // dark amber → amber
  ['#0a150f', '#166534'],   // dark green → green
  ['#12121a', '#312e81'],   // dark indigo → indigo
  ['#0a1a1a', '#0e7490'],   // dark cyan → cyan
]

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

interface Props {
  id: string
  title: string
  className?: string
  style?: React.CSSProperties
}

export function PosterPlaceholder({ id, title, className, style }: Props) {
  const idx = hashId(id) % GRADIENT_PAIRS.length
  const [from, to] = GRADIENT_PAIRS[idx]
  const letter = title.trim().charAt(0).toUpperCase() || '?'

  return (
    <div
      className={className}
      style={{
        width: '100%',
        height: '100%',
        background: `linear-gradient(145deg, ${from} 0%, ${to} 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        ...style,
      }}
    >
      <span
        style={{
          fontSize: 'clamp(24px, 30%, 56px)',
          fontWeight: 700,
          color: 'rgba(255,255,255,0.45)',
          letterSpacing: '-0.01em',
          lineHeight: 1,
          fontFamily: 'var(--font-ui, system-ui, sans-serif)',
        }}
      >
        {letter}
      </span>
    </div>
  )
}
