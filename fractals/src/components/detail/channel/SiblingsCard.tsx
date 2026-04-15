import { ContentItem } from '@/lib/types'

interface Sibling {
  id: string
  title: string
  source_id: string
}

interface Props {
  siblings: Sibling[]
  colorMap: Record<string, { accent: string }>
  sourceNames: Record<string, string>
  onSelect: (item: ContentItem) => void
}

export function SiblingsCard({ siblings, colorMap, sourceNames, onSelect }: Props) {
  if (!siblings.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
      <div style={{
        padding: '10px 12px',
        background: 'var(--accent-interactive)',
        borderBottom: '1px solid rgba(0,0,0,0.18)',
      }}>
        <p style={{
          fontSize: 11, fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '0.1em',
          color: '#fff',
          margin: 0, fontFamily: 'var(--font-ui)',
        }}>
          Also on
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-2)', padding: '4px 0' }}>
        {siblings.map((s) => {
          const color = colorMap[s.source_id]?.accent ?? 'var(--text-3)'
          const sourceName = sourceNames[s.source_id] ?? s.source_id
          return (
            <button
              key={s.id}
              onClick={() => onSelect({ id: s.id, type: 'live', title: s.title, primary_source_id: s.source_id })}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: color, flexShrink: 0,
              }} />
              <span style={{
                fontSize: 11, color: 'var(--text-1)',
                fontFamily: 'var(--font-ui)',
                flexShrink: 0,
                minWidth: 80, maxWidth: 100,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {sourceName}
              </span>
              <span style={{
                fontSize: 12, color: 'var(--text-0)',
                fontFamily: 'var(--font-ui)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {s.title}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
