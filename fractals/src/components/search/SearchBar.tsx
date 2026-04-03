import { useRef, useEffect } from 'react'
import { useSearchStore, ContentType } from '@/stores/search.store'

const TYPES: { label: string; value: ContentType }[] = [
  { label: 'All', value: 'all' },
  { label: 'Live TV', value: 'live' },
  { label: 'Movies', value: 'movie' },
  { label: 'Series', value: 'series' },
]

export function SearchBar() {
  const { query, type, setQuery, setType } = useSearchStore()
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus on / key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape') {
        setQuery('')
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setQuery])

  return (
    <div className="flex flex-col gap-2 px-4 pt-4 pb-2">
      {/* Search input */}
      <div
        className="flex items-center gap-3 rounded-xl px-4 py-3"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search channels, movies, series, actors, directors..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-text-muted)]"
          style={{ color: 'var(--color-text-primary)' }}
          autoFocus
        />

        {query && (
          <button onClick={() => setQuery('')} style={{ color: 'var(--color-text-muted)' }}
            className="text-xs hover:text-[var(--color-text-secondary)] transition-colors">
            ✕
          </button>
        )}

        <kbd className="hidden rounded px-1.5 py-0.5 text-xs sm:block"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
          /
        </kbd>
      </div>

      {/* Type filter chips */}
      <div className="flex gap-1.5">
        {TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setType(t.value)}
            className="rounded-full px-3 py-1 text-xs font-medium transition-all"
            style={type === t.value
              ? { background: 'var(--color-primary)', color: '#fff' }
              : { background: 'var(--color-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }
            }
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}
