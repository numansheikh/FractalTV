import { useAppStore } from '@/stores/app.store'

export function FilterBar({ itemCount }: { itemCount?: number }) {
  const { typeFilter, categoryFilters, activeView, selectedSourceIds, setTypeFilter, setCategoryFilter, clearSourceFilter } = useAppStore()
  const categoryFilter = categoryFilters[activeView] ?? null

  // '__favorites__' is the default state — not a user-applied filter, never shown as a chip
  const activeCategory = categoryFilter && categoryFilter !== '__favorites__' ? categoryFilter : null
  const hasFilters = typeFilter !== 'all' || !!activeCategory || selectedSourceIds.length > 0
  if (!hasFilters && itemCount === undefined) return null

  const TYPE_COLOR: Record<string, string> = {
    live: 'var(--accent-live)',
    movie: 'var(--accent-film)',
    series: 'var(--accent-series)',
  }

  return (
    <div style={{
      height: 36,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '0 16px',
      borderBottom: '1px solid var(--border-subtle)',
      flexShrink: 0,
    }}>
      {typeFilter !== 'all' && (
        <FilterPill
          label={typeFilter === 'live' ? 'Channels' : typeFilter === 'movie' ? 'Films' : 'Series'}
          color={TYPE_COLOR[typeFilter]}
          onRemove={() => setTypeFilter('all')}
        />
      )}
      {activeCategory && (
        <FilterPill
          label={activeCategory}
          color="var(--text-1)"
          onRemove={() => setCategoryFilter(null)}
        />
      )}
      {selectedSourceIds.length > 0 && (
        <FilterPill
          label={`${selectedSourceIds.length} source${selectedSourceIds.length > 1 ? 's' : ''}`}
          color="var(--accent-interactive)"
          onRemove={clearSourceFilter}
        />
      )}
      {itemCount !== undefined && (
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
          {itemCount.toLocaleString()} items
        </span>
      )}
    </div>
  )
}

function FilterPill({ label, color, onRemove }: { label: string; color: string; onRemove: () => void }) {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px 2px 10px',
      borderRadius: 4,
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      fontSize: 11,
      fontWeight: 500,
      color,
      cursor: 'default',
    }}>
      {label}
      <button
        onClick={onRemove}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, borderRadius: 2,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'inherit', opacity: 0.7, padding: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7' }}
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  )
}
