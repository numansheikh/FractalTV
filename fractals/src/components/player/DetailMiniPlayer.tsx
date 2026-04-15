import { useState, useEffect, useRef } from 'react'
import Hls from 'hls.js'
import Artplayer from 'artplayer'
import { api } from '@/lib/api'
import { AutoplayPrompt } from './AutoplayPrompt'

interface Props {
  contentId: string
  autoplay: boolean
  promptSeen: boolean
  onPromptSeen: () => void
}

function MiniAudioBars() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const BAR_COUNT = 24
    const BAR_GAP = 2
    const BAR_RADIUS = 1.5
    const phases = Array.from({ length: BAR_COUNT }, () => Math.random() * Math.PI * 2)
    const speeds = Array.from({ length: BAR_COUNT }, () => 1.5 + Math.random() * 2.5)

    const draw = (t: number) => {
      rafRef.current = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, w, h)
      const barW = (w - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT
      for (let i = 0; i < BAR_COUNT; i++) {
        const val = 0.3 + 0.7 * Math.abs(Math.sin(t * 0.002 * speeds[i] + phases[i]))
        const barH = Math.max(2, val * h * 0.8)
        const x = i * (barW + BAR_GAP)
        const y = (h - barH) / 2
        const hue = 260 + (i / BAR_COUNT) * 80
        const lightness = 50 + val * 25
        ctx.fillStyle = `hsla(${hue}, 80%, ${lightness}%, 0.85)`
        ctx.beginPath()
        ctx.roundRect(x, y, barW, barH, BAR_RADIUS)
        ctx.fill()
      }
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: 36, display: 'block' }}
    />
  )
}

export function DetailMiniPlayer({ contentId, autoplay, promptSeen, onPromptSeen }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<Artplayer | null>(null)
  const autoplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [started, setStarted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAudioOnly, setIsAudioOnly] = useState(false)
  const [paused, setPaused] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [reconnectAttempt, setReconnectAttempt] = useState<number | null>(null)

  const MAX_RECONNECT = 5
  const RECONNECT_BACKOFF = [2000, 4000, 8000, 16000, 32000]

  // Start or stop the player
  const startPlayer = (id: string) => {
    if (!containerRef.current) return

    setLoading(true)
    setError(null)
    setIsAudioOnly(false)
    setStarted(true)

    let cancelled = false

    api.content.getStreamUrl({ contentId: id }).then((result: any) => {
      if (cancelled || !containerRef.current) return

      if (!result?.url) {
        setError(result?.error ?? 'Could not get stream URL')
        setLoading(false)
        return
      }

      const url: string = result.url
      const isHls = url.includes('.m3u8') || url.includes('m3u8')

      let reconnectCount = 0

      const art = new Artplayer({
        container: containerRef.current!,
        url,
        autoplay: true,
        controls: [],
        settings: [],
        contextmenu: [],
        pip: false,
        fullscreen: false,
        hotkey: false,
        playbackRate: false,
        aspectRatio: false,
        setting: false,
        flip: false,
        miniProgressBar: false,
        mutex: true,
        backdrop: false,
        playsInline: true,
        autoMini: false,
        screenshot: false,
        lock: false,
        isLive: true,
        theme: 'transparent',
        moreVideoAttr: { crossOrigin: 'anonymous' },
        ...(isHls && Hls.isSupported() && {
          customType: {
            m3u8: (video: HTMLVideoElement, src: string) => {
              const hls = new Hls({ enableWorker: true, lowLatencyMode: true })
              ;(art as any).hls = hls
              hls.loadSource(src)
              hls.attachMedia(video)
              hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
                if (data.fatal && !cancelled) {
                  if (reconnectCount < MAX_RECONNECT) {
                    reconnectCount++
                    setReconnectAttempt(reconnectCount)
                    setLoading(false)
                    reconnectTimerRef.current = setTimeout(() => {
                      if (!cancelled) {
                        setReconnectAttempt(null)
                        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                          hls.recoverMediaError()
                        } else {
                          hls.startLoad()
                        }
                      }
                    }, RECONNECT_BACKOFF[reconnectCount - 1])
                  } else {
                    setReconnectAttempt(null)
                    setError('Stream unavailable')
                    setLoading(false)
                  }
                }
              })
            },
          },
        }),
      })

      artRef.current = art

      art.on('ready', () => {
        if (!cancelled) setLoading(false)
        const video = art.template.$video as HTMLVideoElement
        if (video) {
          const checkAudioOnly = () => {
            if (cancelled) return
            if (video.videoWidth === 0 && video.videoHeight === 0) {
              setIsAudioOnly(true)
            } else {
              setIsAudioOnly(false)
            }
          }
          video.addEventListener('loadedmetadata', checkAudioOnly, { once: true })
          art.on('video:playing', checkAudioOnly)
          setTimeout(checkAudioOnly, 3000)
          setTimeout(checkAudioOnly, 6000)
        }
      })

      art.on('error', () => {
        if (!cancelled) { setError('Playback error'); setLoading(false) }
      })

      art.on('pause', () => { if (!cancelled) setPaused(true) })
      art.on('play', () => { if (!cancelled) setPaused(false) })

      // Track cancelled inside closure
      ;(art as any)._cancelRef = () => { cancelled = true }
    })

    return () => { cancelled = true }
  }

  const destroyPlayer = (savePositionForId?: string) => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    setReconnectAttempt(null)
    if (artRef.current) {
      try {
        // Save position on unmount if >= 60s (enables continue watching)
        if (savePositionForId) {
          const pos = artRef.current.currentTime
          if (pos >= 60) {
            api.user.setPosition(savePositionForId, Math.floor(pos))
          }
        }
        ;(artRef.current as any)._cancelRef?.()
        ;(artRef.current as any).hls?.destroy()
        artRef.current.destroy(true)
      } catch {}
      artRef.current = null
    }
    setStarted(false)
    setLoading(false)
    setError(null)
    setPaused(false)
    setIsAudioOnly(false)
  }

  // 2s autoplay delay; reset on contentId change
  useEffect(() => {
    if (!contentId) return

    // Save position for previous contentId before switching (captured in closure)
    const prevId = contentId
    destroyPlayer()

    if (autoplay) {
      autoplayTimerRef.current = setTimeout(() => {
        startPlayer(contentId)
      }, 2000)
    }

    return () => {
      if (autoplayTimerRef.current != null) {
        clearTimeout(autoplayTimerRef.current)
        autoplayTimerRef.current = null
      }
      destroyPlayer(prevId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId, autoplay])

  const handlePlayPause = () => {
    if (!started) {
      startPlayer(contentId)
      return
    }

    // First interaction: show prompt if not seen
    if (!promptSeen) {
      setShowPrompt(true)
      return
    }

    if (artRef.current) {
      if (paused) {
        artRef.current.play()
      } else {
        artRef.current.pause()
      }
    }
  }

  const handlePromptDone = (autoplayEnabled: boolean) => {
    setShowPrompt(false)
    onPromptSeen()
    // If they said No or Don't ask again we just leave current state;
    // if they said Yes we make sure we start playing
    if (autoplayEnabled && artRef.current) {
      artRef.current.play()
    }
  }

  return (
    <div style={{
      width: '100%',
      aspectRatio: '16/9',
      background: '#000',
      borderRadius: 8,
      overflow: 'hidden',
      position: 'relative',
      flexShrink: 0,
    }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Not-started overlay — click to play */}
      {!started && !loading && !error && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)',
            cursor: 'pointer',
          }}
          onClick={handlePlayPause}
        >
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(255,255,255,0.18)',
            border: '1.5px solid rgba(255,255,255,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 18, color: '#fff', marginLeft: 3 }}>▶</span>
          </div>
        </div>
      )}

      {/* Audio-only overlay */}
      {isAudioOnly && !loading && !error && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 5,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'radial-gradient(ellipse at center, rgba(20,10,40,0.95) 0%, rgba(5,5,15,0.98) 100%)',
          pointerEvents: 'none', gap: 10,
        }}>
          <MiniAudioBars />
        </div>
      )}

      {/* Reconnect overlay */}
      {reconnectAttempt !== null && !error && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', gap: 8, zIndex: 8,
        }}>
          <div style={{
            width: 24, height: 24,
            border: '2px solid rgba(255,255,255,0.15)',
            borderTopColor: '#fff',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-ui)' }}>
            Reconnecting… ({reconnectAttempt}/{MAX_RECONNECT})
          </span>
        </div>
      )}

      {/* Loading spinner */}
      {loading && !error && !reconnectAttempt && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', zIndex: 8,
        }}>
          <div style={{
            width: 28, height: 28,
            border: '2px solid rgba(255,255,255,0.15)',
            borderTopColor: '#fff',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.8)', gap: 8, zIndex: 8,
        }}>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{error}</span>
          <button
            style={{
              padding: '4px 12px', borderRadius: 5,
              background: 'var(--bg-3)', border: 'none', cursor: 'pointer',
              fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-ui)',
            }}
            onClick={() => { setError(null); startPlayer(contentId) }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Pause/play controls (visible when started + not loading + not error) */}
      {started && !loading && !error && !showPrompt && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 9,
            opacity: 0,
            transition: 'opacity 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0' }}
          onClick={handlePlayPause}
        >
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(255,255,255,0.18)',
            border: '1.5px solid rgba(255,255,255,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 18, color: '#fff', marginLeft: paused ? 3 : 0 }}>
              {paused ? '▶' : '⏸'}
            </span>
          </div>
        </div>
      )}

      {/* Autoplay prompt */}
      {showPrompt && <AutoplayPrompt onDone={handlePromptDone} />}
    </div>
  )
}
