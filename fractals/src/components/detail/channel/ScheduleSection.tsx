import { fmtTime } from '@/lib/time'

export interface EpgProg {
  id: string
  title: string
  description?: string
  startTime: number
  endTime: number
  category?: string
}

export function ScheduleSection({ programmes, hideHeader }: { programmes: EpgProg[]; hideHeader?: boolean }) {
  const nowSec = Math.floor(Date.now() / 1000)
  const sorted = [...programmes].sort((a, b) => a.startTime - b.startTime)
  const current = sorted.find((p) => p.startTime <= nowSec && p.endTime > nowSec) ?? null
  const past = sorted.filter((p) => p.endTime <= nowSec).slice(-3)
  const upcoming = sorted.filter((p) => p.startTime > nowSec).slice(0, 10)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {!hideHeader && (
        <p style={{
          fontSize: 10, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          color: 'var(--text-3)',
          margin: 0, fontFamily: 'var(--font-ui)',
        }}>
          Schedule
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {past.map((p) => <ProgRow key={p.id} prog={p} state="past" />)}
        {current && <ProgRow key={current.id} prog={current} state="now" nowSec={nowSec} />}
        {upcoming.map((p) => <ProgRow key={p.id} prog={p} state="upcoming" />)}
      </div>
    </div>
  )
}

function ProgRow({ prog, state, nowSec }: { prog: EpgProg; state: 'past' | 'now' | 'upcoming'; nowSec?: number }) {
  const isNow = state === 'now'
  const isPast = state === 'past'
  const progress = isNow && nowSec
    ? Math.max(0, Math.min(100, ((nowSec - prog.startTime) / (prog.endTime - prog.startTime)) * 100))
    : 0

  return (
    <div style={{
      position: 'relative',
      padding: '6px 8px',
      borderRadius: 4,
      marginBottom: 2,
      background: isNow ? 'color-mix(in srgb, var(--accent-live) 12%, transparent)' : 'transparent',
      borderLeft: isNow ? `2px solid var(--accent-live)` : '2px solid transparent',
      opacity: isPast ? 0.5 : 1,
    }}>
      {isNow && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0,
          width: `${progress}%`, height: 2,
          background: 'var(--accent-live)',
          borderRadius: 1,
          opacity: 0.6,
        }} />
      )}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        marginBottom: prog.description ? 2 : 0,
      }}>
        <span style={{
          fontSize: 10,
          color: isNow ? 'var(--accent-live)' : 'var(--text-3)',
          fontFamily: 'var(--font-mono)',
          fontWeight: isNow ? 600 : 400,
          flexShrink: 0, minWidth: 44,
        }}>
          {fmtTime(prog.startTime)}
        </span>
        <span style={{
          fontSize: 12,
          fontWeight: isNow ? 600 : 500,
          color: isNow ? 'var(--text-0)' : 'var(--text-1)',
          fontFamily: 'var(--font-ui)',
          lineHeight: 1.3, wordBreak: 'break-word',
        }}>
          {prog.title}
        </span>
      </div>
      {isNow && prog.description && (
        <p style={{
          fontSize: 11,
          color: 'var(--text-2)',
          margin: '2px 0 0 52px',
          lineHeight: 1.4,
          fontFamily: 'var(--font-ui)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {prog.description}
        </p>
      )}
    </div>
  )
}
