import { useEffect, useRef, useState } from 'react'
import { ContentItem } from '@/lib/types'
import { api } from '@/lib/api'

interface TmdbResult {
  tmdbId: number
  title: string
  originalTitle?: string
  year?: string
  overview?: string
  posterUrl?: string
  rating?: number
}

interface Props {
  item: ContentItem
  onEnriched: () => void
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/^[A-Z]{2,4}[\s]*[-–:|][\s]*/i, '')
    .replace(/\s*(HD|FHD|4K|SD|UHD)\s*$/i, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim()
}

function extractYear(raw: string): string {
  const m = raw.match(/\((\d{4})\)\s*$/)
  return m ? m[1] : ''
}

export function EnrichmentFallback({ item, onEnriched }: Props) {
  const [enriching, setEnriching] = useState(false)
  const [failed, setFailed] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // Manual search form state
  const [title, setTitle] = useState(() => cleanTitle(item.title))
  const [yearStr, setYearStr] = useState(() => extractYear(item.title))
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<TmdbResult[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const enrichAttemptedRef = useRef(false)

  // Reset when item changes
  useEffect(() => {
    enrichAttemptedRef.current = false
    setFailed(false)
    setShowForm(false)
    setResults(null)
    setSearchError(null)
    setTitle(cleanTitle(item.title))
    setYearStr(extractYear(item.title))
  }, [item.id, item.title])

  // Auto-enrich on mount if not enriched
  useEffect(() => {
    if (item.enriched) return
    if (item.type === 'live') return
    if (enrichAttemptedRef.current) return
    enrichAttemptedRef.current = true

    setEnriching(true)

    const timer = setTimeout(() => {
      setEnriching(false)
      setFailed(true)
    }, 15_000)

    api.enrichment.enrichSingle(item.id).then((res: any) => {
      clearTimeout(timer)
      setEnriching(false)
      if (res?.success && res?.enrichedWithData) {
        onEnriched()
      } else {
        setFailed(true)
      }
    }).catch(() => {
      clearTimeout(timer)
      setEnriching(false)
      setFailed(true)
    })

    return () => clearTimeout(timer)
  }, [item.id, item.type, item.enriched, onEnriched])

  const handleSearch = async () => {
    if (!title.trim()) return
    setSearchError(null)
    setResults(null)
    setSearching(true)
    try {
      const year = yearStr ? parseInt(yearStr, 10) : undefined
      const res = await api.enrichment.searchTmdb({
        title: title.trim(),
        year,
        type: item.type === 'series' ? 'series' : 'movie',
      }) as any
      setSearching(false)
      if (res?.success && res?.results?.length > 0) {
        setResults(res.results)
      } else if (res?.error) {
        setSearchError(res.error)
      } else {
        setSearchError('No results found. Try a different title.')
      }
    } catch (err) {
      setSearching(false)
      setSearchError(`Search failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handlePick = async (tmdbId: number) => {
    setPicking(true)
    try {
      const res = await api.enrichment.enrichById({ contentId: item.id, tmdbId }) as any
      setPicking(false)
      if (res?.success && res?.enrichedWithData) {
        onEnriched()
      } else {
        setSearchError('Failed to enrich with selected result.')
      }
    } catch (err) {
      setPicking(false)
      setSearchError(`Enrichment failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: '6px 9px',
    borderRadius: 6,
    fontSize: 12,
    background: 'var(--bg-0)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-0)',
    outline: 'none',
    fontFamily: 'var(--font-ui)',
    width: '100%',
    boxSizing: 'border-box',
  }

  // State 1: Auto-enriching spinner
  if (enriching) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '12px 14px',
        borderRadius: 8,
        background: 'var(--bg-2)',
        border: '1px solid var(--border-subtle)',
      }}>
        <div style={{
          width: 13,
          height: 13,
          borderRadius: '50%',
          border: '2px solid rgba(139,92,246,0.2)',
          borderTopColor: 'var(--accent-interactive)',
          animation: 'spin 0.8s linear infinite',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-ui)' }}>
          Fetching metadata from TMDB…
        </span>
      </div>
    )
  }

  // Already enriched — show "wrong match?" re-match link
  if (item.enriched && !showForm) {
    return (
      <div>
        <span
          onClick={() => setShowForm(true)}
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
            transition: 'color 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-interactive)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
        >
          Wrong match? Search TMDB manually
        </span>
      </div>
    )
  }

  // State 2: Failed / no match
  if (failed && !showForm) {
    return (
      <div style={{
        padding: '12px 14px',
        borderRadius: 8,
        background: 'var(--bg-2)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <p style={{ fontSize: 12, color: 'var(--accent-warning)', margin: 0, fontFamily: 'var(--font-ui)' }}>
          Could not find a TMDB match.
        </p>
        <span
          onClick={() => setShowForm(true)}
          style={{
            fontSize: 12,
            color: 'var(--accent-interactive)',
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
            transition: 'opacity 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.75' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          Search manually →
        </span>
      </div>
    )
  }

  // State 3+: Manual search form
  if (showForm || failed) {
    return (
      <div style={{
        padding: '14px',
        borderRadius: 8,
        background: 'var(--bg-2)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-ui)' }}>
          Search TMDB manually
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
            placeholder="Title"
            style={inputStyle}
          />
          <input
            value={yearStr}
            onChange={(e) => setYearStr(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
            placeholder="Year (optional)"
            style={{ ...inputStyle, width: 'auto' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSearch}
            disabled={searching || !title.trim()}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              background: searching ? 'var(--bg-4)' : 'var(--accent-interactive)',
              color: '#fff',
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: searching ? 'default' : 'pointer',
              fontFamily: 'var(--font-ui)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'opacity 0.12s',
            }}
          >
            {searching && (
              <div style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: '#fff',
                animation: 'spin 0.8s linear infinite',
              }} />
            )}
            Search
          </button>
          {showForm && (
            <button
              onClick={() => { setShowForm(false); setResults(null); setSearchError(null) }}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--text-2)',
                border: '1px solid var(--border-subtle)',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
              }}
            >
              Cancel
            </button>
          )}
        </div>

        {searchError && (
          <p style={{ fontSize: 11, color: 'var(--accent-danger)', margin: 0, fontFamily: 'var(--font-ui)' }}>
            {searchError}
          </p>
        )}

        {/* State 4: Result list */}
        {results && results.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {results.map((r) => (
              <button
                key={r.tmdbId}
                onClick={() => handlePick(r.tmdbId)}
                disabled={picking}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '8px',
                  borderRadius: 6,
                  background: 'var(--bg-3)',
                  border: '1px solid var(--border-subtle)',
                  cursor: picking ? 'default' : 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.1s',
                  opacity: picking ? 0.6 : 1,
                  width: '100%',
                }}
                onMouseEnter={(e) => { if (!picking) e.currentTarget.style.background = 'var(--bg-4)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
              >
                {/* Poster thumbnail */}
                {r.posterUrl ? (
                  <img
                    src={r.posterUrl}
                    alt=""
                    style={{ width: 40, height: 60, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                  />
                ) : (
                  <div style={{
                    width: 40,
                    height: 60,
                    borderRadius: 4,
                    background: 'var(--bg-0)',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <polygon points="10 8 16 12 10 16 10 8" fill="var(--text-3)" stroke="none" />
                    </svg>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-0)',
                    margin: '0 0 2px',
                    fontFamily: 'var(--font-ui)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {r.title}
                  </p>
                  {r.year && (
                    <p style={{ fontSize: 11, color: 'var(--text-2)', margin: '0 0 4px', fontFamily: 'var(--font-ui)' }}>
                      {r.year}
                    </p>
                  )}
                  {r.overview && (
                    <p style={{
                      fontSize: 11,
                      color: 'var(--text-1)',
                      margin: 0,
                      lineHeight: 1.4,
                      fontFamily: 'var(--font-ui)',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {r.overview}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return null
}
