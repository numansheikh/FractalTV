import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/stores/app.store'
import { useSourcesStore } from '@/stores/sources.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { api } from '@/lib/api'
import { ActiveView } from '@/lib/types'

const TYPE_MAP: Partial<Record<ActiveView, 'live' | 'movie' | 'series'>> = {
  live: 'live',
  films: 'movie',
  series: 'series',
}

const ACCENT_MAP: Partial<Record<ActiveView, string>> = {
  live: 'var(--accent-live)',
  films: 'var(--accent-film)',
  series: 'var(--accent-series)',
}

type SortMode = 'count' | 'az' | 'za'

export function BrowseSidebar() {
  const { activeView, categoryFilter, setCategoryFilter, selectedSourceIds } = useAppStore()
  const { sources } = useSourcesStore()
  const type = TYPE_MAP[activeView]
  const accent = ACCENT_MAP[activeView] ?? 'var(--accent-interactive)'
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortMode>('count')
  const [showSort, setShowSort] = useState(false)

  const colorMap = buildColorMapFromSources(sources)
  const showSourceBar = sources.filter((s) => !s.disabled).length > 1

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', type, selectedSourceIds],
    queryFn: () => api.categories.list({ type, sourceIds: selectedSourceIds }),
    staleTime: 60_000,
    enabled: !!type,
  })

  const cats = categories as any[]

  const sorted = useMemo(() => {
    let list = filter
      ? cats.filter((c: any) => c.name.toLowerCase().includes(filter.toLowerCase()))
      : cats
    if (sort === 'az') list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'za') list = [...list].sort((a, b) => b.name.localeCompare(a.name))
    return list
  }, [cats, filter, sort])

  const totalCount = cats.reduce((s: number, c: any) => s + (c.item_count ?? 0), 0)

  // Scroll active category into view when categoryFilter is set externally (e.g. from category chip)
  const activeItemRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (categoryFilter && categoryFilter !== '__favorites__') {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        activeItemRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }))
    }
  }, [categoryFilter])

  if (!type) return null

  return (
    <div style={{
      width: 168,
      flexShrink: 0,
      borderRight: '1px solid var(--border-strong)',
      background: 'var(--bg-1)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Filter + sort row */}
      <div style={{
        padding: '6px 8px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        flexShrink: 0,
      }}>
        {/* Filter input */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2.5"
            strokeLinecap="round" style={{ position: 'absolute', left: 6, pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            style={{
              width: '100%', height: 24,
              padding: '0 6px 0 22px',
              borderRadius: 5,
              background: 'var(--bg-3)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-0)',
              fontSize: 11,
              outline: 'none',
            }}
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              style={{ position: 'absolute', right: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 1, display: 'flex' }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        {/* Sort button */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowSort((v) => !v)}
            title="Sort categories"
            style={{
              height: 24, width: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 5,
              background: showSort ? 'var(--bg-3)' : 'transparent',
              border: '1px solid var(--border-default)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="15" y2="12"/>
              <line x1="3" y1="18" x2="9" y2="18"/>
            </svg>
          </button>
          {showSort && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setShowSort(false)} />
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                background: 'var(--bg-2)', border: '1px solid var(--border-default)',
                borderRadius: 7, padding: 3, zIndex: 100, minWidth: 110,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                {(['count', 'az', 'za'] as SortMode[]).map((s) => {
                  const label = s === 'count' ? '# Count' : s === 'az' ? 'A–Z' : 'Z–A'
                  return (
                    <button
                      key={s}
                      onClick={() => { setSort(s); setShowSort(false) }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '6px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                        fontSize: 11,
                        color: sort === s ? accent : 'var(--text-1)',
                        background: sort === s ? `color-mix(in srgb, ${accent} 10%, transparent)` : 'transparent',
                        fontWeight: sort === s ? 600 : 400,
                      }}
                      onMouseEnter={(e) => { if (sort !== s) e.currentTarget.style.background = 'var(--bg-3)' }}
                      onMouseLeave={(e) => { if (sort !== s) e.currentTarget.style.background = 'transparent' }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Pinned items — always visible, not part of scroll */}
      {!filter && (
        <div style={{ flexShrink: 0 }}>
          <SidebarItem
            label={`All ${activeView === 'films' ? 'Movies' : activeView === 'series' ? 'Series' : 'Channels'}`}
            count={totalCount}
            active={categoryFilter === null}
            accent={accent}
            sourceColor={undefined}
            onClick={() => setCategoryFilter(null)}
          />
          <SidebarItem
            label="Favorites"
            active={categoryFilter === '__favorites__'}
            accent={accent}
            sourceColor={undefined}
            icon={
              <svg width="10" height="10" viewBox="0 0 24 24"
                fill={categoryFilter === '__favorites__' ? 'currentColor' : 'none'}
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
            }
            onClick={() => setCategoryFilter('__favorites__')}
          />
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '2px 0' }} />
        </div>
      )}

      {/* Scrollable category list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.map((cat: any) => {
          // source_ids is a comma-separated string from GROUP_CONCAT
          const primarySrcId = cat.source_ids?.split(',')[0]
          const srcColor = showSourceBar && primarySrcId ? colorMap[primarySrcId]?.accent : undefined
          return (
            <SidebarItem
              key={cat.name}
              label={cat.name}
              count={cat.item_count}
              active={categoryFilter === cat.name}
              accent={accent}
              sourceColor={srcColor}
              onClick={() => setCategoryFilter(cat.name)}
              buttonRef={categoryFilter === cat.name ? activeItemRef : undefined}
            />
          )
        })}

        {filter && sorted.length === 0 && (
          <div style={{ padding: '12px 12px', fontSize: 11, color: 'var(--text-3)' }}>No match</div>
        )}
      </div>
    </div>
  )
}

function SidebarItem({ label, count, active, accent, sourceColor, icon, onClick, buttonRef }: {
  label: string; count?: number; active: boolean; accent: string
  sourceColor?: string; icon?: React.ReactNode; onClick: () => void
  buttonRef?: React.RefObject<HTMLButtonElement | null>
}) {
  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left',
        padding: '6px 10px 6px 14px',
        background: active ? `color-mix(in srgb, ${accent} 10%, transparent)` : 'transparent',
        border: 'none',
        borderRight: active ? `2px solid ${accent}` : '2px solid transparent',
        color: active ? accent : 'var(--text-1)',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        position: 'relative',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-3)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {/* Left source color bar */}
      {sourceColor && (
        <div style={{
          position: 'absolute',
          left: 0, top: 4, bottom: 4,
          width: 3,
          borderRadius: 2,
          background: sourceColor,
          flexShrink: 0,
        }} />
      )}
      {/* Optional icon */}
      {icon && (
        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {icon}
        </span>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{label}</span>
      {count != null && (
        <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  )
}
