import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '@/stores/app.store'
import { useSourcesStore } from '@/stores/sources.store'
import { useSearchStore } from '@/stores/search.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'

const ADV_AMBER = '#f59e0b'

function CmdSearchInput({ query, setQuery, inputRef }: {
  query: string
  setQuery: (v: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const [focused, setFocused] = useState(false)
  const isAdvanced = query.startsWith('@')
  const visibleValue = isAdvanced ? query.slice(1) : query

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (isAdvanced) {
      setQuery(v === '' ? '' : '@' + v)
    } else {
      setQuery(v)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && isAdvanced && visibleValue === '') {
      e.preventDefault()
      setQuery('')
    }
  }

  const toggleAdvanced = useCallback(() => {
    setQuery(isAdvanced ? visibleValue : '@' + visibleValue)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [isAdvanced, visibleValue, setQuery, inputRef])

  const borderColor = focused ? 'var(--accent-interactive)' : 'var(--border-strong)'

  // Left padding: search icon + ADV @ chip (always reserved)
  const LEFT_PAD = 92

  return (
    <div style={{ flex: 1, position: 'relative', height: 30, minWidth: 0 }}>
      {/* Search icon */}
      <svg
        width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round"
        style={{
          position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-2)', pointerEvents: 'none',
        }}
      >
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>

      {/* ADV @ chip — inside the input, left side */}
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggleAdvanced}
        title={isAdvanced ? 'Advanced mode on — click to disable' : 'Enable advanced search (@)'}
        style={{
          position: 'absolute', left: 28, top: '50%', transform: 'translateY(-50%)',
          height: 20, padding: '0 7px',
          display: 'flex', alignItems: 'center', gap: 4,
          borderRadius: 4,
          border: `1px solid ${isAdvanced ? ADV_AMBER : 'var(--border-strong)'}`,
          background: isAdvanced ? ADV_AMBER : 'transparent',
          color: isAdvanced ? '#1a1305' : 'var(--text-3)',
          fontSize: 9, fontWeight: 800, fontFamily: 'var(--font-mono)',
          letterSpacing: '0.06em', cursor: 'pointer', userSelect: 'none',
          boxShadow: isAdvanced ? `0 0 0 2px color-mix(in srgb, ${ADV_AMBER} 20%, transparent)` : 'none',
          transition: 'color 0.12s, border-color 0.12s, background 0.12s, box-shadow 0.12s',
        }}
        onMouseEnter={(e) => {
          if (!isAdvanced) {
            e.currentTarget.style.color = ADV_AMBER
            e.currentTarget.style.borderColor = ADV_AMBER
          }
        }}
        onMouseLeave={(e) => {
          if (!isAdvanced) {
            e.currentTarget.style.color = 'var(--text-3)'
            e.currentTarget.style.borderColor = 'var(--border-strong)'
          }
        }}
      >
        ADV
        <span style={{ fontSize: 11, lineHeight: 1, fontWeight: 700 }}>@</span>
      </button>

      {/* Unified input */}
      <input
        ref={inputRef}
        value={visibleValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={isAdvanced ? 'fr matrix 1999…' : 'Search…'}
        style={{
          width: '100%', height: '100%',
          background: 'var(--bg-2)',
          border: `1px solid ${borderColor}`,
          borderRadius: 7,
          color: 'var(--text-0)', fontSize: 13,
          paddingLeft: LEFT_PAD,
          paddingRight: 32,
          outline: 'none',
          transition: 'border-color 0.12s, padding-left 0.12s',
          fontFamily: 'var(--font-ui)',
          boxSizing: 'border-box',
        }}
      />

      {/* / keyboard hint — fades when focused or has value */}
      <div
        aria-hidden
        style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          opacity: focused || visibleValue ? 0 : 1,
          transition: 'opacity 0.12s',
          pointerEvents: 'none',
        }}
      >
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
          color: 'var(--text-3)',
          background: 'var(--bg-3)',
          border: '1px solid var(--border-strong)',
          borderRadius: 3,
          padding: '1px 5px',
          boxShadow: 'inset 0 -1px 0 var(--border-strong)',
        }}>
          /
        </span>
      </div>

      {/* Clear button — appears when there's a value */}
      {visibleValue && (
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setQuery(''); inputRef.current?.focus() }}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-3)', display: 'flex', alignItems: 'center', padding: 2,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-1)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      )}
    </div>
  )
}

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
  const { queries, setQuery } = useSearchStore()
  const { selectedSourceIds, toggleSourceFilter, activeView, viewMode, setViewMode } = useAppStore()
  const query = queries[activeView] ?? ''
  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)
  const inputRef = useRef<HTMLInputElement>(null)
  const [showSort, setShowSort] = useState(false)

  const isHome = activeView === 'home'
  // Home has its own search bar in the hero area
  const showSearch = !isHome
  const showSortBtn = !isHome || !!query
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
      {/* Search input — hidden on home (home has its own hero search) */}
      {showSearch && (
        <CmdSearchInput query={query} setQuery={setQuery} inputRef={inputRef} />
      )}

      {/* Spacer on home so dots stay right-aligned */}
      {isHome && <div style={{ flex: 1 }} />}

      {/* Sort dropdown */}
      {showSortBtn && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowSort((v) => !v)}
            title={`Sort: ${sortLabel}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '0 9px', height: 28, borderRadius: 6,
              background: showSort ? 'var(--bg-3)' : 'var(--bg-2)',
              border: '1px solid var(--border-default)',
              color: sort !== 'updated:desc' ? 'var(--accent-interactive)' : 'var(--text-2)',
              fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
              fontFamily: 'var(--font-ui)',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="15" y2="12"/>
              <line x1="3" y1="18" x2="9" y2="18"/>
            </svg>
            <span style={{ color: 'var(--text-1)' }}>{sortLabel}</span>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ color: 'var(--text-3)' }}>
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

      {/* Group / grid / list view toggle — live TV only */}
      {showViewToggle && (
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-default)', flexShrink: 0 }}>
          {(['group', 'grid', 'list'] as const).map((mode, i) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              title={mode === 'group' ? 'Group view' : mode === 'grid' ? 'Grid view' : 'List view'}
              style={{
                width: 28, height: 28,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: viewMode === mode ? 'var(--accent-interactive-dim)' : 'var(--bg-2)',
                border: 'none',
                borderLeft: i > 0 ? '1px solid var(--border-default)' : 'none',
                cursor: 'pointer',
                color: viewMode === mode ? 'var(--accent-interactive)' : 'var(--text-2)',
                transition: 'background 0.1s, color 0.1s',
              }}
            >
              {mode === 'group' ? (
                // Rows with left label block (group view icon)
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="4" height="16" rx="1"/>
                  <line x1="10" y1="7" x2="21" y2="7"/>
                  <line x1="10" y1="12" x2="21" y2="12"/>
                  <line x1="10" y1="17" x2="21" y2="17"/>
                </svg>
              ) : mode === 'grid' ? (
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
                  width: 12, height: 12, borderRadius: '50%',
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
