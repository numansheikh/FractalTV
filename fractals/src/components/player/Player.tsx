import { useEffect, useRef, useState, useCallback } from 'react'
import Hls from 'hls.js'
import { motion, AnimatePresence } from 'framer-motion'
import { ContentItem } from '@/components/browse/ContentCard'
import { api } from '@/lib/api'

declare global {
  interface Window { electronDevTools?: () => void }
}

interface Props {
  content: ContentItem
  onClose: () => void
}

export function Player({ content, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [showDebug, setShowDebug] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)

  // Load stream URL and init HLS
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setStreamUrl(null)

    api.content.getStreamUrl({ contentId: content.id }).then((result: any) => {
      if (cancelled) return

      if (!result?.url) {
        setError(result?.error ?? 'Could not get stream URL')
        setLoading(false)
        return
      }

      const url: string = result.url
      setStreamUrl(url)

      const video = videoRef.current
      if (!video) return

      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari / macOS WebKit)
        video.src = url
        setLoading(false)
      } else if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: content.type === 'live' })
        hlsRef.current = hls
        hls.loadSource(url)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => { if (!cancelled) setLoading(false) })
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal && !cancelled) {
            setError(`${data.type}: ${data.details}`)
            setLoading(false)
          }
        })
      } else {
        // Direct MP4 / non-HLS
        video.src = url
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [content.id, content.type])

  // Auto-play once loaded
  useEffect(() => {
    if (!loading && !error && videoRef.current) {
      videoRef.current.play().catch(() => {})
    }
  }, [loading, error])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.paused ? v.play() : v.pause()
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.querySelector('.player-root')?.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }, [])

  const nudgeControls = useCallback(() => {
    setShowControls(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000)
  }, [])

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const v = videoRef.current
      switch (e.key) {
        case 'Escape': onClose(); return
        case ' ': e.preventDefault(); togglePlay(); return
        case 'ArrowRight': if (v) v.currentTime += 10; return
        case 'ArrowLeft':  if (v) v.currentTime -= 10; return
        case 'ArrowUp':    if (v) v.volume = Math.min(1, v.volume + 0.1); return
        case 'ArrowDown':  if (v) v.volume = Math.max(0, v.volume - 0.1); return
        case 'm': case 'M': if (v) { v.muted = !v.muted; setMuted(v.muted) } return
        case 'f': case 'F': toggleFullscreen(); return
        case 'd': case 'D': setShowDebug((x) => !x); return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, togglePlay, toggleFullscreen])

  const fmt = (s: number) => {
    if (!isFinite(s)) return '--:--'
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60)
    return h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
      : `${m}:${String(ss).padStart(2,'0')}`
  }

  const isLive = content.type === 'live'

  return (
    <div
      className="player-root fixed inset-0 z-50"
      style={{ background: '#000' }}
      onMouseMove={nudgeControls}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full"
        style={{ cursor: showControls ? 'default' : 'none' }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        onClick={togglePlay}
      />

      {/* Loading */}
      <AnimatePresence>
        {loading && (
          <motion.div key="loader" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-4"
            style={{ pointerEvents: 'none' }}
          >
            <div className="h-10 w-10 animate-spin rounded-full border-2"
              style={{ borderColor: 'rgba(124,77,255,0.25)', borderTopColor: '#7c4dff' }} />
            <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>{content.title}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium mb-1" style={{ color: '#f87171' }}>Playback failed</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{error}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={onClose}
                className="rounded-lg px-4 py-2 text-xs font-medium"
                style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>
                Go back
              </button>
              <button onClick={() => setShowDebug((x) => !x)}
                className="rounded-lg px-4 py-2 text-xs font-medium"
                style={{ background: 'rgba(124,77,255,0.15)', color: '#b388ff' }}>
                Show debug info
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Controls overlay (auto-hide) ─────────────────────────────────── */}
      <AnimatePresence>
        {showControls && !loading && (
          <motion.div key="controls" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 flex flex-col justify-between"
            style={{ pointerEvents: 'none' }}
          >
            {/* Top gradient + header */}
            <div style={{
              padding: '16px 20px',
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)',
              pointerEvents: 'auto',
            }}>
              <div className="flex items-center gap-3">
                <button onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
                  style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" style={{ color: '#fff' }}>{content.title}</p>
                  {content.year && <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>{content.year}</p>}
                </div>
                {isLive && (
                  <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
                    style={{ background: 'rgba(251,113,133,0.2)', border: '1px solid rgba(251,113,133,0.4)' }}>
                    <div className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: '#fb7185' }} />
                    <span className="text-[11px] font-bold" style={{ color: '#fb7185' }}>LIVE</span>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom gradient + controls */}
            <div style={{
              padding: '0 20px 22px',
              background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)',
              pointerEvents: 'auto',
            }}>
              {/* Seek bar for VOD */}
              {!isLive && duration > 0 && (
                <div className="mb-3">
                  <input type="range" min={0} max={duration} value={currentTime}
                    onChange={(e) => { if (videoRef.current) videoRef.current.currentTime = +e.target.value }}
                    className="w-full" style={{ accentColor: '#7c4dff' }} />
                  <div className="mt-1 flex justify-between">
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>{fmt(currentTime)}</span>
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>{fmt(duration)}</span>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2.5">
                {/* Play/Pause */}
                <Btn onClick={togglePlay} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
                  {playing
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  }
                </Btn>

                {/* Mute */}
                <Btn onClick={() => { if (videoRef.current) { videoRef.current.muted = !videoRef.current.muted } }} title="Mute (M)">
                  {muted
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                  }
                </Btn>

                <div className="flex-1" />

                {/* Fullscreen */}
                <Btn onClick={toggleFullscreen} title="Fullscreen (F)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                  </svg>
                </Btn>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Debug button — ALWAYS visible in bottom-right ─────────────────── */}
      <button
        onClick={() => setShowDebug((x) => !x)}
        title="Debug (D)"
        className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-mono transition-all"
        style={{
          background: showDebug ? 'rgba(124,77,255,0.3)' : 'rgba(0,0,0,0.5)',
          color: showDebug ? '#b388ff' : 'rgba(255,255,255,0.35)',
          border: `1px solid ${showDebug ? 'rgba(124,77,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
          backdropFilter: 'blur(8px)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#b388ff'; e.currentTarget.style.borderColor = 'rgba(124,77,255,0.35)' }}
        onMouseLeave={(e) => {
          if (!showDebug) { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        debug
      </button>

      {/* ── Debug panel ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showDebug && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-14 right-4 z-10 w-96 rounded-xl p-4 font-mono text-[11px]"
            style={{
              background: 'rgba(10,10,20,0.95)',
              border: '1px solid rgba(124,77,255,0.25)',
              backdropFilter: 'blur(12px)',
              lineHeight: '1.7',
              maxWidth: 'calc(100vw - 32px)',
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span style={{ color: '#b388ff', fontWeight: 700, fontSize: '12px' }}>Player Debug</span>
              <button
                onClick={() => window.electronDevTools?.()}
                className="rounded-md px-2.5 py-1 text-[10px] transition-colors"
                style={{ background: 'rgba(124,77,255,0.2)', color: '#b388ff' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(124,77,255,0.35)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(124,77,255,0.2)' }}
              >
                Open DevTools
              </button>
            </div>

            <Row label="title" value={content.title} />
            <Row label="content id" value={content.id} />
            <Row label="type" value={content.type} />
            <Row
              label="stream url"
              value={streamUrl ?? (loading ? 'resolving…' : 'not set')}
              color={error ? '#f87171' : streamUrl ? '#86efac' : 'rgba(255,255,255,0.5)'}
              copyable
            />
            {error && <Row label="error" value={error} color="#f87171" />}
            <Row
              label="hls.js"
              value={`supported=${Hls.isSupported()} · version=${Hls.version}`}
            />
            <Row
              label="native hls"
              value={String(!!videoRef.current?.canPlayType('application/vnd.apple.mpegurl'))}
            />
            <Row label="state" value={`playing=${playing} muted=${muted} t=${fmt(currentTime)}`} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Row({ label, value, color, copyable }: { label: string; value: string; color?: string; copyable?: boolean }) {
  return (
    <div className="mb-1.5">
      <span style={{ color: 'rgba(255,255,255,0.3)' }}>{label}: </span>
      <span
        className={copyable ? 'cursor-pointer break-all' : 'break-all'}
        style={{ color: color ?? 'rgba(255,255,255,0.75)' }}
        title={copyable ? 'Click to copy' : undefined}
        onClick={copyable && value ? () => navigator.clipboard.writeText(value) : undefined}
      >
        {value}
      </span>
    </div>
  )
}

function Btn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title}
      className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
      style={{ color: '#fff', background: 'rgba(255,255,255,0.1)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}>
      {children}
    </button>
  )
}

function fmt(s: number) {
  if (!isFinite(s)) return '--:--'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60)
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${m}:${String(ss).padStart(2,'0')}`
}
