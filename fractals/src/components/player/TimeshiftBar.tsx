import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '@/lib/api'

interface Programme {
  id: string
  title: string
  startTime: number  // unix seconds
  endTime: number
  description?: string
}

interface Props {
  contentId: string
  catchupDays: number
  onPlayCatchup: (url: string, prog: Programme) => void
  onGoLive: () => void
  isTimeshift: boolean
  currentProg?: Programme | null
}

const HOUR_PX = 200
const BAR_HEIGHT = 52

const fmtTime = (unix: number) => {
  const d = new Date(unix * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function TimeshiftBar({ contentId, catchupDays, onPlayCatchup, onGoLive, isTimeshift, currentProg }: Props) {
  const [programmes, setProgrammes] = useState<Programme[]>([])
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nowMarkerRef = useRef<HTMLDivElement>(null)
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000))

  // Window: catchup_days back to 2h ahead
  const windowEnd = nowSec + 2 * 3600
  const windowStart = nowSec - Math.min(catchupDays, 3) * 24 * 3600  // cap at 3 days for perf

  const timeToX = (t: number) => ((t - windowStart) / 3600) * HOUR_PX
  const totalWidth = timeToX(windowEnd)

  // Fetch EPG data
  useEffect(() => {
    setLoading(true)
    api.epg.guide({
      contentIds: [contentId],
      startTime: windowStart,
      endTime: windowEnd,
    }).then((data: any) => {
      const progs = data?.programmes?.[contentId] ?? Object.values(data?.programmes ?? {})[0] ?? []
      setProgrammes(progs)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [contentId])

  // Update now every 30s
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000)
    return () => clearInterval(t)
  }, [])

  // Scroll to NOW on load
  useEffect(() => {
    if (!scrollRef.current || loading) return
    const nowX = timeToX(nowSec)
    scrollRef.current.scrollLeft = Math.max(0, nowX - scrollRef.current.clientWidth / 2)
  }, [loading])

  const handleProgClick = useCallback(async (prog: Programme) => {
    if (prog.endTime > nowSec) {
      // Current or future programme — go back to live
      onGoLive()
      return
    }
    // Past programme — fetch catchup URL
    const durationMins = Math.ceil((prog.endTime - prog.startTime) / 60)
    const result = await api.content.getCatchupUrl({
      contentId,
      startTime: prog.startTime,
      duration: durationMins,
    })
    if (result?.url) {
      onPlayCatchup(result.url, prog)
    }
  }, [contentId, nowSec, onPlayCatchup, onGoLive])

  const nowX = timeToX(nowSec)

  // Generate hour markers
  const hours: number[] = []
  let h = Math.ceil(windowStart / 3600) * 3600
  while (h < windowEnd) {
    hours.push(h)
    h += 3600
  }

  if (loading && programmes.length === 0) return null

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      height: BAR_HEIGHT,
      background: 'linear-gradient(0deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 70%, transparent 100%)',
      zIndex: 98,
      display: 'flex',
      alignItems: 'center',
      pointerEvents: 'all',
    }}>
      {/* LIVE button */}
      <button
        onClick={onGoLive}
        style={{
          flexShrink: 0,
          margin: '0 8px 0 12px',
          padding: '4px 10px',
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          border: 'none',
          cursor: 'pointer',
          background: isTimeshift ? 'rgba(255,255,255,0.12)' : '#e05555',
          color: isTimeshift ? 'rgba(255,255,255,0.6)' : '#fff',
          transition: 'all 0.15s',
        }}
      >
        LIVE
      </button>

      {/* Timeline scroll area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowX: 'auto',
          overflowY: 'hidden',
          position: 'relative',
          height: BAR_HEIGHT - 8,
          scrollbarWidth: 'none',
        }}
      >
        <div style={{ position: 'relative', width: totalWidth, height: '100%' }}>

          {/* Hour markers */}
          {hours.map((t) => {
            const x = timeToX(t)
            const d = new Date(t * 1000)
            const label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            return (
              <div key={t} style={{ position: 'absolute', left: x, top: 0, height: '100%', pointerEvents: 'none' }}>
                <div style={{ width: 1, height: 6, background: 'rgba(255,255,255,0.15)' }} />
                <span style={{
                  position: 'absolute', top: 1, left: 4,
                  fontSize: 8, color: 'rgba(255,255,255,0.25)',
                  fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                }}>
                  {label}
                </span>
              </div>
            )
          })}

          {/* Programme blocks */}
          {programmes.map((prog) => {
            const left = Math.max(0, timeToX(prog.startTime))
            const right = timeToX(Math.min(prog.endTime, windowEnd))
            const width = right - left
            if (width < 2) return null

            const isPast = prog.endTime <= nowSec
            const isNow = prog.startTime <= nowSec && prog.endTime > nowSec
            const isCurrent = currentProg?.id === prog.id
            const progress = isNow ? ((nowSec - prog.startTime) / (prog.endTime - prog.startTime)) * 100 : 0

            return (
              <div
                key={prog.id}
                onClick={() => handleProgClick(prog)}
                title={`${prog.title}\n${fmtTime(prog.startTime)} – ${fmtTime(prog.endTime)}`}
                style={{
                  position: 'absolute',
                  left,
                  top: 14,
                  width,
                  height: BAR_HEIGHT - 22,
                  borderRadius: 3,
                  overflow: 'hidden',
                  cursor: isPast ? 'pointer' : 'default',
                  background: isCurrent
                    ? 'rgba(124,77,255,0.4)'
                    : isNow
                      ? 'rgba(255,255,255,0.15)'
                      : isPast
                        ? 'rgba(255,255,255,0.06)'
                        : 'rgba(255,255,255,0.04)',
                  border: isCurrent
                    ? '1px solid rgba(124,77,255,0.6)'
                    : isNow
                      ? '1px solid rgba(255,255,255,0.2)'
                      : '1px solid rgba(255,255,255,0.06)',
                  transition: 'background 0.12s',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 6px',
                }}
                onMouseEnter={(e) => { if (isPast) e.currentTarget.style.background = 'rgba(255,255,255,0.18)' }}
                onMouseLeave={(e) => {
                  if (isPast && !isCurrent) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                }}
              >
                {/* Progress fill for NOW programme */}
                {isNow && (
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${progress}%`,
                    background: 'rgba(224,85,85,0.2)',
                    pointerEvents: 'none',
                  }} />
                )}
                <span style={{
                  fontSize: 10,
                  color: isPast ? 'rgba(255,255,255,0.4)' : isNow ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)',
                  fontWeight: isNow ? 600 : 400,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  position: 'relative',
                  zIndex: 1,
                }}>
                  {width > 50 ? prog.title : ''}
                </span>
              </div>
            )
          })}

          {/* NOW line */}
          <div
            ref={nowMarkerRef}
            style={{
              position: 'absolute',
              left: nowX,
              top: 10,
              bottom: 2,
              width: 2,
              background: '#e05555',
              borderRadius: 1,
              zIndex: 5,
              pointerEvents: 'none',
            }}
          >
            <div style={{
              position: 'absolute', top: -3, left: -3,
              width: 8, height: 8, borderRadius: '50%',
              background: '#e05555',
            }} />
          </div>
        </div>
      </div>

      {/* Current time label */}
      <div style={{
        flexShrink: 0,
        padding: '0 12px 0 8px',
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        color: 'rgba(255,255,255,0.4)',
      }}>
        {fmtTime(nowSec)}
      </div>
    </div>
  )
}
