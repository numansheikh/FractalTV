import { ReactNode } from 'react'
import { Source } from '@/stores/sources.store'
import { SourceColor } from '@/lib/sourceColors'

export interface TypeBadge {
  label: string
  accent: string
}

export interface BreadcrumbItem {
  label: string
  color: string
  onClick: () => void
  bold?: boolean
}

interface Props {
  typeBadge: TypeBadge
  breadcrumbs: BreadcrumbItem[]
  actionsRow?: ReactNode
  primarySource?: Source
  primarySourceColor?: SourceColor
  allSourceIds?: string[]
  sourceColorMap?: Record<string, SourceColor>
  onClose: () => void
  children: ReactNode
  castPanel?: ReactNode
  footer?: ReactNode
}

export function DetailShell({
  typeBadge,
  breadcrumbs,
  actionsRow,
  primarySource,
  primarySourceColor,
  allSourceIds,
  sourceColorMap,
  onClose,
  children,
  castPanel,
  footer,
}: Props) {
  const hasMultiSource = (allSourceIds?.length ?? 0) > 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{
        height: 44,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'transparent', border: 'none',
            color: 'var(--text-2)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, lineHeight: 1,
            transition: 'color 0.12s', flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-0)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-2)' }}
        >
          ✕
        </button>

        <span style={{
          fontSize: 11, fontWeight: 600,
          color: typeBadge.accent,
          background: `color-mix(in srgb, ${typeBadge.accent} 15%, transparent)`,
          borderRadius: 4, padding: '2px 7px',
          fontFamily: 'var(--font-ui)', letterSpacing: '0.04em',
        }}>
          {typeBadge.label}
        </span>

        <div style={{ flex: 1 }} />

        {!hasMultiSource && primarySource && primarySourceColor && (
          <span style={{
            fontSize: 11, fontWeight: 500,
            color: primarySourceColor.accent,
            background: primarySourceColor.dim,
            borderRadius: 4, padding: '2px 7px',
            fontFamily: 'var(--font-ui)',
            maxWidth: 120,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {primarySource.name}
          </span>
        )}
        {hasMultiSource && allSourceIds && sourceColorMap && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {allSourceIds.slice(0, 4).map((sid, i) => {
              const sc = sourceColorMap[sid]
              return (
                <div key={sid ?? i} style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: sc?.accent ?? 'var(--text-3)',
                  flexShrink: 0,
                }} />
              )
            })}
            {allSourceIds.length > 4 && (
              <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-ui)' }}>
                +{allSourceIds.length - 4}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 16,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {children}
      </div>

      {/* Cast panel — fixed strip above footer, vertically scrollable */}
      {castPanel && (
        <div style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
          maxHeight: 132,
          overflowY: 'auto',
          padding: '10px 12px',
          background: 'var(--bg-1)',
          boxShadow: 'inset 0 3px 10px rgba(0,0,0,0.2)',
        }}>
          {castPanel}
        </div>
      )}

      {/* Sticky footer — [breadcrumbs · actionsRow] + other footer content */}
      {(footer || breadcrumbs.length > 0 || actionsRow) && (
        <div style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border-subtle)',
          padding: '8px 12px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: 'var(--bg-2)',
        }}>
          {(breadcrumbs.length > 0 || actionsRow) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              paddingBottom: 6,
              borderBottom: '1px solid var(--border-subtle)',
            }}>
              {breadcrumbs.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                  {breadcrumbs.map((b, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {i > 0 && (
                        <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2.5" strokeLinecap="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      )}
                      <span
                        onClick={b.onClick}
                        style={{
                          fontSize: b.bold ? 11 : 10,
                          fontWeight: b.bold ? 600 : 400,
                          color: b.color,
                          cursor: 'pointer',
                          fontFamily: 'var(--font-ui)',
                          transition: 'opacity 0.12s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.65'; e.currentTarget.style.textDecoration = 'underline' }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.textDecoration = 'none' }}
                      >
                        {b.label}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {actionsRow}
            </div>
          )}
          {footer}
        </div>
      )}
    </div>
  )
}
