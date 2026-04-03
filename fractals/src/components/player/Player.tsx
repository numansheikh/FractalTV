import { useEffect, useRef, useState, useCallback } from 'react'
import Hls from 'hls.js'
import { motion, AnimatePresence } from 'framer-motion'
import { ContentItem } from '@/components/browse/ContentCard'
import { api } from '@/lib/api'

declare global {
  interface Window {
    electronDevTools?: () => void
  }
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
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  // Load stream URL and initialise HLS
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const result = await api.content.getStreamUrl({ contentId: content.id })
      if (cancelled) return

      if (!result?.url) {
        setError(result?.error ?? 'Could not get stream URL')
        setLoading(false)
        return
      }

      const video = videoRef.current
      if (!video) return

      const url: string = result.url
      setStreamUrl(url)

      // Native HLS (Safari) or hls.js
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url
        setLoading(false)
      } else if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: content.type === 'live',
        })
        hlsRef.current = hls
        hls.loadSource(url)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!cancelled) setLoading(false)
        })
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal && !cancelled) {
            setError(`Stream error: ${data.details}`)
            setLoading(false)
          }
        })
      } else {
        // Fallback for non-HLS (e.g. MP4 VOD)
        video.src = url
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [content.id, content.type])

  // Auto-play once loaded
  useEffect(() => {
    if (!loading && videoRef.current) {
      videoRef.current.play().catch(() => {})
    }
  }, [loading])

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const video = videoRef.current
      if (!video) return
      switch (e.key) {
        case 'Escape': onClose(); break
        case ' ': e.preventDefault(); togglePlay(); break
        case 'ArrowRight': video.currentTime += 10; break
        case 'ArrowLeft': video.currentTime -= 10; break
        case 'ArrowUp': video.volume = Math.min(1, video.volume + 0.1); break
        case 'ArrowDown': video.volume = Math.max(0, video.volume - 0.1); break
        case 'm': case 'M': video.muted = !video.muted; setMuted(video.muted); break
        case 'f': case 'F': toggleFullscreen(); break
        case 'd': case 'D': setShowDebug((v) => !v); break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) { video.play() } else { video.pause() }
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      videoRef.current?.closest('.player-root')?.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }, [])

  const showControlsTemporarily = useCallback(() => {
    setShowControls(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000)
  }, [])

  const formatTime = (secs: number) => {
    if (!isFinite(secs)) return '–:––'
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = Math.floor(secs % 60)
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const isLive = content.type === 'live'

  return (
    <div
      className="player-root fixed inset-0 z-50 flex flex-col"
      style={{ background: '#000' }}
      onMouseMove={showControlsTemporarily}
      onClick={showControlsTemporarily}
    >
      {/* Video */}
      <video
        ref={videoRef}
        className="h-full w-full"
        style={{ cursor: showControls ? 'default' : 'none' }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onVolumeChange={(e) => { setVolume(e.currentTarget.volume); setMuted(e.currentTarget.muted) }}
        onClick={togglePlay}
      />

      {/* Loading spinner */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ pointerEvents: 'none' }}
          >
            <div
              className="h-10 w-10 animate-spin rounded-full border-2"
              style={{ borderColor: 'rgba(124,77,255,0.3)', borderTopColor: '#7c4dff' }}
            />
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {content.title}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-4"
          >
            <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium"
              style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
            >
              Go back
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls overlay */}
      <AnimatePresence>
        {showControls && !loading && !error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 flex flex-col justify-between"
            style={{ pointerEvents: 'none' }}
          >
            {/* Top bar */}
            <div
              className="flex items-center gap-3"
              style={{
                padding: '16px 20px',
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)',
                pointerEvents: 'auto',
              }}
            >
              <button
                onClick={onClose}
                className="flex items-center justify-center rounded-full p-2 transition-colors"
                style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
                </svg>
              </button>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" style={{ color: '#fff' }}>
                  {content.title}
                </p>
                {content.year && (
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{content.year}</p>
                )}
              </div>

              {isLive && (
                <div
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
                  style={{ background: 'rgba(248,113,113,0.2)', border: '1px solid rgba(248,113,113,0.4)' }}
                >
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: '#f87171' }} />
                  <span className="text-[11px] font-semibold" style={{ color: '#f87171' }}>LIVE</span>
                </div>
              )}
            </div>

            {/* Bottom controls */}
            <div
              style={{
                padding: '0 20px 20px',
                background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)',
                pointerEvents: 'auto',
              }}
            >
              {/* Seek bar — hidden for live */}
              {!isLive && duration > 0 && (
                <div className="mb-3">
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    value={currentTime}
                    onChange={(e) => {
                      if (videoRef.current) videoRef.current.currentTime = Number(e.target.value)
                    }}
                    className="w-full"
                    style={{ accentColor: '#7c4dff', height: '3px' }}
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{formatTime(currentTime)}</span>
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{formatTime(duration)}</span>
                  </div>
                </div>
              )}

              {/* Buttons row */}
              <div className="flex items-center gap-3">
                {/* Play/Pause */}
                <ControlButton onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
                  {playing ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  )}
                </ControlButton>

                {/* Volume */}
                <ControlButton onClick={() => { if (videoRef.current) { videoRef.current.muted = !videoRef.current.muted } }} title="Mute">
                  {muted || volume === 0 ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                  )}
                </ControlButton>

                <div className="flex-1" />

                {/* Debug toggle */}
                <ControlButton onClick={() => setShowDebug((v) => !v)} title="Debug (D)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </ControlButton>

                {/* Fullscreen */}
                <ControlButton onClick={toggleFullscreen} title="Fullscreen (F)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                </ControlButton>
              </div>

              {/* Debug panel */}
              <AnimatePresence>
                {showDebug && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="mt-3 rounded-lg p-3 font-mono text-[11px]"
                    style={{
                      background: 'rgba(0,0,0,0.85)',
                      border: '1px solid rgba(124,77,255,0.3)',
                      color: 'rgba(255,255,255,0.7)',
                      lineHeight: '1.6',
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ color: '#b388ff', fontWeight: 600 }}>Debug</span>
                      <button
                        onClick={() => window.electronDevTools?.()}
                        className="rounded px-2 py-0.5 text-[10px] transition-colors"
                        style={{ background: 'rgba(124,77,255,0.2)', color: '#b388ff' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(124,77,255,0.35)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(124,77,255,0.2)' }}
                      >
                        Open DevTools
                      </button>
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.4)' }}>title</div>
                    <div className="mb-2" style={{ color: '#e2dff5' }}>{content.title}</div>
                    <div style={{ color: 'rgba(255,255,255,0.4)' }}>stream url</div>
                    <div
                      className="break-all"
                      style={{ color: error ? '#f87171' : '#86efac' }}
                    >
                      {streamUrl ?? '—'}
                    </div>
                    {error && (
                      <>
                        <div className="mt-2" style={{ color: 'rgba(255,255,255,0.4)' }}>error</div>
                        <div style={{ color: '#f87171' }}>{error}</div>
                      </>
                    )}
                    <div className="mt-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      hls.js supported: {String(Hls.isSupported())} · native hls: {String(videoRef.current?.canPlayType('application/vnd.apple.mpegurl') !== '')}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ControlButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center rounded-full p-2 transition-colors"
      style={{ color: '#fff', background: 'rgba(255,255,255,0.1)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
    >
      {children}
    </button>
  )
}
