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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
      <span style={{
        fontSize: 10, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--text-3)', fontFamily: 'var(--font-ui)',
        flexShrink: 0,
      }}>
        Cast
      </span>
      {cast.map((name) => (
        <span key={name} style={{
          padding: '4px 10px', borderRadius: 20,
          background: 'var(--bg-3)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-1)',
          fontSize: 11, whiteSpace: 'nowrap',
          fontFamily: 'var(--font-ui)',
        }}>
          {name}
        </span>
      ))}
    </div>
  )
}
