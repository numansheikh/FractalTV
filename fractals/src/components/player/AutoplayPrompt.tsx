import { api } from '@/lib/api'

interface Props {
  onDone: (autoplayEnabled: boolean) => void
}

export function AutoplayPrompt({ onDone }: Props) {
  const save = async (autoplay: boolean, dontAsk: boolean) => {
    await api.settings.set('autoplay_prompt_shown', '1')
    await api.settings.set('autoplay_detail', autoplay ? '1' : '0')
    if (dontAsk) {
      await api.settings.set('autoplay_prompt_shown', '1')
    }
    onDone(autoplay)
  }

  const btnBase: React.CSSProperties = {
    padding: '4px 10px',
    borderRadius: 5,
    border: 'none',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'var(--font-ui)',
    transition: 'opacity 0.12s',
    lineHeight: '18px',
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.78)',
        backdropFilter: 'blur(4px)',
        gap: 10,
        padding: '0 16px',
      }}
    >
      <p style={{
        margin: 0,
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-0)',
        fontFamily: 'var(--font-ui)',
        textAlign: 'center',
        lineHeight: 1.4,
      }}>
        Auto-start video when opening details?
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          style={{ ...btnBase, background: 'var(--accent-interactive)', color: '#fff' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
          onClick={() => save(true, true)}
        >
          Yes — always
        </button>
        <button
          style={{ ...btnBase, background: 'var(--bg-3)', color: 'var(--text-1)' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.75' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
          onClick={() => save(false, false)}
        >
          No
        </button>
        <button
          style={{ ...btnBase, background: 'var(--bg-3)', color: 'var(--text-2)' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.75' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
          onClick={() => save(false, true)}
        >
          Don't ask again
        </button>
      </div>

      <p style={{
        margin: 0,
        fontSize: 10,
        color: 'var(--text-3)',
        fontFamily: 'var(--font-ui)',
        textAlign: 'center',
      }}>
        · Change in Settings
      </p>
    </div>
  )
}
