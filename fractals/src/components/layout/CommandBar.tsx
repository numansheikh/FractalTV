import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/stores/app.store'
import { useSourcesStore } from '@/stores/sources.store'
import { useSearchStore } from '@/stores/search.store'
import { buildColorMap } from '@/lib/sourceColors'

const SORT_OPTIONS = [
  { label: 'Latest Added', value: 'updated:desc' },
  { label: 'Title A–Z',    value: 'title:asc' },
  { label: 'Title Z–A',    value: 'title:desc' },
  { label: 'Year (Newest)', value: 'year:desc' },
  { label: 'Year (Oldest)', value: 'year:asc' },
  { label: 'Top Rated',    value: 'rating:desc' },
]

interface Props {
  sort: string
  onSortChange: (v: string) => void
}

export function CommandBar({ sort, onSortChange }: Props) {
  const { query, setQuery } = useSearchStore()
  const { selectedSourceIds, toggleSourceFilter, activeView, viewMode, setViewMode } = useAppStore()
  const { sources } = useSourcesStore()
  const colorMap = buildColorMap(sources.map((s) => s.id))
  const inputRef = useRef<HTMLInputElement>(null)
  const [showSort, setShowSort] = useState(false)

  // Hide sort on home — home has its own layout
  const showSortBtn = activeView !== 'home' || !!query
  // View toggle for live TV (always visible, even during search)
  const showViewToggle = activeView === 'live'

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const sortLabel = SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'Latest Added'

  return (
    <div style={{
      height: 44,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '0 12px',
      borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--bg-1)',
      flexShrink: 0,
      position: 'relative',
      minWidth: 0,
    }}>
      {/* Search input */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round"
          style={{ position: 'absolute', left: 10, pointerEvents: 'none' }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movies, channels, actors…"
          style={{
            width: '100%', height: 32,
            padding: '0 10px 0 32px',
            borderRadius: 6,
            background: 'var(--bg-2)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-0)',
            fontSize: 13,
            outline: 'none',
            transition: 'border-color 0.1s',
          }}
          onFocus={(e) => { e.target.style.borderColor = 'var(--accent-interactive)' }}
          onBlur={(e) => { e.target.style.borderColor = 'var(--border-default)' }}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            style={{ position: 'absolute', right: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', display: 'flex', padding: 2 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* Sort dropdown */}
      {showSortBtn && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowSort((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6,
              background: showSort ? 'var(--bg-3)' : 'var(--bg-2)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-2)', fontSize: 12, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {sortLabel}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points={showSort ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
            </svg>
          </button>
          {showSort && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', right: 0,
              background: 'var(--bg-2)', border: '1px solid var(--border-default)',
              borderRadius: 8, padding: 4, zIndex: 100, minWidth: 160,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { onSortChange(opt.value); setShowSort(false) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '7px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
                    fontSize: 12, color: sort === opt.value ? 'var(--accent-interactive)' : 'var(--text-1)',
                    background: sort === opt.value ? 'var(--accent-interactive-dim)' : 'transparent',
                    fontWeight: sort === opt.value ? 500 : 400,
                  }}
                  onMouseEnter={(e) => { if (sort !== opt.value) e.currentTarget.style.background = 'var(--bg-3)' }}
                  onMouseLeave={(e) => { if (sort !== opt.value) e.currentTarget.style.background = 'transparent' }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Grid / list view toggle — live TV only */}
      {showViewToggle && (
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-default)', flexShrink: 0 }}>
          {(['grid', 'list'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              title={mode === 'grid' ? 'Grid view' : 'List view'}
              style={{
                width: 28, height: 28,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: viewMode === mode ? 'var(--accent-interactive-dim)' : 'var(--bg-2)',
                border: 'none',
                borderLeft: mode === 'list' ? '1px solid var(--border-default)' : 'none',
                cursor: 'pointer',
                color: viewMode === mode ? 'var(--accent-interactive)' : 'var(--text-2)',
                transition: 'background 0.1s, color 0.1s',
              }}
            >
              {mode === 'grid' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Source filter dots */}
      {sources.filter((s) => !s.disabled).length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 2, flexShrink: 0 }}>
          {sources.filter((s) => !s.disabled).map((src) => {
            const color = colorMap[src.id]?.accent ?? 'var(--text-2)'
            const anySelected = selectedSourceIds.length > 0
            const isSelected = selectedSourceIds.includes(src.id)
            // No filter active → all dots filled (showing all content)
            // Filter active → only selected dots filled, others are dim rings
            const isFilled = !anySelected || isSelected
            return (
              <button
                key={src.id}
                onClick={() => toggleSourceFilter(src.id)}
                title={anySelected ? (isSelected ? `Filtering: ${src.name}` : `Add ${src.name} to filter`) : src.name}
                style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: isFilled ? color : 'transparent',
                  border: `2px solid ${color}`,
                  cursor: 'pointer', padding: 0,
                  transition: 'all 0.1s',
                  opacity: isFilled ? 1 : 0.35,
                }}
              />
            )
          })}
        </div>
      )}

      {/* Close sort on outside click */}
      {showSort && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setShowSort(false)} />
      )}
    </div>
  )
}
