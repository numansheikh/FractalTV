import { ContentItem } from '@/lib/types'

interface Props {
  item: ContentItem
}

export function AboutBlock({ item }: Props) {
  const plot = item.plot ?? ''
  if (!plot) return null

  return (
    <p style={{
      fontSize: 13,
      color: 'var(--text-1)',
      lineHeight: 1.6,
      margin: 0,
      fontFamily: 'var(--font-ui)',
    }}>
      {plot}
    </p>
  )
}

export function parseCast(raw: string | undefined): string[] {
  if (!raw) return []
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [String(p)] } catch { return [raw] }
}

export function CastPanel({ cast }: { cast: string[] }) {
  if (!cast.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{
        fontSize: 10, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        color: 'var(--text-2)', fontFamily: 'var(--font-ui)',
      }}>
        Cast
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {cast.map((name) => (
          <span key={name} style={{
            padding: '4px 10px', borderRadius: 20,
            background: 'var(--bg-2)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-1)',
            fontSize: 11, whiteSpace: 'nowrap',
            fontFamily: 'var(--font-ui)',
          }}>
            {name}
          </span>
        ))}
      </div>
    </div>
  )
}
