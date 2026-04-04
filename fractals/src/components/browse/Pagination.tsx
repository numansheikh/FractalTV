import { useState } from 'react'

interface Props {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPage: (page: number) => void
}

export function Pagination({ page, totalPages, totalItems, pageSize, onPage }: Props) {
  if (totalPages <= 1) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, totalItems)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '10px 16px',
      borderTop: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
      flexShrink: 0,
    }}>
      {/* Item count */}
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
        {from.toLocaleString()}–{to.toLocaleString()} of {totalItems.toLocaleString()}
      </span>

      {/* Page numbers */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {/* Prev */}
        <PageBtn
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          label="←"
          title="Previous page"
        />

        {buildPageList(page, totalPages).map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} style={{ padding: '0 4px', fontSize: 11, color: 'var(--color-text-muted)' }}>…</span>
          ) : (
            <PageBtn
              key={p}
              onClick={() => onPage(p as number)}
              active={p === page}
              label={String(p)}
              title={`Page ${p}`}
            />
          )
        )}

        {/* Next */}
        <PageBtn
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          label="→"
          title="Next page"
        />
      </div>

      {/* Jump to page + slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <JumpToPage page={page} totalPages={totalPages} onPage={onPage} />
        <PageSlider page={page} totalPages={totalPages} onPage={onPage} />
      </div>
    </div>
  )
}

function buildPageList(current: number, total: number): (number | '…')[] {
  if (total <= 9) return Array.from({ length: total }, (_, i) => i + 1)

  const pages: (number | '…')[] = [1]

  if (current > 4) pages.push('…')

  const lo = Math.max(2, current - 2)
  const hi = Math.min(total - 1, current + 2)
  for (let p = lo; p <= hi; p++) pages.push(p)

  if (current < total - 3) pages.push('…')
  pages.push(total)

  return pages
}

function PageBtn({ onClick, disabled, active, label, title }: {
  onClick: () => void
  disabled?: boolean
  active?: boolean
  label: string
  title: string
}) {
  const isArrow = label === '←' || label === '→'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        minWidth: isArrow ? 28 : 28,
        height: 28,
        padding: '0 4px',
        borderRadius: 6,
        border: active ? '1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)' : '1px solid transparent',
        background: active ? 'var(--color-primary-dim)' : 'transparent',
        color: active
          ? 'var(--color-primary)'
          : disabled
            ? 'var(--color-text-muted)'
            : 'var(--color-text-secondary)',
        fontSize: 11,
        fontWeight: active ? 600 : 400,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        transition: 'all 0.1s',
        fontFamily: isArrow ? 'inherit' : 'monospace',
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active) {
          e.currentTarget.style.background = 'var(--color-card)'
          e.currentTarget.style.color = 'var(--color-text-primary)'
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled && !active) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--color-text-secondary)'
        }
      }}
    >
      {label}
    </button>
  )
}

function PageSlider({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  const [dragging, setDragging] = useState(false)
  const [dragPage, setDragPage] = useState(page)

  const displayPage = dragging ? dragPage : page

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Drag to jump to any page">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
        <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
      </svg>
      <div style={{ position: 'relative' }}>
        <input
          type="range"
          min={1}
          max={totalPages}
          value={displayPage}
          onChange={(e) => {
            const v = parseInt(e.target.value)
            setDragging(true)
            setDragPage(v)
          }}
          onMouseUp={(e) => {
            const v = parseInt((e.target as HTMLInputElement).value)
            setDragging(false)
            onPage(v)
          }}
          onTouchEnd={(e) => {
            const v = parseInt((e.target as HTMLInputElement).value)
            setDragging(false)
            onPage(v)
          }}
          className="page-slider"
        />
        {dragging && (
          <div style={{
            position: 'absolute',
            bottom: '100%',
            left: `${((dragPage - 1) / (totalPages - 1)) * 100}%`,
            transform: 'translateX(-50%)',
            marginBottom: 4,
            background: 'var(--color-card)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 5,
            padding: '2px 6px',
            fontSize: 10,
            color: 'var(--color-primary)',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}>
            {dragPage.toLocaleString()}
          </div>
        )}
      </div>
    </div>
  )
}

function JumpToPage({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Go to</span>
      <input
        type="number"
        min={1}
        max={totalPages}
        defaultValue={page}
        key={page} // remount on page change to reset value
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = parseInt((e.target as HTMLInputElement).value)
            if (v >= 1 && v <= totalPages) onPage(v)
          }
        }}
        onBlur={(e) => {
          const v = parseInt(e.target.value)
          if (v >= 1 && v <= totalPages && v !== page) onPage(v)
        }}
        style={{
          width: 60,
          padding: '3px 6px',
          borderRadius: 5,
          border: '1px solid var(--color-border-strong)',
          background: 'var(--color-card)',
          color: 'var(--color-text-primary)',
          fontSize: 11,
          fontFamily: 'monospace',
          outline: 'none',
          textAlign: 'center',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.select() }}
        onBlurCapture={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
      />
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>of {totalPages.toLocaleString()}</span>
    </div>
  )
}
