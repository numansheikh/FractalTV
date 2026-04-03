import { useRef, useEffect } from 'react'
import { useSearchStore, ContentType } from '@/stores/search.store'

const TYPES: { label: string; value: ContentType; shortcut: string }[] = [
  { label: 'All', value: 'all', shortcut: '1' },
  { label: 'Live TV', value: 'live', shortcut: '2' },
  { label: 'Movies', value: 'movie', shortcut: '3' },
  { label: 'Series', value: 'series', shortcut: '4' },
]

export function SearchBar() {
  const { query, type, setQuery, setType } = useSearchStore()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      // Focus search
      if ((e.key === '/' || (meta && e.key === 'k')) && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      // Clear + blur
      if (e.key === 'Escape') {
        setQuery('')
        inputRef.current?.blur()
      }
      // Type shortcuts Cmd+1–4
      if (meta && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        const idx = parseInt(e.key) - 1
        setType(TYPES[idx].value)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setQuery, setType])

  return (
    <div
      className="no-drag flex flex-col"
      style={{
        padding: '10px 12px 8px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* Search input */}
      <div
        className="flex items-center gap-2.5 rounded-lg"
        style={{
          background: 'var(--color-card)',
          border: '1px solid var(--color-border)',
          padding: '8px 12px',
          transition: 'border-color 0.15s',
        }}
        onFocusCapture={(e) => {
          e.currentTarget.style.borderColor = 'rgba(124, 77, 255, 0.4)'
        }}
        onBlurCapture={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-border)'
        }}
      >
        <svg
          width="14"
          height="14"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
          style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search channels, movies, actors, directors…"
          className="flex-1 bg-transparent text-sm outline-none"
          style={{
            color: 'var(--color-text-primary)',
            caretColor: 'var(--color-primary)',
          }}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />

        {query ? (
          <button
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            className="flex items-center justify-center rounded transition-colors"
            style={{ color: 'var(--color-text-muted)', padding: '1px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        ) : (
          <kbd
            className="rounded px-1.5 py-0.5 text-[10px] font-mono"
            style={{
              background: 'var(--color-surface)',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
              lineHeight: '1.4',
            }}
          >
            /
          </kbd>
        )}
      </div>

      {/* Type filter chips */}
      <div className="mt-2 flex gap-1">
        {TYPES.map((t) => {
          const active = type === t.value
          return (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition-all"
              style={
                active
                  ? {
                      background: 'var(--color-primary-dim)',
                      color: 'var(--color-accent)',
                      border: '1px solid rgba(124,77,255,0.3)',
                    }
                  : {
                      background: 'transparent',
                      color: 'var(--color-text-secondary)',
                      border: '1px solid transparent',
                    }
              }
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.color = 'var(--color-text-primary)'
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.color = 'var(--color-text-secondary)'
                  e.currentTarget.style.borderColor = 'transparent'
                }
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
