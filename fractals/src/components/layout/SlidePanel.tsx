import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  open: boolean
  onClose: () => void
  width?: number
  children: React.ReactNode
  /** When true, the Escape handler is suppressed (player is on top, panel should not close) */
  suppressClose?: boolean
}

export function SlidePanel({ open, onClose, width = 420, children, suppressClose = false }: Props) {
  // Capture-phase Escape handler
  useEffect(() => {
    if (!open || suppressClose) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, onClose, suppressClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="panel"
          role="dialog"
          aria-modal="true"
          initial={{ x: width }}
          animate={{ x: 0 }}
          exit={{ x: width }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          style={{
            position: 'fixed',
            top: 0, right: 0, bottom: 0,
            width,
            background: 'var(--bg-2)',
            boxShadow: 'var(--panel-shadow)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            // Scope bg tokens so all children inherit the tinted panel surface
            ['--bg-2' as string]: 'var(--bg-panel)',
            ['--bg-1' as string]: 'var(--bg-panel-sub)',
          } as React.CSSProperties}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
