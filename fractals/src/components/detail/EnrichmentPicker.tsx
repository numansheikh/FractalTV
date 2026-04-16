import { useEffect, useRef } from 'react'
import { api } from '@/lib/api'

interface EnrichmentCandidate {
  id: number
  confidence: number
  raw_json: string
}

interface ParsedCandidate {
  id: number
  confidence: number
  title: string
  year: number | null
  directors: string[]
  country: string | null
  language: string | null
  poster_url: string | null
  overview: string | null
}

interface Props {
  contentId: string
  contentType: 'movie' | 'series'
  candidates: EnrichmentCandidate[]
  onPicked: () => void
  onDisabled: () => void
  onClose: () => void
}

function parseCandidate(row: EnrichmentCandidate): ParsedCandidate {
  try {
    const c = JSON.parse(row.raw_json)
    return {
      id: row.id,
      confidence: row.confidence,
      title: c.title ?? '',
      year: c.year ?? null,
      directors: c.directors ?? [],
      country: c.country ?? null,
      language: c.language ?? null,
      poster_url: c.poster_url ?? null,
      overview: c.overview ?? null,
    }
  } catch {
    return { id: row.id, confidence: row.confidence, title: '', year: null, directors: [], country: null, language: null, poster_url: null, overview: null }
  }
}

export function EnrichmentPicker({ contentId, contentType, candidates, onPicked, onDisabled, onClose }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const parsed = candidates
    .filter((c) => c.confidence > 0 && c.raw_json !== '{}')
    .map(parseCandidate)
    .slice(0, 5)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose])

  const handlePick = async (id: number) => {
    await api.vodEnrich.pickCandidate(contentId, id)
    onPicked()
  }

  const handleDisable = async () => {
    await api.vodEnrich.disable(contentId)
    onDisabled()
  }

  const noun = contentType === 'movie' ? 'film' : 'series'

  return (
    <div
      ref={backdropRef}
      style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div style={{
        width: 420, maxHeight: '80vh',
        background: 'var(--bg-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 10,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', fontFamily: 'var(--font-ui)' }}>
            Pick the correct {noun}
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: 4, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Candidate list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
          {parsed.length === 0 ? (
            <p style={{ padding: '16px', color: 'var(--text-2)', fontSize: 12, fontFamily: 'var(--font-ui)', margin: 0 }}>
              No candidates found.
            </p>
          ) : (
            parsed.map((c) => (
              <button
                key={c.id}
                onClick={() => handlePick(c.id)}
                style={{
                  width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                  padding: '8px 16px',
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  textAlign: 'left',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
              >
                {/* Poster */}
                <div style={{
                  width: 44, height: 64, borderRadius: 4, flexShrink: 0,
                  background: 'var(--bg-3)',
                  overflow: 'hidden',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {c.poster_url ? (
                    <img
                      src={c.poster_url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <span style={{ fontSize: 18, color: 'var(--text-3)' }}>🎬</span>
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', fontFamily: 'var(--font-ui)', lineHeight: 1.3 }}>
                    {c.title || '—'}
                    {c.year ? <span style={{ fontWeight: 400, color: 'var(--text-2)', marginLeft: 6 }}>({c.year})</span> : null}
                  </span>
                  {c.directors.length > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-ui)' }}>
                      dir. {c.directors.slice(0, 2).join(', ')}
                    </span>
                  )}
                  {(c.country || c.language) && (
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-ui)' }}>
                      {[c.country, c.language].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {c.overview && (
                    <span style={{
                      fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-ui)',
                      marginTop: 2,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {c.overview}
                    </span>
                  )}
                  {/* Confidence */}
                  <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {Math.round(c.confidence * 100)}% match
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          <button
            onClick={handleDisable}
            style={{
              width: '100%', padding: '8px', borderRadius: 6,
              background: 'transparent',
              border: '1px solid var(--border-default)',
              color: 'var(--text-2)', fontSize: 12,
              cursor: 'pointer', fontFamily: 'var(--font-ui)',
              transition: 'background 0.1s, color 0.1s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--text-1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-2)' }}
          >
            None of these — use stream data only
          </button>
        </div>
      </div>
    </div>
  )
}
