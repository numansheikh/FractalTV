import { useRef, useEffect } from 'react'
import { useSearchStore } from '@/stores/search.store'
import { FractalsIcon } from '@/components/shared/FractalsIcon'

interface Props {
  onOpenSettings: () => void
  layoutH: boolean
  onToggleLayout: () => void
}

export function SearchBar({ onOpenSettings, layoutH, onToggleLayout }: Props) {
  const { query, setQuery, activeCategory, clearScope } = useSearchStore()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if ((e.key === '/' || (meta && e.key === 'k')) && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape') {
        if (query) {
          e.preventDefault()
          setQuery('')
          inputRef.current?.blur()
        } else if (activeCategory) {
          e.preventDefault()
          clearScope()
          inputRef.current?.blur()
        } else if (document.activeElement === inputRef.current) {
          inputRef.current?.blur()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setQuery, clearScope, query, activeCategory])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Backspace on empty input removes scope tag
    if (e.key === 'Backspace' && !query && activeCategory) {
      e.preventDefault()
      clearScope()
    }
  }

  const placeholder = activeCategory
    ? `Search in ${activeCategory}…`
    : 'Search channels, movies, actors, directors…'

  return (
    <div
      className="drag-region"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 14px 9px 80px',
        background: 'var(--color-nav-bg)',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
        minHeight: 48,
      }}
    >
      {/* Logo */}
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
        <FractalsIcon size={20} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-nav-text)', letterSpacing: '-0.01em' }}>
          Fractals
        </span>
      </div>

      {/* Search input */}
      <div
        className="no-drag"
        style={{
          flex: 1,
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(0,0,0,0.28)',
          border: `1px solid ${activeCategory ? 'rgba(124,77,255,0.35)' : 'rgba(255,255,255,0.22)'}`,
          borderRadius: 9,
          padding: '7px 12px',
          transition: 'border-color 0.15s',
        }}
        onFocusCapture={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)' }}
        onBlurCapture={(e) => { e.currentTarget.style.borderColor = activeCategory ? 'rgba(124,77,255,0.35)' : 'rgba(255,255,255,0.22)' }}
      >
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
          style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>

        {/* Scope tag */}
        {activeCategory && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'rgba(124,77,255,0.2)', border: '1px solid rgba(124,77,255,0.35)',
            borderRadius: 5, padding: '2px 6px 2px 8px',
            fontSize: 11, fontWeight: 600, color: '#b388ff',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {activeCategory.length > 24 ? activeCategory.slice(0, 22) + '…' : activeCategory}
            <span
              onClick={(e) => { e.stopPropagation(); clearScope(); inputRef.current?.focus() }}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 14, height: 14, borderRadius: 3,
                background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)',
                fontSize: 9, cursor: 'pointer', lineHeight: 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = '#fff' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)' }}
            >
              &times;
            </span>
          </span>
        )}

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="nav-search-input"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontSize: 13, color: '#fff', caretColor: '#fff',
            fontFamily: 'inherit',
          }}
          autoFocus
        />

        {query ? (
          <button
            onClick={() => { setQuery(''); inputRef.current?.focus() }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-nav-text)', opacity: 0.6, padding: 2 }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6' }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        ) : (
          <kbd style={{
            padding: '2px 6px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace',
            background: 'rgba(0,0,0,0.2)', color: 'var(--color-nav-text)',
            border: '1px solid rgba(255,255,255,0.15)', lineHeight: 1.4, opacity: 0.7,
          }}>
            /
          </kbd>
        )}
      </div>

      {/* Layout toggle */}
      <button
        className="no-drag"
        onClick={onToggleLayout}
        title={layoutH ? 'Switch to vertical layout' : 'Switch to horizontal layout'}
        style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: layoutH ? 'rgba(124,77,255,0.25)' : 'rgba(0,0,0,0.15)',
          border: `1px solid ${layoutH ? 'rgba(124,77,255,0.4)' : 'rgba(255,255,255,0.12)'}`,
          cursor: 'pointer', color: layoutH ? '#b388ff' : 'var(--color-nav-text)',
          opacity: layoutH ? 1 : 0.75, transition: 'all 0.1s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={(e) => { if (!layoutH) e.currentTarget.style.opacity = '0.75' }}
      >
        {layoutH ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>
          </svg>
        )}
      </button>

      {/* Settings */}
      <button
        className="no-drag"
        onClick={onOpenSettings}
        title="Settings (⌘,)"
        style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.12)',
          cursor: 'pointer', color: 'var(--color-nav-text)', opacity: 0.75,
          transition: 'all 0.1s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(0,0,0,0.25)' }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.75'; e.currentTarget.style.background = 'rgba(0,0,0,0.15)' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  )
}
