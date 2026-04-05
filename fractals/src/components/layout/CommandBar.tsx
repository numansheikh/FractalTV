import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/stores/app.store'
import { useSourcesStore } from '@/stores/sources.store'
import { useSearchStore } from '@/stores/search.store'
import { buildColorMap } from '@/lib/sourceColors'
import { api } from '@/lib/api'
import { ContentType } from '@/lib/types'

const SORT_OPTIONS = [
  { label: 'Latest Added', value: 'updated:desc' },
  { label: 'Title A–Z',    value: 'title:asc' },
  { label: 'Title Z–A',    value: 'title:desc' },
  { label: 'Year (Newest)',  value: 'year:desc' },
  { label: 'Year (Oldest)',  value: 'year:asc' },
  { label: 'Top Rated',    value: 'rating:desc' },
]

interface Props {
  sort: string
  onSortChange: (v: string) => void
}

export function CommandBar({ sort, onSortChange }: Props) {
  const { query, setQuery } = useSearchStore()
  const { typeFilter, categoryFilter, setCategoryFilter, selectedSourceIds, toggleSourceFilter } = useAppStore()
  const { sources } = useSourcesStore()
  const colorMap = buildColorMap(sources.map((s) => s.id))
  const inputRef = useRef<HTMLInputElement>(null)
  const [showCategories, setShowCategories] = useState(false)
  const [showSort, setShowSort] = useState(false)
  const [catFilter, setCatFilter] = useState('')

  // Keyboard shortcut: / or Cmd+K
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

  const apiType = typeFilter === 'all' ? undefined
    : typeFilter === 'films' ? 'movie' as const
    : typeFilter as 'live' | 'movie' | 'series'

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', apiType, selectedSourceIds],
    queryFn: () => api.categories.list({ type: apiType, sourceIds: selectedSourceIds }),
    staleTime: 60_000,
  })

  const filteredCats = catFilter
    ? (categories as any[]).filter((c: any) => c.name.toLowerCase().includes(catFilter.toLowerCase()))
    : (categories as any[])

  const sortLabel = SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'Latest Added'
  const catLabel = categoryFilter ?? 'All categories'

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
    }}>
      {/* Category dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => { setShowCategories((v) => !v); setShowSort(false) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 6,
            background: showCategories ? 'var(--bg-3)' : 'var(--bg-2)',
            border: '1px solid var(--border-default)',
            color: categoryFilter ? 'var(--text-0)' : 'var(--text-2)',
            fontSize: 12, fontWeight: 500, cursor: 'pointer',
            whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 100 }}>{catLabel}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points={showCategories ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
          </svg>
        </button>
        {showCategories && (
          <CategoryPopover
            categories={filteredCats}
            filter={catFilter}
            onFilterChange={setCatFilter}
            onSelect={(cat) => { setCategoryFilter(cat); setShowCategories(false); setCatFilter('') }}
            onClear={() => { setCategoryFilter(null); setShowCategories(false); setCatFilter('') }}
            onClose={() => { setShowCategories(false); setCatFilter('') }}
          />
        )}
      </div>

      {/* Search input */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
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
            style={{
              position: 'absolute', right: 8,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-2)', display: 'flex', padding: 2,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* Sort dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => { setShowSort((v) => !v); setShowCategories(false) }}
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

      {/* Source filter dots */}
      {sources.filter((s) => !s.disabled).length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
          {sources.filter((s) => !s.disabled).map((src) => {
            const color = colorMap[src.id]?.accent ?? 'var(--text-2)'
            const isActive = selectedSourceIds.length === 0 || selectedSourceIds.includes(src.id)
            return (
              <button
                key={src.id}
                onClick={() => toggleSourceFilter(src.id)}
                title={src.name}
                style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: isActive ? color : 'transparent',
                  border: `2px solid ${color}`,
                  cursor: 'pointer', padding: 0,
                  transition: 'all 0.1s',
                  opacity: isActive ? 1 : 0.5,
                }}
              />
            )
          })}
        </div>
      )}

      {/* Close dropdowns on outside click */}
      {(showCategories || showSort) && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 90 }}
          onClick={() => { setShowCategories(false); setShowSort(false) }}
        />
      )}
    </div>
  )
}

function CategoryPopover({ categories, filter, onFilterChange, onSelect, onClear, onClose }: {
  categories: any[]
  filter: string
  onFilterChange: (v: string) => void
  onSelect: (cat: string) => void
  onClear: () => void
  onClose: () => void
}) {
  // Group by type
  const grouped = { live: [] as any[], movie: [] as any[], series: [] as any[] }
  for (const cat of categories) {
    const t = cat.type as 'live' | 'movie' | 'series'
    if (grouped[t]) grouped[t].push(cat)
  }

  const GROUP_META = [
    { key: 'live' as const, label: 'Live TV', color: 'var(--accent-live)' },
    { key: 'movie' as const, label: 'Movies', color: 'var(--accent-film)' },
    { key: 'series' as const, label: 'Series', color: 'var(--accent-series)' },
  ]

  return (
    <div style={{
      position: 'absolute', top: 'calc(100% + 4px)', left: 0,
      width: 280, maxHeight: 400,
      background: 'var(--bg-2)', border: '1px solid var(--border-default)',
      borderRadius: 10, zIndex: 100,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Filter input */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
        <input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter categories…"
          autoFocus
          style={{
            width: '100%', padding: '5px 10px', borderRadius: 6,
            background: 'var(--bg-3)', border: '1px solid var(--border-default)',
            color: 'var(--text-0)', fontSize: 12, outline: 'none',
          }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* All option */}
        <button
          onClick={onClear}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', padding: '8px 14px', border: 'none', cursor: 'pointer',
            background: 'transparent', fontSize: 12, color: 'var(--text-1)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <span style={{ fontWeight: 500, color: 'var(--text-0)' }}>All categories</span>
        </button>

        {GROUP_META.map(({ key, label, color }) => {
          const cats = grouped[key]
          if (!cats.length) return null
          return (
            <div key={key}>
              <div style={{
                padding: '6px 14px 4px',
                fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                color: 'var(--text-2)',
                borderLeft: `3px solid ${color}`,
                marginLeft: 0,
              }}>
                {label}
              </div>
              {cats.map((cat: any) => (
                <button
                  key={cat.name}
                  onClick={() => onSelect(cat.name)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '6px 14px', border: 'none', cursor: 'pointer',
                    background: 'transparent', fontSize: 12, color: 'var(--text-1)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                    {cat.name}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flexShrink: 0 }}>
                    {cat.item_count?.toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
