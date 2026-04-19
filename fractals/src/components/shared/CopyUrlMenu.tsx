import { useEffect, useState, useCallback, MouseEvent, ReactNode } from 'react'
import { copyStreamUrl } from '@/lib/stream-url'

type CopyItem = Parameters<typeof copyStreamUrl>[0]

export function CopyUrlContext({
  item,
  children,
  onBefore,
}: {
  item: CopyItem | null | undefined
  children: ReactNode
  onBefore?: () => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [flash, setFlash] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')

  const handleContextMenu = useCallback((e: MouseEvent) => {
    if (!item) return
    e.preventDefault()
    e.stopPropagation()
    onBefore?.()
    setMenu({ x: e.clientX, y: e.clientY })
  }, [item, onBefore])

  const handleCopy = useCallback(async () => {
    if (!item) { setMenu(null); return }
    setFlash('copying')
    const ok = await copyStreamUrl(item)
    setFlash(ok ? 'copied' : 'failed')
    setMenu(null)
    setTimeout(() => setFlash('idle'), 1800)
  }, [item])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setMenu(null) } }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const posX = menu ? Math.min(menu.x, window.innerWidth - 180 - 8) : 0
  const posY = menu ? Math.min(menu.y, window.innerHeight - 40 - 8) : 0

  return (
    <div onContextMenu={handleContextMenu} style={{ display: 'contents' }}>
      {children}
      {menu && (
        <div
          style={{
            position: 'fixed', left: posX, top: posY, width: 180, zIndex: 210,
            background: 'var(--bg-2)', border: '1px solid var(--border-strong)', borderRadius: 8,
            boxShadow: '0 8px 30px rgba(0,0,0,0.35)', padding: '4px 0',
            fontFamily: 'var(--font-ui)', fontSize: 12,
            backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleCopy}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 12px', background: 'transparent', border: 'none',
              color: 'var(--text-1)', fontSize: 12, cursor: 'pointer', textAlign: 'left',
              fontFamily: 'var(--font-ui)',
            }}
          >
            <span style={{ display: 'inline-block', width: 14, textAlign: 'center' }}>⧉</span>
            Copy stream URL
          </button>
        </div>
      )}
      {flash !== 'idle' && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 220, padding: '8px 16px', borderRadius: 8, fontSize: 12,
          background: flash === 'failed' ? 'rgba(248,113,113,0.9)' : 'var(--bg-3)',
          color: flash === 'failed' ? '#fff' : 'var(--text-0)',
          border: '1px solid var(--border-strong)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          fontFamily: 'var(--font-ui)', pointerEvents: 'none',
        }}>
          {flash === 'copying' ? 'Copying…' : flash === 'copied' ? '✓ Stream URL copied' : 'Copy failed'}
        </div>
      )}
    </div>
  )
}
