import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  open: boolean
  onClose: () => void
  width?: number
  children: React.ReactNode
  /** When true, the scrim and Escape handler are suppressed (player is on top) */
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
        <>
          {/* Scrim */}
          {!suppressClose && (
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={onClose}
              style={{
                position: 'fixed', inset: 0,
                background: 'rgba(0,0,0,0.55)',
                zIndex: 40,
              }}
            />
          )}
          {/* Panel */}
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
              background: 'var(--bg-1)',
              borderLeft: '1px solid var(--border-default)',
              zIndex: 50,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
