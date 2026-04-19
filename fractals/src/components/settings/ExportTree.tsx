import { useState, useCallback, useMemo } from 'react'
import {
  type TreeNode,
  type Selection,
  type CheckState,
  computeState,
  toggleNode,
} from '@/lib/export-selection'

interface Props {
  nodes: TreeNode[]
  selection: Selection
  onChange: (next: Selection) => void
}

export function ExportTree({ nodes, selection, onChange }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(nodes.map((n) => n.id)))

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div
      role="tree"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: 8,
        background: 'var(--bg-1)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        maxHeight: 420,
        overflowY: 'auto',
      }}
    >
      {nodes.map((n) => (
        <Node
          key={n.id}
          node={n}
          depth={0}
          selection={selection}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
          onSelectionChange={onChange}
        />
      ))}
    </div>
  )
}

function Node({
  node,
  depth,
  selection,
  expanded,
  onToggleExpanded,
  onSelectionChange,
}: {
  node: TreeNode
  depth: number
  selection: Selection
  expanded: Set<string>
  onToggleExpanded: (id: string) => void
  onSelectionChange: (next: Selection) => void
}) {
  const state = useMemo(() => computeState(node, selection), [node, selection])
  const hasChildren = !!node.children && node.children.length > 0
  const isOpen = expanded.has(node.id)

  const onCheck = () => {
    onSelectionChange(toggleNode(node, selection))
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault()
      onCheck()
    } else if (e.key === 'ArrowRight') {
      if (hasChildren && !isOpen) {
        e.preventDefault()
        onToggleExpanded(node.id)
      }
    } else if (e.key === 'ArrowLeft') {
      if (hasChildren && isOpen) {
        e.preventDefault()
        onToggleExpanded(node.id)
      }
    } else if (e.key === 'Enter') {
      if (hasChildren) {
        e.preventDefault()
        onToggleExpanded(node.id)
      }
    }
  }

  return (
    <div role="treeitem" aria-expanded={hasChildren ? isOpen : undefined}>
      <div
        tabIndex={0}
        onKeyDown={onKey}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 6px',
          paddingLeft: 6 + depth * 18,
          borderRadius: 4,
          cursor: 'pointer',
          outline: 'none',
        }}
        onFocus={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-2)' }}
        onBlur={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-2)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      >
        <button
          type="button"
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggleExpanded(node.id) }}
          style={{
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-2)',
            cursor: hasChildren ? 'pointer' : 'default',
            padding: 0,
            fontSize: 10,
            visibility: hasChildren ? 'visible' : 'hidden',
          }}
        >
          {isOpen ? '▼' : '▶'}
        </button>
        <TriStateBox state={state} onClick={(e) => { e.stopPropagation(); onCheck() }} />
        <span
          onClick={() => { if (hasChildren) onToggleExpanded(node.id); else onCheck() }}
          style={{
            fontSize: 12,
            color: 'var(--text-0)',
            flex: 1,
            userSelect: 'none',
          }}
        >
          {node.label}
        </span>
        {typeof node.count === 'number' && (
          <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
            {node.count.toLocaleString()}
          </span>
        )}
      </div>
      {hasChildren && isOpen && (
        <div>
          {node.children!.map((c) => (
            <Node
              key={c.id}
              node={c}
              depth={depth + 1}
              selection={selection}
              expanded={expanded}
              onToggleExpanded={onToggleExpanded}
              onSelectionChange={onSelectionChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TriStateBox({ state, onClick }: { state: CheckState; onClick: (e: React.MouseEvent) => void }) {
  const filled = state !== 'unchecked'
  return (
    <span
      role="checkbox"
      aria-checked={state === 'partial' ? 'mixed' : state === 'checked'}
      onClick={onClick}
      style={{
        width: 14,
        height: 14,
        borderRadius: 3,
        border: `1px solid ${filled ? 'var(--accent-interactive)' : 'var(--border-default)'}`,
        background: filled ? 'var(--accent-interactive)' : 'transparent',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {state === 'checked' && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === 'partial' && (
        <span style={{ width: 7, height: 2, background: '#fff', borderRadius: 1 }} />
      )}
    </span>
  )
}
