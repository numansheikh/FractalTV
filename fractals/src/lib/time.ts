import { useAppStore } from '@/stores/app.store'

export function fmtTime(unix: number): string {
  const tz = useAppStore.getState().timezone
  const d = new Date(unix * 1000)
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
  if (tz) opts.timeZone = tz
  return d.toLocaleTimeString([], opts)
}
