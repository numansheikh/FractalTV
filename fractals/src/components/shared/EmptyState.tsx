interface Props {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  hint?: string
  children?: React.ReactNode
}

export function EmptyState({ icon, title, description, action, hint, children }: Props) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 48,
      textAlign: 'center',
    }}>
      {icon && (
        <div style={{ opacity: 0.3, color: 'var(--text-2)', marginBottom: 4 }}>{icon}</div>
      )}
      <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)', margin: 0 }}>{title}</p>
      {description && (
        <p style={{ fontSize: 13, color: 'var(--text-1)', margin: 0, maxWidth: 320 }}>{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 4,
            padding: '8px 20px',
            borderRadius: 6,
            background: 'var(--accent-interactive)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            transition: 'opacity 0.1s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          {action.label}
        </button>
      )}
      {children}
      {hint && (
        <p style={{ fontSize: 10, color: 'var(--text-3)', margin: 0 }}>{hint}</p>
      )}
    </div>
  )
}
