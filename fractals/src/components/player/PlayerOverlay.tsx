import { useEffect, useRef, useState, useCallback, useMemo, type CSSProperties } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Hls from 'hls.js'
import Artplayer from 'artplayer'
import { motion, AnimatePresence } from 'framer-motion'
import { ContentItem } from '@/lib/types'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app.store'
import { ChannelSurfer } from '@/components/live/ChannelSurfer'
import { TimeshiftBar } from './TimeshiftBar'
import { useSourcesStore } from '@/stores/sources.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'

interface Props {
  content: ContentItem | null
  mode: 'hidden' | 'fullscreen' | 'mini' | 'embedded'
  onClose: () => void
  onMinimize: () => void
  onExpand: () => void
  onSurfChannel?: (dir: 1 | -1) => ContentItem | null
  onSurfEpisode?: (dir: 1 | -1) => ContentItem | null
  onChipClick?: (content: ContentItem) => void
}

const FULLSCREEN_STYLE: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  zIndex: 60, background: '#000', isolation: 'isolate',
}

const MINI_STYLE: React.CSSProperties = {
  position: 'fixed', bottom: 20, right: 20,
  width: 400, height: 225,
  zIndex: 200, borderRadius: 12, overflow: 'hidden',
  boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
  border: '1px solid rgba(255,255,255,0.12)',
  background: '#000',
}

export function PlayerOverlay({ content, mode, onClose, onMinimize, onExpand, onSurfChannel, onSurfEpisode, onChipClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<Artplayer | null>(null)
  const qc = useQueryClient()
  const minWatchSeconds = useAppStore((s) => s.minWatchSeconds)
  const controlsMode = useAppStore((s) => s.controlsMode)
  const episodeSurfList = useAppStore((s) => s.episodeSurfList)
  const episodeSurfIndex = useAppStore((s) => s.episodeSurfIndex)
  const sources = useSourcesStore((s) => s.sources)
  const colorMap = useMemo(() => buildColorMapFromSources(sources), [sources])

  // localContent drives all UI — decoupled from ArtPlayer rebuild cycle
  const [localContent, setLocalContent] = useState<ContentItem | null>(content)
  useEffect(() => { if (content) setLocalContent(content) }, [content?.id])

  // EPG: fetch now/next for live channels, refresh every 60s
  const [epgNowNext, setEpgNowNext] = useState<{ now: any; next: any } | null>(null)
  useEffect(() => {
    if (!content || content.type !== 'live') return
    let alive = true
    const fetch = () => api.epg.nowNext(content.id).then((d) => { if (alive) setEpgNowNext(d) }).catch(() => {})
    fetch()
    const t = setInterval(fetch, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [content?.id, content?.type])

  const srcColor = localContent
    ? colorMap[localContent.primarySourceId ?? localContent.primary_source_id ?? (localContent as any).source_ids ?? localContent.id?.split(':')[0] ?? '']
    : null

  // Controls visibility — mirrors ArtPlayer autoHide so chip fades with the bar
  const [showControls, setShowControls] = useState(false)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlePlayerMouseMove = useCallback(() => {
    setShowControls(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    if (controlsMode === 'always') return
    const ms = controlsMode === 'never' ? 1500
      : controlsMode === 'auto-2' ? 2000
      : controlsMode === 'auto-3' ? 3000
      : 5000
    controlsTimerRef.current = setTimeout(() => setShowControls(false), ms)
  }, [controlsMode])

  // Category name — fetched for VOD on content change.
  // For episodes, look up via parent series id (episodes don't carry category_name).
  const [categoryName, setCategoryName] = useState<string | null>(null)
  useEffect(() => {
    setCategoryName(null)
    if (!content) return
    if (content.category_name) { setCategoryName(content.category_name.split(',')[0]); return }
    const parent = (content as any)._parent
    const lookupId = parent?.id ?? content.id
    api.content.get(lookupId).then((item: any) => {
      if (item?.category_name) setCategoryName(item.category_name.split(',')[0])
    })
  }, [content?.id, content?.type])

  // Player state
  const [playerState, setPlayerState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [isAudioOnly, setIsAudioOnly] = useState(false)
  const isAudioOnlyRef = useRef(false)
  const [osd, setOsd] = useState<{ text: string; icon: 'seek-back' | 'seek-fwd' | 'vol-up' | 'vol-down' } | null>(null)
  const osdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [resumePrompt, setResumePrompt] = useState<number | null>(null)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showSurfer, setShowSurfer] = useState(false)
  const surferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const completionMarkedRef = useRef(false)
  const suppressRebuildRef = useRef(false)
  const switchSeqRef = useRef(0)
  const [isOsFullscreen, setIsOsFullscreen] = useState(false)
  const [reconnectAttempt, setReconnectAttempt] = useState<number | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const MAX_RECONNECT = 5
  const RECONNECT_BACKOFF = [2000, 4000, 8000, 16000, 32000]

  // Embedded mode — track anchor element rect via ResizeObserver
  const embeddedAnchor = useAppStore((s) => s.embeddedAnchor)
  const [embeddedRect, setEmbeddedRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    if (mode !== 'embedded' || !embeddedAnchor) { setEmbeddedRect(null); return }
    const update = () => setEmbeddedRect(embeddedAnchor.getBoundingClientRect())
    update()
    const ro = new ResizeObserver(update)
    ro.observe(embeddedAnchor)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { ro.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [mode, embeddedAnchor])

  // Loading elapsed timer
  const [loadingElapsed, setLoadingElapsed] = useState(0)
  useEffect(() => {
    if (playerState !== 'loading') { setLoadingElapsed(0); return }
    const t = setInterval(() => setLoadingElapsed((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [playerState])

  // Timeshift state
  const [isTimeshift, setIsTimeshift] = useState(false)
  const [timeshiftProg, setTimeshiftProg] = useState<{ id: string; title: string; startTime: number; endTime: number } | null>(null)
  const catchupSupported = !!(localContent as any)?.catchup_supported
  const catchupDays = (localContent as any)?.catchup_days ?? 0
  const liveStreamUrlRef = useRef<string | null>(null)

  const fmt = (s: number) => {
    if (!isFinite(s)) return '--:--'
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60)
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
      : `${m}:${String(ss).padStart(2, '0')}`
  }

  // ── ArtPlayer init / stream load ─────────────────────────────────────────
  useEffect(() => {
    if (!content) return
    // In-place channel switch — HLS already swapped, skip rebuild
    if (suppressRebuildRef.current) {
      suppressRebuildRef.current = false
      return
    }

    let cancelled = false
    let loadingTimerId: ReturnType<typeof setTimeout> | null = null
    const clearLoadingTimer = () => { if (loadingTimerId !== null) { clearTimeout(loadingTimerId); loadingTimerId = null } }

    setPlayerState('loading')
    setError(null)
    setStreamUrl(null)
    setIsAudioOnly(false); isAudioOnlyRef.current = false
    setIsTimeshift(false)
    setTimeshiftProg(null)
    completionMarkedRef.current = false

    // Episodes carry stream data directly
    const urlPromise: Promise<any> = (content as any)._streamId
      ? Promise.resolve({
          url: `${(content as any)._serverUrl.replace(/\/$/, '')}/series/${encodeURIComponent((content as any)._username)}/${encodeURIComponent((content as any)._password)}/${(content as any)._streamId}.${(content as any)._extension ?? 'mkv'}`
        })
      : api.content.getStreamUrl({ contentId: content.id })

    urlPromise.then((result: any) => {
      if (cancelled) return
      if (!result?.url) {
        setError(result?.error ?? 'Could not get stream URL')
        setPlayerState('error')
        return
      }

      const url: string = result.url
      const streamHeaders: Record<string, string> | undefined = result.headers
      setStreamUrl(url)
      if (content.type === 'live') liveStreamUrlRef.current = url

      // 12s timeout — show error if stream never starts
      loadingTimerId = setTimeout(() => {
        if (!cancelled) {
          setError('Stream not responding — check your connection')
          setPlayerState('error')
        }
      }, 12000)

      // External player preference
      const pref = localStorage.getItem('fractals-player') as 'artplayer' | 'mpv' | 'vlc' | null
      if (pref === 'mpv' || pref === 'vlc') {
        const customPath = localStorage.getItem(`fractals-player-${pref}-path`) ?? undefined
        api.player.openExternal({ player: pref, url, title: content.title, customPath, headers: streamHeaders }).then((res: any) => {
          if (cancelled) return
          clearLoadingTimer()
          if (res?.success) { onClose() } else { setError(`Failed to launch ${pref.toUpperCase()}: ${res?.error ?? 'not found'}`); setPlayerState('error') }
        })
        return
      }

      if (!containerRef.current) return

      const isHls = url.includes('.m3u8') || url.includes('m3u8')
      const isLive = content.type === 'live'
      const autoHideMs = controlsMode === 'never' ? 1
        : controlsMode === 'auto-2' ? 2000
        : controlsMode === 'auto-3' ? 3000
        : controlsMode === 'auto-5' ? 5000
        : 0

      // Destroy previous ArtPlayer instance if it exists
      if (artRef.current) {
        const oldHls = (artRef.current as any).hls
        oldHls?.destroy()
        artRef.current.destroy()
        artRef.current = null
      }

      const savedVolume = parseFloat(localStorage.getItem('fractals-volume') ?? '1')

      const art = new Artplayer({
        container: containerRef.current,
        url,
        autoplay: true,
        volume: isNaN(savedVolume) ? 1 : Math.max(0, Math.min(1, savedVolume)),
        ...({ autoHide: autoHideMs === 0 ? false : autoHideMs } as Record<string, unknown>),
        pip: false,
        fullscreen: false, // OS fullscreen handled via Electron IPC
        hotkey: false,     // All keyboard handling done in our own handler
        playbackRate: !isLive,
        aspectRatio: true,
        setting: false,
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
        airplay: false,
        theme: '#7c4dff',
        lang: 'en',
        isLive,
        moreVideoAttr: { crossOrigin: 'anonymous' },
        ...(isHls && Hls.isSupported() && {
          customType: {
            m3u8: (video: HTMLVideoElement, src: string) => {
              const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: isLive,
                // Referer works; User-Agent and Origin are forbidden header names
              // in browsers — silently ignored here but work in mpv/VLC.
              ...(streamHeaders && {
                  xhrSetup: (xhr: XMLHttpRequest) => {
                    for (const [k, v] of Object.entries(streamHeaders)) {
                      try { xhr.setRequestHeader(k, v) } catch {}
                    }
                  },
                }),
              })
              ;(art as any).hls = hls
              hls.loadSource(src)
              hls.attachMedia(video)
              let reconnectCount = 0
              hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
                if (data.fatal && !cancelled) {
                  if (reconnectCount < MAX_RECONNECT) {
                    reconnectCount++
                    setReconnectAttempt(reconnectCount)
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
                    setPlayerState('error')
                  }
                }
              })
            },
          },
        }),
      })

      artRef.current = art

      art.on('ready', () => {
        clearLoadingTimer()
        if (!cancelled) setPlayerState('playing')

        // Hide ArtPlayer's live badge (we have our own)
        const liveEdge = containerRef.current?.querySelector('.art-live-edge') as HTMLElement | null
        if (liveEdge) liveEdge.style.setProperty('display', 'none', 'important')
        if (controlsMode === 'never') {
          const bottom = containerRef.current?.querySelector('.art-bottom') as HTMLElement | null
          if (bottom) bottom.style.setProperty('display', 'none', 'important')
        }

        // Audio-only detection (once on metadata + 3s fallback)
        const video = art.template.$video as HTMLVideoElement
        if (video) {
          const checkAudioOnly = () => {
            if (cancelled || isAudioOnlyRef.current) return
            if (video.videoWidth === 0 && video.videoHeight === 0) { setIsAudioOnly(true); isAudioOnlyRef.current = true }
          }
          video.addEventListener('loadedmetadata', checkAudioOnly, { once: true })
          setTimeout(checkAudioOnly, 3000)
        }

        // Fix progress bar click/drag seek (ArtPlayer HiDPI bug)
        if (!isLive) {
          const progressEl = (art.template as any).$progress as HTMLElement | undefined
          if (progressEl) {
            const trackEl = (progressEl.querySelector('.art-control-progress-inner') ?? progressEl) as HTMLElement
            const computePct = (clientX: number) => {
              const r = trackEl.getBoundingClientRect()
              return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
            }
            progressEl.addEventListener('mousemove', (e: MouseEvent) => {
              const pct = computePct(e.clientX)
              const hover = progressEl.querySelector('.art-progress-hover') as HTMLElement | null
              const tip = progressEl.querySelector('.art-progress-tip') as HTMLElement | null
              if (hover) hover.style.width = `${pct * 100}%`
              if (tip) { tip.textContent = fmt(pct * art.duration); tip.style.left = `${pct * 100}%` }
              e.stopImmediatePropagation()
            }, { capture: true })
            progressEl.addEventListener('click', (e: MouseEvent) => {
              e.stopImmediatePropagation()
            }, { capture: true })
            progressEl.addEventListener('mousedown', (e: MouseEvent) => {
              e.stopImmediatePropagation()
              e.preventDefault()
              const applySeek = (pct: number) => { art.emit('setBar', 'played', pct); art.seek = pct * art.duration }
              applySeek(computePct(e.clientX))
              const onMove = (ev: MouseEvent) => applySeek(computePct(ev.clientX))
              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
              document.addEventListener('mousemove', onMove)
              document.addEventListener('mouseup', onUp)
            }, { capture: true })
          }
        }
      })

      art.on('video:playing', () => {
        clearLoadingTimer()
        if (!cancelled) { setError(null); setPlayerState('playing') }
      })

      ;(art as any).on('error', (_e: any, msg: string) => {
        clearLoadingTimer()
        if (!cancelled) {
          const video = art.template?.$video as HTMLVideoElement | undefined
          if (video && !video.paused && video.currentTime > 0) return
          setError(msg || 'Playback error')
          setPlayerState('error')
        }
      })
    })

    return () => {
      if (suppressRebuildRef.current) return
      cancelled = true
      clearLoadingTimer()
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
      setReconnectAttempt(null)
      if (artRef.current) {
        const hls = (artRef.current as any).hls
        hls?.destroy()
        artRef.current.destroy()
        artRef.current = null
      }
    }
  }, [content?.id, content?.type])

  // ── Resize ArtPlayer on mode change ──────────────────────────────────────
  // Do NOT pause on mode='hidden' — stream teardown is driven by content→null in the init effect.
  // Pausing here would stall the stream during the transient hidden→embedded transition
  // that occurs when minimizing fullscreen back to an anchor panel.
  useEffect(() => {
    if (mode === 'hidden') return
    // Resize after layout settles (embedded rect may differ from fullscreen dims)
    const t = setTimeout(() => (artRef.current as any)?.resize?.(), 100)
    return () => clearTimeout(t)
  }, [mode, embeddedRect])

  // ── Position save + resume + completion (skip live) ──────────────────────
  useEffect(() => {
    if (!content || content.type === 'live') return

    const invalidateContinue = () => {
      qc.invalidateQueries({ queryKey: ['home-continue'] })
      qc.invalidateQueries({ queryKey: ['library', 'continue-watching'] })
    }

    // _startAt: direct handoff from mini player — seek immediately, no prompt
    const startAt = (content as any)._startAt as number | undefined
    if (startAt && startAt > 5) {
      const trySeek = (attempts = 0) => {
        const art = artRef.current
        if (art && art.duration > 0) { art.seek = startAt; return }
        if (attempts < 20) setTimeout(() => trySeek(attempts + 1), 200)
      }
      setTimeout(() => trySeek(), 300)
    } else {
      // In embedded mode — silently seek to saved position (no prompt)
      // In fullscreen mode — show resume prompt
      api.user.getData(content.id).then((data: any) => {
        if (!data?.last_position || data.last_position <= 5 || data.completed) return
        if (useAppStore.getState().playerMode === 'embedded') {
          const trySeek = (attempts = 0) => {
            const art = artRef.current
            if (art && art.duration > 0) { art.seek = data.last_position; return }
            if (attempts < 20) setTimeout(() => trySeek(attempts + 1), 200)
          }
          setTimeout(() => trySeek(), 300)
        } else {
          setResumePrompt(data.last_position)
          // Auto-dismiss timer starts in the playerState === 'playing' effect below
        }
      })
    }

    // Save every 10s while playing. Invalidate continue-watching so the strips
    // light up mid-session (user may still be in mini-player watching).
    const saveInterval = setInterval(() => {
      const art = artRef.current
      if (!art || !art.playing) return
      const t = Math.floor(art.currentTime)
      if (t >= minWatchSeconds) api.user.setPosition(content.id, t).then(invalidateContinue)
    }, 10000)

    // Save on pause
    const attachTimer = setTimeout(() => {
      const art = artRef.current
      if (!art) return
      art.on('pause', () => {
        const t = Math.floor(art.currentTime)
        if (t >= minWatchSeconds) api.user.setPosition(content.id, t).then(invalidateContinue)
      })
      // Completion at 92%
      art.on('video:timeupdate', () => {
        if (completionMarkedRef.current) return
        if (!art.duration || art.duration < 30) return
        if (art.currentTime < minWatchSeconds) return
        if (art.currentTime / art.duration > 0.92) {
          completionMarkedRef.current = true
          api.user.setCompleted(content.id)
        }
      })
      art.on('video:ended', () => {
        if (!completionMarkedRef.current) {
          completionMarkedRef.current = true
          api.user.setCompleted(content.id)
        }
      })
    }, 1000)

    return () => {
      clearInterval(saveInterval)
      clearTimeout(attachTimer)
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
      // Save position on unmount (mode change to hidden or content change)
      const art = artRef.current
      const t = art ? Math.floor(art.currentTime) : 0
      if (t >= minWatchSeconds) {
        api.user.setPosition(content.id, t).then(invalidateContinue).catch(invalidateContinue)
      } else {
        invalidateContinue()
      }
    }
  }, [content?.id, content?.type, qc, minWatchSeconds])

  // ── Resume auto-dismiss: wait for player to be ready before starting 5s timer
  useEffect(() => {
    if (playerState !== 'playing' || resumePrompt === null) return
    resumeTimerRef.current = setTimeout(() => {
      const art = artRef.current
      if (art && resumePrompt > 0) art.seek = resumePrompt
      setResumePrompt(null)
    }, 5000)
    return () => { if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current) }
  }, [playerState, resumePrompt])

  // ── In-place channel switch ───────────────────────────────────────────────
  const doChannelSwitch = useCallback((next: ContentItem) => {
    const seq = ++switchSeqRef.current
    setLocalContent(next)
    setIsAudioOnly(false); isAudioOnlyRef.current = false
    setPlayerState('loading')
    setError(null)
    setLoadingElapsed(0)
    setShowSurfer(true)
    if (surferTimerRef.current) clearTimeout(surferTimerRef.current)
    surferTimerRef.current = setTimeout(() => setShowSurfer(false), 3000)

    suppressRebuildRef.current = true
    useAppStore.getState().setPlayingContent(next)

    const art = artRef.current
    if (!art) return

    api.content.getStreamUrl({ contentId: next.id }).then((result: any) => {
      if (seq !== switchSeqRef.current) return // stale — a newer switch won the race
      if (!result?.url || !artRef.current) return
      const url: string = result.url
      const video = artRef.current.template.$video as HTMLVideoElement
      const isHls = url.includes('.m3u8') || url.includes('m3u8')
      const oldHls = (artRef.current as any).hls
      oldHls?.destroy()
      ;(artRef.current as any).hls = null
      if (isHls && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true })
        ;(artRef.current as any).hls = hls
        hls.loadSource(url)
        hls.attachMedia(video)
      } else {
        video.src = url; video.load(); video.play().catch(() => {})
      }
    })
  }, [])

  // ── Timeshift ─────────────────────────────────────────────────────────────
  const switchToUrl = useCallback((url: string) => {
    const art = artRef.current
    if (!art) return
    const video = art.template.$video as HTMLVideoElement
    const isHls = url.includes('.m3u8') || url.includes('m3u8')
    const oldHls = (art as any).hls
    oldHls?.destroy();(art as any).hls = null
    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true })
      ;(art as any).hls = hls; hls.loadSource(url); hls.attachMedia(video)
    } else {
      video.src = url; video.load(); video.play().catch(() => {})
    }
  }, [])

  // Catchup playback — wired up when TimeshiftBar is integrated
  // const handlePlayCatchup = useCallback(async (prog: { id: string; title: string; startTime: number; endTime: number }) => {
  //   if (!localContent) return
  //   const result = await api.content.getCatchupUrl({ contentId: localContent.id, startTime: prog.startTime, duration: prog.endTime - prog.startTime })
  //   if (!result?.url) { setError('Catchup not available for this programme'); setPlayerState('error'); return }
  //   switchToUrl(result.url); setIsTimeshift(true); setTimeshiftProg(prog)
  // }, [localContent, switchToUrl])

  const handleGoLive = useCallback(() => {
    const liveUrl = liveStreamUrlRef.current
    if (liveUrl) switchToUrl(liveUrl)
    setIsTimeshift(false)
    setTimeshiftProg(null)
  }, [switchToUrl])

  // ── Resume handlers ───────────────────────────────────────────────────────
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

  // ── OSD helper ────────────────────────────────────────────────────────────
  const showOsd = useCallback((text: string, icon: 'seek-back' | 'seek-fwd' | 'vol-up' | 'vol-down') => {
    setOsd({ text, icon })
    if (osdTimer.current) clearTimeout(osdTimer.current)
    osdTimer.current = setTimeout(() => setOsd(null), 1200)
  }, [])

  // ── Keyboard handler ──────────────────────────────────────────────────────
  // Single handler, capture phase. Only active when fullscreen or mini.
  useEffect(() => {
    if (mode === 'hidden' || mode === 'embedded') return

    const seekState = { dir: 0 as -1 | 1 | 0, count: 0, timer: null as ReturnType<typeof setTimeout> | null }
    const SEEK_AMOUNTS = [5, 10, 25]
    const SEEK_WINDOW_MS = 400
    let lastSeekTime = 0

    const commitSeek = () => {
      const art = artRef.current
      if (!art || seekState.dir === 0) return
      const now = Date.now()
      if (now - lastSeekTime < 300) { seekState.timer = setTimeout(commitSeek, 300); return }
      lastSeekTime = now
      const amount = SEEK_AMOUNTS[Math.min(seekState.count, SEEK_AMOUNTS.length) - 1]
      const delta = seekState.dir * amount
      art.seek = Math.max(0, Math.min(art.duration, art.currentTime + delta))
      showOsd(`${delta > 0 ? '+' : ''}${delta}s`, delta > 0 ? 'seek-fwd' : 'seek-back')
      seekState.dir = 0; seekState.count = 0
    }

    const handler = (e: KeyboardEvent) => {
      e.stopImmediatePropagation()

      // ── Escape hierarchy ──
      if (e.key === 'Escape') {
        if (isOsFullscreen) {
          api.window.toggleFullscreen()
          setIsOsFullscreen(false)
          if (localContent?.type !== 'live') onMinimize()
          // Live: exit OS fullscreen → stay in windowed mode → next Esc closes
        } else if (mode === 'mini') {
          onClose()
        } else {
          // Windowed fullscreen
          onMinimize()
        }
        return
      }

      // ── Debug ──
      if (e.key === 'd' || e.key === 'D') { setShowDebug((x) => !x); return }

      // ── Mini-player: only Esc + expand work ──
      if (mode === 'mini') return

      // ── OS fullscreen toggle ──
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        api.window.toggleFullscreen()
        setIsOsFullscreen((f) => !f)
        return
      }

      // ── Channel surf (live only) ──
      if (localContent?.type === 'live' && onSurfChannel) {
        const isMacUp = e.metaKey && e.key === 'ArrowUp'
        const isMacDown = e.metaKey && e.key === 'ArrowDown'
        const dir = (e.key === 'PageUp' || isMacUp || e.key === '[') ? -1 : (e.key === 'PageDown' || isMacDown || e.key === ']') ? 1 : null
        if (dir !== null) {
          e.preventDefault()
          const next = onSurfChannel(dir)
          if (next) doChannelSwitch(next)
          return
        }
      }

      // ── Episode surf (series episodes only) ──
      if (localContent?._parent && onSurfEpisode) {
        const isMacUp = e.metaKey && e.key === 'ArrowUp'
        const isMacDown = e.metaKey && e.key === 'ArrowDown'
        const dir = (e.key === 'PageUp' || isMacUp) ? -1 : (e.key === 'PageDown' || isMacDown) ? 1 : null
        if (dir !== null) {
          e.preventDefault()
          onSurfEpisode(dir)
          return
        }
      }

      const art = artRef.current
      if (!art) return

      // ── Play/pause ──
      if (e.key === ' ') {
        e.preventDefault()
        if (localContent?.type !== 'live') { art.playing ? art.pause() : art.play() }
        return
      }

      // ── Mute ──
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        art.muted = !art.muted
        showOsd(art.muted ? 'Muted' : `${Math.round(art.volume * 100)}%`, 'vol-up')
        return
      }

      // ── Volume ──
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        const vol = Math.min(1, art.volume + 0.1)
        art.volume = vol
        localStorage.setItem('fractals-volume', String(vol))
        showOsd(`${Math.round(vol * 100)}%`, 'vol-up')
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const vol = Math.max(0, art.volume - 0.1)
        art.volume = vol
        localStorage.setItem('fractals-volume', String(vol))
        showOsd(vol === 0 ? 'Muted' : `${Math.round(vol * 100)}%`, 'vol-down')
        return
      }

      // ── Seek (films/series only — not live unless timeshift) ──
      if (localContent?.type !== 'live' || isTimeshift) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          const dir = e.key === 'ArrowRight' ? 1 : -1
          if (seekState.dir !== 0 && seekState.dir !== dir) {
            if (seekState.timer) clearTimeout(seekState.timer)
            commitSeek()
          }
          seekState.dir = dir as 1 | -1
          seekState.count += 1
          const amount = SEEK_AMOUNTS[Math.min(seekState.count, SEEK_AMOUNTS.length) - 1]
          showOsd(`${dir > 0 ? '+' : '-'}${amount}s`, dir > 0 ? 'seek-fwd' : 'seek-back')
          if (seekState.timer) clearTimeout(seekState.timer)
          seekState.timer = setTimeout(commitSeek, SEEK_WINDOW_MS)
          return
        }
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => {
      window.removeEventListener('keydown', handler, true)
      if (osdTimer.current) { clearTimeout(osdTimer.current); osdTimer.current = null }
      setOsd(null)
      if (seekState.timer) clearTimeout(seekState.timer)
    }
  }, [mode, isOsFullscreen, localContent?.type, localContent?._parent, isTimeshift, onClose, onMinimize, onSurfChannel, onSurfEpisode, doChannelSwitch, showOsd])

  // ── Render ────────────────────────────────────────────────────────────────
  const containerStyle: React.CSSProperties = mode === 'hidden'
    ? { display: 'none' }
    : mode === 'mini' ? MINI_STYLE
    : mode === 'embedded'
      ? embeddedRect
        ? { position: 'fixed', top: embeddedRect.top, left: embeddedRect.left, width: embeddedRect.width, height: embeddedRect.height, zIndex: 55, background: '#000', borderRadius: 8, overflow: 'hidden' }
        : { display: 'none' }
      : FULLSCREEN_STYLE

  const isLoading = playerState === 'loading'
  const isError = playerState === 'error'

  return (
    <div style={containerStyle} onMouseMove={mode === 'fullscreen' ? handlePlayerMouseMove : undefined}>

      {/* ── Embedded click-to-expand overlay ── */}
      {mode === 'embedded' && (
        <div
          onClick={onExpand}
          style={{
            position: 'absolute', inset: 0, zIndex: 30,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: 0, transition: 'opacity 0.15s',
            cursor: 'pointer',
            background: 'rgba(0,0,0,0.0)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(0,0,0,0.35)' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.background = 'rgba(0,0,0,0.0)' }}
          title="Click to expand"
        >
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', border: '1.5px solid rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </div>
        </div>
      )}

      {/* ── Mini-player top bar ── */}
      {mode === 'mini' && localContent && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          height: 28, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <span style={{ flex: 1, fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-ui)' }}>
            {localContent.title}
          </span>
          <button onClick={onExpand} title="Expand" style={miniIconBtn}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </button>
          <button onClick={onClose} title="Close" style={miniIconBtn}>
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 1l10 10M11 1L1 11" /></svg>
          </button>
        </div>
      )}

      {/* ── Fullscreen top bar (live) ── */}
      {mode === 'fullscreen' && localContent?.type === 'live' && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
          padding: '14px 18px',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.72) 0%, transparent 100%)',
          display: 'flex', alignItems: 'center', gap: 12,
          pointerEvents: 'none',
        }}>
          <button onClick={onMinimize} title="Back (Esc)" style={{ ...backBtnStyle, pointerEvents: 'all' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
          </button>
          {srcColor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: srcColor.accent, flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {localContent.title}
            </div>
            {isTimeshift && timeshiftProg ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#b388ff', letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>CATCHUP</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{timeshiftProg.title}</span>
              </div>
            ) : epgNowNext?.now ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#e05555', letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>NOW</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{epgNowNext.now.title}</span>
                {epgNowNext.next && (
                  <>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>·</span>
                    <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>NEXT</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{epgNowNext.next.title}</span>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Fullscreen close button (VOD) ── */}
      {mode === 'fullscreen' && localContent?.type !== 'live' && (
        <button onClick={onMinimize} title="Back (Esc)" style={{
          position: 'absolute', top: 14, left: 14, zIndex: 100,
          width: 36, height: 36, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.12)',
          color: '#fff', cursor: 'pointer', backdropFilter: 'blur(8px)', transition: 'background 0.1s',
        }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.6)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.6)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
        </button>
      )}

      {/* ── ArtPlayer container ── */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: mode === 'mini' ? 'calc(100% - 28px)' : '100%', marginTop: mode === 'mini' ? 28 : 0 } as React.CSSProperties}
      />

      {/* ── Audio-only visualizer ── */}
      <AnimatePresence>
        {isAudioOnly && !isLoading && !isError && (
          <motion.div key="audio-viz" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}
            style={{ position: 'absolute', inset: 0, zIndex: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(ellipse at center, rgba(20,10,40,0.95) 0%, rgba(5,5,15,0.98) 100%)', pointerEvents: 'none' }}>
            {(localContent?.posterUrl || localContent?.poster_url) && (
              <img src={localContent.posterUrl ?? localContent.poster_url} alt="" style={{ width: 120, height: 120, borderRadius: 20, objectFit: 'cover', marginBottom: 24, boxShadow: '0 8px 32px rgba(124,77,255,0.3)', border: '2px solid rgba(124,77,255,0.25)' }} />
            )}
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em', marginBottom: 8, textAlign: 'center', padding: '0 40px' }}>{localContent?.title}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 32, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Now Playing</div>
            <AudioVisualizer />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Resume prompt (VOD only) ── */}
      <AnimatePresence>
        {resumePrompt !== null && !isLoading && !isError && mode === 'fullscreen' && (
          <motion.div key="resume" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.25 }}
            style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 96, display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', borderRadius: 12, padding: '12px 20px', border: '1px solid rgba(124,77,255,0.3)' }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>Resume from {fmt(resumePrompt)}?</span>
            <button onClick={handleResume} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--accent-interactive)', color: '#fff', border: 'none', cursor: 'pointer' }}>Resume</button>
            <button onClick={handleStartOver} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', border: 'none', cursor: 'pointer' }}>Start Over</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Reconnect overlay ── */}
      <AnimatePresence>
        {reconnectAttempt !== null && !isError && (
          <motion.div key="reconnect" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 90, background: 'rgba(0,0,0,0.7)', pointerEvents: 'none' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.15)', borderTopColor: '#fff', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-ui)' }}>
              Reconnecting… ({reconnectAttempt}/{MAX_RECONNECT})
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Loading overlay ── */}
      <AnimatePresence>
        {isLoading && !reconnectAttempt && (
          <motion.div key="loader" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, pointerEvents: 'none', zIndex: 90 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid rgba(124,77,255,0.25)', borderTopColor: 'var(--accent-interactive)', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>Connecting to stream…</p>
            {loadingElapsed >= 4 && (
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{loadingElapsed}s elapsed</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Error overlay ── */}
      <AnimatePresence>
        {isError && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32, zIndex: 90 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#f87171', marginBottom: 6 }}>Playback failed</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{error}</p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setPlayerState('idle'); setError(null); /* Re-trigger load */ useAppStore.getState().setPlayingContent({ ...content! }) }}
                style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--accent-interactive)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                Retry
              </button>
              <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 500, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: 'none', cursor: 'pointer' }}>
                Go back
              </button>
              <button onClick={() => setShowDebug((x) => !x)} style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 500, background: 'rgba(124,77,255,0.15)', color: '#b388ff', border: 'none', cursor: 'pointer' }}>
                Stream info
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── OSD ── */}
      <AnimatePresence>
        {osd && mode === 'fullscreen' && (
          <motion.div key={osd.text + osd.icon} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.12 }}
            style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 95, pointerEvents: 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)', borderRadius: 16, padding: '18px 28px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <OsdIcon type={osd.icon} />
              <span style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>{osd.text}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{osd.icon.startsWith('seek') ? 'seek' : 'volume'}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Timeshift bar (live + catchup, fullscreen only) ── */}
      {mode === 'fullscreen' && localContent?.type === 'live' && catchupSupported && catchupDays > 0 && !isLoading && !isError && (
        <TimeshiftBar
          contentId={localContent.id}
          catchupDays={catchupDays}
          onPlayCatchup={(url, prog) => { switchToUrl(url); setIsTimeshift(true); setTimeshiftProg(prog) }}
          onGoLive={handleGoLive}
          isTimeshift={isTimeshift}
          currentProg={timeshiftProg}
        />
      )}

      {/* ── Episode prev/next pills (fullscreen, episodes only) ── */}
      {mode === 'fullscreen' && localContent?._parent && onSurfEpisode && (() => {
        const canPrev = episodeSurfIndex > 0
        const canNext = episodeSurfIndex < episodeSurfList.length - 1

        const pillStyle: CSSProperties = {
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', borderRadius: 12,
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.18)',
          color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: 500,
          cursor: 'pointer', fontFamily: 'var(--font-ui)',
          backdropFilter: 'blur(8px)',
          transition: 'background 0.15s',
        }
        const disabledPillStyle: CSSProperties = {
          ...pillStyle,
          cursor: 'default',
        }

        return (
          <>
          <button
            onClick={() => canPrev && onSurfEpisode(-1)}
            style={{
              ...(canPrev ? pillStyle : disabledPillStyle),
              position: 'absolute', bottom: 70, left: 20, zIndex: 100,
              opacity: showControls ? (canPrev ? 1 : 0.35) : 0,
              pointerEvents: showControls && canPrev ? 'all' : 'none',
              transition: 'opacity 0.2s, background 0.15s',
            }}
            onMouseEnter={(e) => { if (canPrev) e.currentTarget.style.background = 'rgba(0,0,0,0.6)' }}
            onMouseLeave={(e) => { if (canPrev) e.currentTarget.style.background = 'rgba(0,0,0,0.65)' }}
            title="Previous episode (PgUp / Cmd+↑)"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Prev
          </button>
          <button
            onClick={() => canNext && onSurfEpisode(1)}
            style={{
              ...(canNext ? pillStyle : disabledPillStyle),
              position: 'absolute', bottom: 70, right: 20, zIndex: 100,
              opacity: showControls ? (canNext ? 1 : 0.35) : 0,
              pointerEvents: showControls && canNext ? 'all' : 'none',
              transition: 'opacity 0.2s, background 0.15s',
            }}
            onMouseEnter={(e) => { if (canNext) e.currentTarget.style.background = 'rgba(0,0,0,0.6)' }}
            onMouseLeave={(e) => { if (canNext) e.currentTarget.style.background = 'rgba(0,0,0,0.65)' }}
            title="Next episode (PgDn / Cmd+↓)"
          >
            Next
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          </>
        )
      })()}

      {/* ── Series-episode + category chips (fullscreen only).
           Episode playback gets two pills: left = series·S/E (opens series detail for episode picker),
           right = category (navigates to series view filtered by category). ── */}
      {mode === 'fullscreen' && localContent && onChipClick && (() => {
        const isEpisode = !!(localContent as any)._parent
        const seInfo = isEpisode ? localContent.title.split(' · ')[0] : null
        const typeFallback = localContent.type === 'live' ? 'Channels'
          : localContent.type === 'movie' ? 'Films'
          : localContent.type === 'series' ? 'Series'
          : null
        const seriesLabel = isEpisode
          ? `${(localContent as any)._parent.title} · ${seInfo}`
          : null
        const categoryLabel = categoryName ?? typeFallback
        if (!seriesLabel && !categoryLabel) return null

        const pillStyle: CSSProperties = {
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 12,
          background: 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.18)',
          color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: 500,
          cursor: 'pointer', fontFamily: 'var(--font-ui)',
          transition: 'background 0.15s',
        }
        const handleHoverIn = (e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,0.22)' }
        const handleHoverOut = (e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)' }

        return (
          <div style={{
            position: 'absolute', bottom: 15, right: 15, zIndex: 100,
            display: 'flex', gap: 6, alignItems: 'center',
            opacity: showControls ? 1 : 0,
            pointerEvents: showControls ? 'all' : 'none',
            transition: 'opacity 0.2s',
          }}>
            {seriesLabel && (
              <button
                onClick={() => onChipClick({ ...localContent, category_name: categoryName ?? undefined })}
                style={pillStyle}
                onMouseEnter={handleHoverIn}
                onMouseLeave={handleHoverOut}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 3H8l-2 4h12l-2-4z"/>
                </svg>
                {seriesLabel}
              </button>
            )}
            {categoryLabel && (
              <button
                onClick={() => {
                  // Synthesize a non-episode item so App.handlePlayerChipClick takes the
                  // category-navigation branch (not the open-series-detail branch).
                  const parent = (localContent as any)._parent
                  onChipClick({
                    ...localContent,
                    id: parent?.id ?? localContent.id,
                    type: (parent?.type ?? localContent.type) as ContentItem['type'],
                    _parent: undefined,
                    category_name: categoryName ?? undefined,
                  } as any)
                }}
                style={pillStyle}
                onMouseEnter={handleHoverIn}
                onMouseLeave={handleHoverOut}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h16M4 12h16M4 18h10"/>
                </svg>
                {categoryLabel}
              </button>
            )}
          </div>
        )
      })()}

      {/* ── Channel surfer overlay ── */}
      {localContent?.type === 'live' && showSurfer && mode === 'fullscreen' && (
        <ChannelSurfer
          channels={useAppStore.getState().channelSurfList}
          activeId={localContent.id}
          onSwitch={(ch) => {
            doChannelSwitch(ch)
            if (surferTimerRef.current) clearTimeout(surferTimerRef.current)
            surferTimerRef.current = setTimeout(() => setShowSurfer(false), 3000)
          }}
          onClose={() => setShowSurfer(false)}
        />
      )}

      {/* ── Debug panel ── */}
      <AnimatePresence>
        {showDebug && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            style={{ position: 'absolute', top: 16, right: 16, zIndex: 100, width: 380, maxWidth: 'calc(100vw - 32px)', background: 'rgba(10,10,20,0.95)', border: '1px solid rgba(124,77,255,0.25)', borderRadius: 12, padding: 16, backdropFilter: 'blur(12px)', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ color: '#b388ff', fontWeight: 700, fontSize: 12 }}>Stream Info</span>
              <button onClick={() => setShowDebug(false)} style={{ width: 24, height: 24, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', border: 'none', cursor: 'pointer' }}>
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l10 10M11 1L1 11" /></svg>
              </button>
            </div>
            <Row label="title" value={localContent?.title ?? ''} />
            <Row label="content id" value={localContent?.id ?? ''} />
            <Row label="type" value={localContent?.type ?? ''} />
            <Row label="stream url" value={streamUrl ?? (isLoading ? 'resolving…' : 'not set')} color={isError ? '#f87171' : streamUrl ? '#86efac' : 'rgba(255,255,255,0.5)'} copyable />
            {error && <Row label="error" value={error} color="#f87171" />}
            <Row label="player" value={`ArtPlayer ${Artplayer.version} + hls.js ${Hls.version}`} />
            <Row label="mode" value={`${mode}${isOsFullscreen ? ' (OS fullscreen)' : ''}`} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const miniIconBtn: React.CSSProperties = {
  width: 20, height: 20, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', flexShrink: 0,
}

const backBtnStyle: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 8, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff', cursor: 'pointer', backdropFilter: 'blur(8px)', transition: 'background 0.1s',
}

function AudioVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const BAR_COUNT = 48, BAR_GAP = 3, BAR_RADIUS = 2
    const phases = Array.from({ length: BAR_COUNT }, () => Math.random() * Math.PI * 2)
    const speeds = Array.from({ length: BAR_COUNT }, () => 1.5 + Math.random() * 2.5)
    const draw = (t: number) => {
      rafRef.current = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth, h = canvas.clientHeight
      canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h)
      const barW = (w - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT
      for (let i = 0; i < BAR_COUNT; i++) {
        const val = 0.3 + 0.7 * Math.abs(Math.sin(t * 0.002 * speeds[i] + phases[i]))
        const barH = Math.max(3, val * h * 0.8)
        const x = i * (barW + BAR_GAP), y = (h - barH) / 2
        const hue = 260 + (i / BAR_COUNT) * 80, lightness = 50 + val * 25
        ctx.fillStyle = `hsla(${hue}, 80%, ${lightness}%, 0.85)`
        ctx.beginPath(); ctx.roundRect(x, y, barW, barH, BAR_RADIUS); ctx.fill()
        ctx.fillStyle = `hsla(${hue}, 80%, ${lightness}%, 0.12)`
        ctx.beginPath(); ctx.roundRect(x, y + barH + 2, barW, barH * 0.3, BAR_RADIUS); ctx.fill()
      }
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])
  return <canvas ref={canvasRef} style={{ width: '60%', maxWidth: 500, height: 120, opacity: 0.9 }} />
}

function OsdIcon({ type }: { type: 'seek-back' | 'seek-fwd' | 'vol-up' | 'vol-down' }) {
  const s = { width: 32, height: 32, color: '#fff' }
  if (type === 'seek-back') return <svg {...s} viewBox="0 0 24 24" fill="none"><polygon points="11 19 2 12 11 5 11 19" fill="currentColor" opacity={0.9} /><polygon points="22 19 13 12 22 5 22 19" fill="currentColor" opacity={0.5} /></svg>
  if (type === 'seek-fwd') return <svg {...s} viewBox="0 0 24 24" fill="none"><polygon points="13 19 22 12 13 5 13 19" fill="currentColor" opacity={0.9} /><polygon points="2 19 11 12 2 5 2 19" fill="currentColor" opacity={0.5} /></svg>
  if (type === 'vol-up') return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" opacity={0.5} /></svg>
  return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
}

function Row({ label, value, color, copyable }: { label: string; value: string; color?: string; copyable?: boolean }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={{ color: 'rgba(255,255,255,0.3)' }}>{label}: </span>
      <span style={{ color: color ?? 'rgba(255,255,255,0.75)', wordBreak: 'break-all', cursor: copyable ? 'pointer' : undefined }}
        title={copyable ? 'Click to copy' : undefined}
        onClick={copyable && value ? () => navigator.clipboard.writeText(value) : undefined}>
        {value}
      </span>
    </div>
  )
}
