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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{
        fontSize: 10, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--text-3)', fontFamily: 'var(--font-ui)',
        marginBottom: 4,
      }}>
        Cast
      </span>
      {cast.map((name) => (
        <span key={name} style={{
          fontSize: 12, color: 'var(--text-1)',
          fontFamily: 'var(--font-ui)',
          padding: '3px 0',
          borderBottom: '1px solid var(--border-subtle)',
          lineHeight: 1.4,
        }}>
          {name}
        </span>
      ))}
    </div>
  )
}
