import { ContentItem } from '@/lib/types'
import { useSearchStore } from '@/stores/search.store'

interface Props {
  item: ContentItem
  onClose: () => void
}

function parseCast(raw: string | undefined): string[] {
  if (!raw) return []
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [String(p)] } catch { return [raw] }
}

export function AboutBlock({ item, onClose }: Props) {
  const setQuery = useSearchStore((s) => s.setQuery)

  const plot = item.plot ?? ''
  const cast = parseCast(item.cast)

  if (!plot && cast.length === 0) return null

  return (
    <>
      {cast.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 10, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--text-3)', flexShrink: 0,
            fontFamily: 'var(--font-ui)',
          }}>
            Cast
          </span>
          <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
            {cast.slice(0, 12).map((name) => (
              <button
                key={name}
                onClick={() => { setQuery(name); onClose() }}
                style={{
                  padding: '4px 10px', borderRadius: 20,
                  background: 'var(--bg-3)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-1)',
                  fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
                  fontFamily: 'var(--font-ui)', flexShrink: 0,
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-4)'
                  e.currentTarget.style.color = 'var(--text-0)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-3)'
                  e.currentTarget.style.color = 'var(--text-1)'
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {plot && (
        <p style={{
          fontSize: 13,
          color: 'var(--text-1)',
          lineHeight: 1.6,
          margin: 0,
          fontFamily: 'var(--font-ui)',
        }}>
          {plot}
        </p>
      )}
    </>
  )
}
