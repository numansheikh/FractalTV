import { useEffect, useState } from 'react'

/**
 * Returns `false` on first render, then `true` once the browser reports an idle
 * tick (or after the given fallback timeout). Use it as the `enabled` flag on
 * below-the-fold React Query hooks so cold start paints above-the-fold content
 * before spending IPC time on the rest.
 */
export function useIdleMount(fallbackMs = 400): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (ready) return
    const ric = (globalThis as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined
    const cic = (globalThis as any).cancelIdleCallback as
      | ((id: number) => void)
      | undefined
    if (ric) {
      const id = ric(() => setReady(true), { timeout: fallbackMs })
      return () => { if (cic) cic(id) }
    }
    const t = setTimeout(() => setReady(true), fallbackMs)
    return () => clearTimeout(t)
  }, [ready, fallbackMs])
  return ready
}
