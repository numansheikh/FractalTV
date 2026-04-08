import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Hls from 'hls.js'
import Artplayer from 'artplayer'
import { motion, AnimatePresence } from 'framer-motion'
import { ContentItem } from '@/components/browse/ContentCard'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app.store'

declare global {
  interface Window { electronDevTools?: () => void }
}

interface Props {
  content: ContentItem
  onClose: () => void
}

export function Player({ content, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<Artplayer | null>(null)
  const qc = useQueryClient()
  const minWatchSeconds = useAppStore((s) => s.minWatchSeconds)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [isAudioOnly, setIsAudioOnly] = useState(false)
  const [osd, setOsd] = useState<{ text: string; icon: 'seek-back' | 'seek-fwd' | 'vol-up' | 'vol-down' } | null>(null)
  const osdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [resumePrompt, setResumePrompt] = useState<number | null>(null) // saved position in seconds
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completionMarkedRef = useRef(false)
  const positionSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError(null)
    setStreamUrl(null)
    setIsAudioOnly(false)

    // Episodes / catchup carry their own stream URL directly
    const episodeUrlPromise: Promise<any> = content._catchupUrl
      ? Promise.resolve({ url: content._catchupUrl })
      : (content as any)._streamId
        ? Promise.resolve({
            url: `${(content as any)._serverUrl.replace(/\/$/, '')}/series/${encodeURIComponent((content as any)._username)}/${encodeURIComponent((content as any)._password)}/${(content as any)._streamId}.${(content as any)._extension ?? 'mkv'}`
          })
        : api.content.getStreamUrl({ contentId: content.id })

    episodeUrlPromise.then((result: any) => {
      if (cancelled) return

      if (!result?.url) {
        setError(result?.error ?? 'Could not get stream URL')
        setLoading(false)
        return
      }

      const url: string = result.url
      setStreamUrl(url)

      // External player preference
      const pref = localStorage.getItem('fractals-player') as 'artplayer' | 'mpv' | 'vlc' | null
      if (pref === 'mpv' || pref === 'vlc') {
        const customPath = localStorage.getItem(`fractals-player-${pref}-path`) ?? undefined
        api.player.openExternal({ player: pref, url, title: content.title, customPath }).then((res: any) => {
          if (cancelled) return
          if (res?.success) { onClose() } else { setError(`Failed to launch ${pref.toUpperCase()}: ${res?.error ?? 'not found'}`) }
          setLoading(false)
        })
        return
      }

      // Built-in: ArtPlayer
      if (!containerRef.current) return

      const isHls = url.includes('.m3u8') || url.includes('m3u8')
      const isLive = content.type === 'live'

      const art = new Artplayer({
        container: containerRef.current,
        url,
        autoplay: true,
        pip: true,
        fullscreen: true,
        hotkey: true,
        playbackRate: !isLive,
        aspectRatio: true,
        setting: true,
        flip: false,
        miniProgressBar: true,
        mutex: true,
        backdrop: false,
        playsInline: true,
        autoMini: false,
        screenshot: false,
        lock: false,
        fastForward: false,
        autoPlayback: !isLive,
        airplay: true,
        theme: '#7c4dff',
        lang: 'en',
        isLive,
        moreVideoAttr: {
          crossOrigin: 'anonymous',
        },
        ...(isHls && Hls.isSupported() && {
          customType: {
            m3u8: (video: HTMLVideoElement, src: string) => {
              if (artRef.current?.hls) {
                artRef.current.hls.loadSource(src)
                artRef.current.hls.attachMedia(video)
              } else {
                const hls = new Hls({
                  enableWorker: true,
                  lowLatencyMode: isLive,
                })
                ;(art as any).hls = hls
                hls.loadSource(src)
                hls.attachMedia(video)
                hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
                  if (data.fatal && !cancelled) {
                    // Auto-recover from network errors (e.g. ISP switch)
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                      console.log('[HLS] Fatal network error, attempting recovery…')
                      hls.startLoad()
                    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                      console.log('[HLS] Fatal media error, attempting recovery…')
                      hls.recoverMediaError()
                    } else {
                      setError(`${data.type}: ${data.details}`)
                    }
                  }
                })
              }
            },
          },
        }),
      })

      artRef.current = art

      art.on('ready', () => {
        if (!cancelled) setLoading(false)

        // Audio-only detection via native video events — more reliable than timeouts
        const video = art.template.$video as HTMLVideoElement
        if (video) {
          const checkDimensions = () => {
            if (cancelled) return
            video.removeEventListener('loadedmetadata', checkDimensions)
            setIsAudioOnly(video.videoWidth === 0 && video.videoHeight === 0)
          }

          // Primary: loadedmetadata fires when browser knows all track info (incl. dimensions)
          video.addEventListener('loadedmetadata', checkDimensions)

          // Fallback: timeupdate fires once playback is active — catches streams where
          // loadedmetadata already fired before our listener was attached
          const onTimeUpdate = () => {
            if (video.currentTime > 1) {
              video.removeEventListener('timeupdate', onTimeUpdate)
              checkDimensions()
            }
          }
          video.addEventListener('timeupdate', onTimeUpdate)

          // Last-resort timeout for unusual streams that never fire either event
          setTimeout(() => {
            video.removeEventListener('loadedmetadata', checkDimensions)
            video.removeEventListener('timeupdate', onTimeUpdate)
            if (!cancelled) setIsAudioOnly(video.videoWidth === 0 && video.videoHeight === 0)
          }, 15000)
        }

        // ArtPlayer uses $progress.clientWidth for seek % but positions the indicator
        // relative to .art-control-progress-inner — on HiDPI or with any box-model
        // difference these diverge, causing the bar to land right of the click.
        // Fix: compute pct against the inner track element that setBar actually uses.
        const progressEl = (art.template as any).$progress as HTMLElement | undefined
        if (!progressEl || isLive) return

        // The inner track is what ArtPlayer positions $played and $indicator against.
        const trackEl = (progressEl.querySelector('.art-control-progress-inner') ?? progressEl) as HTMLElement

        const computePct = (clientX: number) => {
          const r = trackEl.getBoundingClientRect()
          return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
        }

        const fmtTime = (s: number) => {
          const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60)
          return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${m}:${String(ss).padStart(2,'0')}`
        }

        // Fix hover preview bar — ArtPlayer's mousemove uses buggy clientWidth
        progressEl.addEventListener('mousemove', (e: MouseEvent) => {
          const pct = computePct(e.clientX)
          const hover = progressEl.querySelector('.art-progress-hover') as HTMLElement | null
          const tip   = progressEl.querySelector('.art-progress-tip')   as HTMLElement | null
          if (hover) hover.style.width = `${pct * 100}%`
          if (tip)   { tip.textContent = fmtTime(pct * art.duration); tip.style.left = `${pct * 100}%` }
          e.stopImmediatePropagation()
        }, { capture: true })

        // Fix click/drag seek — also block ArtPlayer's own click handler
        progressEl.addEventListener('click', (e: MouseEvent) => {
          e.stopImmediatePropagation()
        }, { capture: true })

        progressEl.addEventListener('mousedown', (e: MouseEvent) => {
          e.stopImmediatePropagation()
          e.preventDefault()
          const applySeek = (pct: number) => {
            art.emit('setBar', 'played', pct)
            art.seek = pct * art.duration
          }
          applySeek(computePct(e.clientX))

          const onMove = (ev: MouseEvent) => applySeek(computePct(ev.clientX))
          const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        }, { capture: true })
      })

      // Clear error + loading if video actually starts playing
      art.on('video:playing', () => {
        if (!cancelled) {
          setError(null)
          setLoading(false)
        }
      })

      art.on('error', (_e: any, msg: string) => {
        if (!cancelled) {
          // Only show error if video isn't actually playing
          const video = art.template?.$video as HTMLVideoElement | undefined
          if (video && !video.paused && video.currentTime > 0) return // playing fine, ignore
          setError(msg || 'Playback error')
          setLoading(false)
        }
      })
    })

    return () => {
      cancelled = true
      if (artRef.current) {
        // Destroy hls instance if attached
        const hls = (artRef.current as any).hls
        hls?.destroy()
        artRef.current.destroy()
        artRef.current = null
      }
    }
  }, [content.id, content.type, content.title, onClose])

  // Position save + resume + completion detection (skip for live TV)
  useEffect(() => {
    const isLive = content.type === 'live'
    if (isLive) return

    // Fetch saved position on mount
    api.user.getData(content.id).then((data: any) => {
      if (data?.last_position > 0 && !data?.completed) {
        setResumePrompt(data.last_position)
        // Auto-resume after 5s if no interaction
        resumeTimerRef.current = setTimeout(() => {
          const art = artRef.current
          if (art && data.last_position > 0) {
            art.seek = data.last_position
          }
          setResumePrompt(null)
        }, 5000)
      }
    })

    // Debounced position save on timeupdate
    const saveInterval = setInterval(() => {
      const art = artRef.current
      if (!art || art.playing === false) return
      const t = Math.floor(art.currentTime)
      if (t >= minWatchSeconds) {
        api.user.setPosition(content.id, t)
      }
    }, 10000) // every 10s

    // Save on pause
    const onPause = () => {
      const art = artRef.current
      if (!art) return
      const t = Math.floor(art.currentTime)
      if (t >= minWatchSeconds) api.user.setPosition(content.id, t)
    }

    // Completion detection
    const onTimeUpdate = () => {
      if (completionMarkedRef.current) return
      const art = artRef.current
      if (!art || !art.duration || art.duration < 30) return
      if (art.currentTime / art.duration > 0.92) {
        completionMarkedRef.current = true
        api.user.setCompleted(content.id)
      }
    }

    const onEnded = () => {
      if (!completionMarkedRef.current) {
        completionMarkedRef.current = true
        api.user.setCompleted(content.id)
      }
    }

    // Attach events after a tick (ArtPlayer needs to be ready)
    const attachTimer = setTimeout(() => {
      const art = artRef.current
      if (!art) return
      art.on('pause', onPause)
      art.on('video:timeupdate', onTimeUpdate)
      art.on('video:ended', onEnded)
    }, 1000)

    return () => {
      clearInterval(saveInterval)
      clearTimeout(attachTimer)
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
      // Save position on unmount, then invalidate after IPC resolves
      const art = artRef.current
      const t = art ? Math.floor(art.currentTime) : 0
      const invalidateAll = () => {
        qc.invalidateQueries({ queryKey: ['home-continue'] })
        qc.invalidateQueries({ queryKey: ['library', 'continue-watching'] })
      }
      if (t >= minWatchSeconds) {
        api.user.setPosition(content.id, t).then(invalidateAll).catch(invalidateAll)
      } else {
        invalidateAll()
      }
    }
  }, [content.id, content.type, qc, minWatchSeconds])

  const handleResume = () => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    const art = artRef.current
    if (art && resumePrompt) art.seek = resumePrompt
    setResumePrompt(null)
  }

  const handleStartOver = () => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    setResumePrompt(null)
  }

  // Keyboard: Escape to close, D for debug, arrows for seek/volume
  // Seek: 1 press = ±5s, 2 quick presses = ±10s, 3+ quick presses = ±25s
  useEffect(() => {
    const showOsd = (text: string, icon: 'seek-back' | 'seek-fwd' | 'vol-up' | 'vol-down') => {
      setOsd({ text, icon })
      if (osdTimer.current) clearTimeout(osdTimer.current)
      osdTimer.current = setTimeout(() => setOsd(null), 1200)
    }

    // Multi-click seek state
    const seekState = { dir: 0 as -1 | 1 | 0, count: 0, timer: null as ReturnType<typeof setTimeout> | null }
    const SEEK_AMOUNTS = [5, 10, 25] // 1 press, 2 presses, 3+ presses
    const SEEK_WINDOW_MS = 400

    const commitSeek = () => {
      const art = artRef.current
      if (!art || seekState.dir === 0) return
      const amount = SEEK_AMOUNTS[Math.min(seekState.count, SEEK_AMOUNTS.length) - 1]
      const delta = seekState.dir * amount
      art.seek = Math.max(0, Math.min(art.duration, art.currentTime + delta))
      showOsd(`${delta > 0 ? '+' : ''}${delta}s`, delta > 0 ? 'seek-fwd' : 'seek-back')
      seekState.dir = 0
      seekState.count = 0
    }

    const handler = (e: KeyboardEvent) => {
      // Stop propagation so SearchBar/other handlers don't also fire
      e.stopImmediatePropagation()
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'd' || e.key === 'D') { setShowDebug((x) => !x); return }
      const art = artRef.current
      if (!art) return

      if (e.key === ' ') {
        e.preventDefault()
        art.playing ? art.pause() : art.play()
        return
      }

      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        art.fullscreen = !art.fullscreen
        return
      }

      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        art.muted = !art.muted
        showOsd(art.muted ? 'Muted' : `${Math.round(art.volume * 100)}%`, 'vol-up')
        return
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const dir = e.key === 'ArrowRight' ? 1 : -1
        if (seekState.dir !== 0 && seekState.dir !== dir) {
          // Direction changed — commit previous seek immediately
          if (seekState.timer) clearTimeout(seekState.timer)
          commitSeek()
        }
        seekState.dir = dir as 1 | -1
        seekState.count += 1
        const amount = SEEK_AMOUNTS[Math.min(seekState.count, SEEK_AMOUNTS.length) - 1]
        // Show preview OSD while accumulating
        showOsd(`${dir > 0 ? '+' : '-'}${amount}s`, dir > 0 ? 'seek-fwd' : 'seek-back')
        if (seekState.timer) clearTimeout(seekState.timer)
        seekState.timer = setTimeout(() => { commitSeek() }, SEEK_WINDOW_MS)
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        const vol = Math.min(1, art.volume + 0.1)
        art.volume = vol
        showOsd(`${Math.round(vol * 100)}%`, 'vol-up')
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const vol = Math.max(0, art.volume - 0.1)
        art.volume = vol
        showOsd(vol === 0 ? 'Muted' : `${Math.round(vol * 100)}%`, 'vol-down')
      }
    }
    // Use capture phase so Player's handler fires BEFORE SearchBar's bubble-phase handler
    window.addEventListener('keydown', handler, true)
    return () => {
      window.removeEventListener('keydown', handler, true)
      if (osdTimer.current) clearTimeout(osdTimer.current)
      if (seekState.timer) clearTimeout(seekState.timer)
    }
  }, [onClose])

  const fmt = (s: number) => {
    if (!isFinite(s)) return '--:--'
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60)
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
      : `${m}:${String(ss).padStart(2, '0')}`
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, background: '#000', isolation: 'isolate' }}>

      {/* Close button — always visible */}
      <button
        onClick={onClose}
        title="Close (Esc)"
        style={{
          position: 'absolute', top: 14, left: 14, zIndex: 100,
          width: 36, height: 36, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.12)',
          color: '#fff', cursor: 'pointer', backdropFilter: 'blur(8px)',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.85)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.6)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
        </svg>
      </button>

      {/* ArtPlayer container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Audio-only visualizer overlay (radio stations) */}
      <AnimatePresence>
        {isAudioOnly && !loading && !error && (
          <motion.div
            key="audio-viz"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            style={{
              position: 'absolute', inset: 0, zIndex: 80,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: 'radial-gradient(ellipse at center, rgba(20,10,40,0.95) 0%, rgba(5,5,15,0.98) 100%)',
              pointerEvents: 'none',
            }}
          >
            {/* Station poster/logo */}
            {content.poster_url && (
              <img
                src={content.poster_url}
                alt=""
                style={{
                  width: 120, height: 120, borderRadius: 20,
                  objectFit: 'cover', marginBottom: 24,
                  boxShadow: '0 8px 32px rgba(124,77,255,0.3)',
                  border: '2px solid rgba(124,77,255,0.25)',
                }}
              />
            )}
            {/* Station name */}
            <div style={{
              fontSize: 22, fontWeight: 700, color: '#fff',
              letterSpacing: '-0.02em', marginBottom: 8,
              textAlign: 'center', padding: '0 40px',
              textShadow: '0 2px 12px rgba(0,0,0,0.5)',
            }}>
              {content.title}
            </div>
            <div style={{
              fontSize: 12, color: 'rgba(255,255,255,0.4)',
              marginBottom: 32, letterSpacing: '0.05em', textTransform: 'uppercase',
            }}>
              Now Playing
            </div>
            {/* Real-time audio visualizer */}
            <AudioVisualizer />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Resume prompt */}
      <AnimatePresence>
        {resumePrompt !== null && !loading && !error && (
          <motion.div
            key="resume"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.25 }}
            style={{
              position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
              zIndex: 96, display: 'flex', alignItems: 'center', gap: 12,
              background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
              borderRadius: 12, padding: '12px 20px',
              border: '1px solid rgba(124,77,255,0.3)',
            }}
          >
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
              Resume from {fmt(resumePrompt)}?
            </span>
            <button onClick={handleResume}
              style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#7c4dff', color: '#fff', border: 'none', cursor: 'pointer' }}>
              Resume
            </button>
            <button onClick={handleStartOver}
              style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', border: 'none', cursor: 'pointer' }}>
              Start Over
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading overlay */}
      <AnimatePresence>
        {loading && (
          <motion.div key="loader" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, pointerEvents: 'none', zIndex: 90 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', border: '2px solid rgba(124,77,255,0.25)', borderTopColor: '#7c4dff', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{content.title}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error overlay */}
      <AnimatePresence>
        {error && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32, zIndex: 90 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#f87171', marginBottom: 6 }}>Playback failed</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{error}</p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onClose}
                style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 500, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: 'none', cursor: 'pointer' }}>
                Go back
              </button>
              <button onClick={() => setShowDebug((x) => !x)}
                style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 500, background: 'rgba(124,77,255,0.15)', color: '#b388ff', border: 'none', cursor: 'pointer' }}>
                Stream info
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Arrow key OSD */}
      <AnimatePresence>
        {osd && (
          <motion.div
            key={osd.text + osd.icon}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.12 }}
            style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 95, pointerEvents: 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(10px)',
              borderRadius: 16, padding: '18px 28px',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <OsdIcon type={osd.icon} />
            <span style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>
              {osd.text}
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
              {osd.icon.startsWith('seek') ? 'seek' : 'volume'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stream info panel (D key to toggle) */}
      <AnimatePresence>
        {showDebug && (
          <motion.div
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            style={{
              position: 'absolute', top: 16, right: 16, zIndex: 100,
              width: 380, maxWidth: 'calc(100vw - 32px)',
              background: 'rgba(10,10,20,0.95)', border: '1px solid rgba(124,77,255,0.25)',
              borderRadius: 12, padding: 16, backdropFilter: 'blur(12px)',
              fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7,
            }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ color: '#b388ff', fontWeight: 700, fontSize: 12 }}>Stream Info</span>
              <button onClick={(e) => { e.stopPropagation(); setShowDebug(false) }}
                style={{ width: 24, height: 24, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', border: 'none', cursor: 'pointer', pointerEvents: 'auto', position: 'relative', zIndex: 101 }}>
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l10 10M11 1L1 11" /></svg>
              </button>
            </div>
            <Row label="title" value={content.title} />
            <Row label="content id" value={content.id} />
            <Row label="type" value={content.type} />
            <Row label="stream url" value={streamUrl ?? (loading ? 'resolving…' : 'not set')}
              color={error ? '#f87171' : streamUrl ? '#86efac' : 'rgba(255,255,255,0.5)'} copyable />
            {error && <Row label="error" value={error} color="#f87171" />}
            <Row label="player" value={`ArtPlayer ${Artplayer.version} + hls.js ${Hls.version}`} />
            <Row label="hls supported" value={String(Hls.isSupported())} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AudioVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Animated bars — no Web Audio API, no audio routing hijack
    const BAR_COUNT = 48
    const BAR_GAP = 3
    const BAR_RADIUS = 2
    const phases = Array.from({ length: BAR_COUNT }, (_, i) => Math.random() * Math.PI * 2)
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
        const barH = Math.max(3, val * h * 0.8)
        const x = i * (barW + BAR_GAP)
        const y = (h - barH) / 2

        const hue = 260 + (i / BAR_COUNT) * 80
        const lightness = 50 + val * 25
        ctx.fillStyle = `hsla(${hue}, 80%, ${lightness}%, 0.85)`
        ctx.beginPath()
        ctx.roundRect(x, y, barW, barH, BAR_RADIUS)
        ctx.fill()

        ctx.fillStyle = `hsla(${hue}, 80%, ${lightness}%, 0.12)`
        ctx.beginPath()
        ctx.roundRect(x, y + barH + 2, barW, barH * 0.3, BAR_RADIUS)
        ctx.fill()
      }
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '60%', maxWidth: 500, height: 120,
        opacity: 0.9,
      }}
    />
  )
}


function OsdIcon({ type }: { type: 'seek-back' | 'seek-fwd' | 'vol-up' | 'vol-down' }) {
  const s = { width: 32, height: 32, color: '#fff' }
  if (type === 'seek-back') return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 19 2 12 11 5 11 19" fill="currentColor" stroke="none" opacity={0.9} />
      <polygon points="22 19 13 12 22 5 22 19" fill="currentColor" stroke="none" opacity={0.5} />
    </svg>
  )
  if (type === 'seek-fwd') return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 19 22 12 13 5 13 19" fill="currentColor" stroke="none" opacity={0.9} />
      <polygon points="2 19 11 12 2 5 2 19" fill="currentColor" stroke="none" opacity={0.5} />
    </svg>
  )
  if (type === 'vol-up') return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" opacity={0.5} />
    </svg>
  )
  return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

function Row({ label, value, color, copyable }: { label: string; value: string; color?: string; copyable?: boolean }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={{ color: 'rgba(255,255,255,0.3)' }}>{label}: </span>
      <span className={copyable ? 'cursor-pointer' : ''} style={{ color: color ?? 'rgba(255,255,255,0.75)', wordBreak: 'break-all' }}
        title={copyable ? 'Click to copy' : undefined}
        onClick={copyable && value ? () => navigator.clipboard.writeText(value) : undefined}>
        {value}
      </span>
    </div>
  )
}
