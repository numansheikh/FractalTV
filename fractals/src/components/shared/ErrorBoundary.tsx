import { Component, ErrorInfo, ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', gap: 16, padding: 32, background: 'var(--color-bg)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-error)' }}>
          Render error
        </div>
        <pre style={{
          fontSize: 11, color: 'var(--color-text-secondary)', fontFamily: 'monospace',
          background: 'var(--color-card)', padding: '12px 16px', borderRadius: 8,
          maxWidth: 600, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap',
          border: '1px solid var(--color-border)',
        }}>
          {error.message}
          {'\n\n'}
          {error.stack?.split('\n').slice(1, 6).join('\n')}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            padding: '6px 18px', borderRadius: 7, border: 'none', fontSize: 12,
            background: 'var(--color-primary)', color: '#fff', cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    )
  }
}
