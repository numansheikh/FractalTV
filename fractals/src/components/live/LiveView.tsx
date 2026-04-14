import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Hls from 'hls.js'
import Artplayer from 'artplayer'
import { ContentItem } from '@/lib/types'
import { useAppStore } from '@/stores/app.store'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { api } from '@/lib/api'
import { fmtTime } from '@/lib/time'
import { EpgGuide } from './EpgGuide'

interface Props {
  channel: ContentItem
  onFullscreen: (ch: ContentItem) => void
  onSwitchChannel: (ch: ContentItem) => void
  onClose: () => void
}

export function LiveView({ channel, onFullscreen, onSwitchChannel, onClose }: Props) {
  const { channelSurfList, surfContextAction, surfSearchQuery, selectedSourceIds, toggleSourceFilter, setView, setCategoryFilter, setHomeMode } = useAppStore()
  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [epgExpanded, setEpgExpanded] = useState(true)
  const [showGuide, setShowGuide] = useState(false)
  const [categoryName, setCategoryName] = useState<string | null>(null)

  // Fetch category name for the active channel (not always in the ContentItem)
  useEffect(() => {
    setCategoryName(null)
    api.content.get(channel.id).then((item: any) => {
      if (item?.category_name) setCategoryName(item.category_name.split(',')[0])
    })
  }, [channel.id])

  const handleBrowseCategory = () => {
    if (!categoryName) return
    setView('live')
    setCategoryFilter(categoryName)
    onClose()
  }
  const activeChannelRef = useRef<HTMLDivElement>(null)
  const isFirstMount = useRef(true)

  const { loadBulk, data: userData, setFavorite } = useUserStore()

  // Scroll active channel into view on mount (instant) and on channel change (smooth)
  useEffect(() => {
    const behavior = isFirstMount.current ? 'instant' : 'smooth'
    isFirstMount.current = false
    requestAnimationFrame(() => {
      activeChannelRef.current?.scrollIntoView({ block: 'center', behavior })
    })
  }, [channel.id])

  // Keyboard shortcuts (capture phase, before App.tsx bubble handler)
  const { surfChannel } = useAppStore()
  // Track mount time — ignore Escape for a brief window so a held/repeated Escape
  // from closing the player doesn't immediately close the Live View too.
  const mountTimeRef = useRef(Date.now())
  useEffect(() => { mountTimeRef.current = Date.now() }, [])

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    }
    const handler = (e: KeyboardEvent) => {
      // Escape works regardless of focus — closes guide or Live View
      // Guard: ignore for 300ms after mount (key-repeat from closing player)
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        if (Date.now() - mountTimeRef.current < 300) return
        if (showGuide) { setShowGuide(false) } else { onClose() }
        return
      }
      // All other shortcuts are suppressed while typing
      if (isTyping()) return
      if (e.key === 'f' || e.key === 'F') { e.stopImmediatePropagation(); onFullscreen(channel); return }
      // Channel surf: PgUp/PgDn or Cmd+↑↓
      const isSurfUp = e.key === 'PageUp' || (e.metaKey && e.key === 'ArrowUp')
      const isSurfDown = e.key === 'PageDown' || (e.metaKey && e.key === 'ArrowDown')
      if (isSurfUp || isSurfDown) {
        e.preventDefault(); e.stopImmediatePropagation()
        const next = surfChannel(isSurfUp ? -1 : 1)
        if (next) onSwitchChannel(next)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose, onFullscreen, onSwitchChannel, surfChannel, channel, showGuide])

  const filtered = channelSurfList.filter((c) => {
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false
    if (selectedSourceIds.length > 0) {
      const srcId = c.primarySourceId ?? c.primary_source_id ?? (c as any).source_ids ?? c.id.split(':')[0]
      if (!selectedSourceIds.includes(srcId)) return false
    }
    return true
  })

  // Load favorite status for all visible channels
  useEffect(() => {
    const ids = filtered.map((c) => c.id)
    if (ids.length > 0) loadBulk(ids)
  }, [filtered.map((c) => c.id).join(',')])

  const handleToggleFav = useCallback(async (ch: ContentItem) => {
    const current = !!useUserStore.getState().data[ch.id]?.favorite
    setFavorite(ch.id, !current) // optimistic
    try {
      await api.user.toggleFavorite(ch.id)
      // Refetch to sync with DB (loadBulk skips cached IDs, force by direct bulkGetData)
      const result = await api.user.bulkGetData([ch.id])
      useUserStore.setState((state) => ({ data: { ...state.data, ...result } }))
    } catch {
      setFavorite(ch.id, current) // rollback
    }
    qc.invalidateQueries({ queryKey: ['channels', 'favorites'] })
  }, [setFavorite])

  const srcColor = colorMap[channel.primarySourceId ?? channel.primary_source_id ?? (channel as any).source_ids ?? '']

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, left: 48, zIndex: 40,
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-0)',
    }}>
      {/* Top bar */}
      <div style={{
        height: 44, flexShrink: 0,
        background: 'var(--bg-1)', borderBottom: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
      }}>
        <button onClick={onClose} style={backBtnStyle}>
          <ChevronLeftIcon />
        </button>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>Live View</span>
        {(() => {
          const pillLabel = surfContextAction === 'home-discover' ? 'Favorites'
            : surfContextAction === 'home-channels' ? 'Channels'
            : surfContextAction === 'browse-favorites' ? 'Favorites'
            : surfContextAction === 'search' ? `Search "${(surfSearchQuery ?? '').replace(/^@/, '').trim()}"`
            : categoryName ?? null
          if (!pillLabel) return null
          const handlePillClick = () => {
            if (surfContextAction === 'home-discover') {
              setView('home'); setHomeMode('discover'); onClose()
            } else if (surfContextAction === 'home-channels') {
              setView('home'); setHomeMode('channels'); onClose()
            } else if (surfContextAction === 'browse-favorites') {
              setView('live'); setCategoryFilter('__favorites__'); onClose()
            } else if (surfContextAction === 'search') {
              onClose() // query already persisted in search store
            } else if (categoryName) {
              handleBrowseCategory()
            }
          }
          return (
            <button onClick={handlePillClick} style={{
              fontSize: 11, color: 'var(--text-1)', background: 'var(--bg-3)',
              borderRadius: 6, padding: '2px 7px', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
            }}>
              {pillLabel}
            </button>
          )
        })()}
        <div style={{ flex: 1 }} />
        {/* Source filter dots — same as CommandBar */}
        {sources.filter((s) => !s.disabled).length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {sources.filter((s) => !s.disabled).map((src) => {
              const color = colorMap[src.id]?.accent ?? 'var(--text-2)'
              const anySelected = selectedSourceIds.length > 0
              const isSelected = selectedSourceIds.includes(src.id)
              const isFilled = !anySelected || isSelected
              return (
                <button
                  key={src.id}
                  onClick={() => toggleSourceFilter(src.id)}
                  title={anySelected ? (isSelected ? `Filtering: ${src.name}` : `Add ${src.name}`) : src.name}
                  style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: isFilled ? color : 'transparent',
                    border: `2px solid ${color}`,
                    cursor: 'pointer', padding: 0,
                    transition: 'all 0.1s',
                    opacity: isFilled ? 1 : 0.35,
                  }}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ── Left: channel list ── */}
        <div style={{
          width: 300, flexShrink: 0,
          background: 'var(--bg-1)', borderRight: '1px solid var(--border-default)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* List header + search */}
          <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)' }}>
              Channels · {channelSurfList.length}
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <SearchIconSm />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter channels…"
                style={{
                  width: '100%', height: 27,
                  background: 'var(--bg-2)', border: '1px solid var(--border-default)',
                  borderRadius: 5, color: 'var(--text-1)', fontSize: 11,
                  padding: '0 8px 0 27px', fontFamily: 'var(--font-ui)',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Channel rows */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.map((ch) => (
              <ChannelRow
                key={ch.id}
                ch={ch}
                isActive={ch.id === channel.id}
                activeRef={ch.id === channel.id ? activeChannelRef : undefined}
                colorMap={colorMap}
                isFav={!!userData[ch.id]?.favorite}
                onToggleFav={handleToggleFav}
                onClick={() => {
                  if (ch.id === channel.id) {
                    onFullscreen(ch)
                  } else {
                    onSwitchChannel(ch)
                  }
                }}
              />
            ))}
          </div>

          {/* Footer hint */}
          <div style={{
            borderTop: '1px solid var(--border-default)', padding: '7px 12px',
            display: 'flex', gap: 6,
          }}>
            <HintBtn label="Full screen" shortcut="F" onClick={() => onFullscreen(channel)} />
            <HintBtn label="Close" shortcut="Esc" onClick={onClose} />
          </div>
        </div>

        {/* ── Right: player + EPG ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Player zone */}
          <div
            style={{ flex: 1, position: 'relative', background: '#000', overflow: 'hidden', cursor: 'pointer', minHeight: 0 }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('.art-bottom, .art-controls, .art-volume, .art-control')) return
              onFullscreen(channel)
            }}
            title="Click to go fullscreen"
          >
            <MiniPlayer key={channel.id} channel={channel} />

            {/* Top overlay — channel name + live badge only, no interactive elements */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5,
              padding: '10px 14px',
              background: 'linear-gradient(180deg, rgba(0,0,0,0.65) 0%, transparent 100%)',
              display: 'flex', alignItems: 'center', gap: 10,
              pointerEvents: 'none',
            }}>
              {srcColor && (
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: srcColor.accent, flexShrink: 0 }} />
              )}
              <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {channel.title}
              </span>
              <LivePill />
            </div>

            {/* Click-to-fullscreen hover hint */}
            <FullscreenHint />
          </div>

          {/* Category bar — outside player zone, no click conflicts */}
          {categoryName && (
            <div style={{
              flexShrink: 0, height: 28,
              background: 'var(--bg-1)', borderBottom: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 14px', gap: 6,
            }}>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>in</span>
              <button
                onClick={handleBrowseCategory}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontSize: 10, fontWeight: 600, color: 'var(--accent-interactive)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'underline' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'none' }}
              >
                {categoryName} →
              </button>
            </div>
          )}

          {/* EPG strip */}
          <EpgStrip channel={channel} expanded={epgExpanded} onToggle={() => setEpgExpanded((v) => !v)} onOpenGuide={() => setShowGuide(true)} />
        </div>
      </div>

      {/* EPG Full Guide */}
      {showGuide && (
        <EpgGuide
          channels={channelSurfList}
          activeChannel={channel}
          onSwitchChannel={(ch) => { onSwitchChannel(ch); setShowGuide(false) }}
          onFullscreen={(ch) => { onFullscreen(ch); setShowGuide(false) }}
          onClose={() => setShowGuide(false)}
        />
      )}
    </div>
  )
}

// ── Mini player (ArtPlayer, no controls) ─────────────────────────────────────

function MiniPlayer({ channel }: { channel: ContentItem }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<Artplayer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAudioOnly, setIsAudioOnly] = useState(false)

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError(null)
    setIsAudioOnly(false)

    api.content.getStreamUrl({ contentId: channel.id }).then((result: any) => {
      if (cancelled || !containerRef.current) return

      if (!result?.url) {
        setError(result?.error ?? 'Could not get stream URL')
        setLoading(false)
        return
      }

      const url: string = result.url
      const isHls = url.includes('.m3u8') || url.includes('m3u8')

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
                  setError('Stream unavailable')
                  setLoading(false)
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
      art.on('error', () => { if (!cancelled) { setError('Playback error'); setLoading(false) } })
    })

    return () => {
      cancelled = true
      if (artRef.current) {
        try {
          ;(artRef.current as any).hls?.destroy()
          artRef.current.destroy(true)
        } catch {}
        artRef.current = null
      }
    }
  }, [channel.id])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* Audio-only overlay (radio stations) */}
      {isAudioOnly && !loading && !error && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 5,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'radial-gradient(ellipse at center, rgba(20,10,40,0.95) 0%, rgba(5,5,15,0.98) 100%)',
          pointerEvents: 'none', gap: 10,
        }}>
          {(channel.posterUrl || channel.poster_url) && (
            <img src={channel.posterUrl ?? channel.poster_url} alt="" style={{
              width: 52, height: 52, borderRadius: 10, objectFit: 'cover',
              boxShadow: '0 4px 16px rgba(124,77,255,0.3)',
              border: '1px solid rgba(124,77,255,0.25)',
            }} />
          )}
          <MiniAudioBars />
        </div>
      )}
      {loading && !error && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)',
        }}>
          <div style={{ width: 28, height: 28, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}
      {error && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.8)', gap: 8,
        }}>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{error}</span>
        </div>
      )}
    </div>
  )
}

// ── EPG strip ─────────────────────────────────────────────────────────────────

function EpgStrip({ channel, expanded, onToggle, onOpenGuide }: { channel: ContentItem; expanded: boolean; onToggle: () => void; onOpenGuide: () => void }) {
  const [nowNext, setNowNext] = useState<{ now: any; next: any } | null>(null)

  useEffect(() => {
    let alive = true
    api.epg.nowNext(channel.id).then((data) => { if (alive) setNowNext(data) })
    // Refresh every 60s in case programme changes
    const interval = setInterval(() => {
      api.epg.nowNext(channel.id).then((data) => { if (alive) setNowNext(data) })
    }, 60_000)
    return () => { alive = false; clearInterval(interval) }
  }, [channel.id])

  const now = nowNext?.now
  const next = nowNext?.next

  const progress = now
    ? Math.min(100, Math.max(0, ((Date.now() / 1000 - now.startTime) / (now.endTime - now.startTime)) * 100))
    : null


  return (
    <div
      onClick={onToggle}
      style={{
        flexShrink: 0,
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--border-default)',
        overflow: 'hidden',
        height: expanded ? 260 : 86,
        transition: 'height 220ms cubic-bezier(0.32,0.72,0,1)',
        display: 'flex', flexDirection: 'column',
        cursor: 'pointer',
      }}
    >
      {/* Collapsed row */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 86, minHeight: 86 }}>
        {/* Logo */}
        <div style={{
          width: 30, height: 30, borderRadius: 5, background: 'var(--bg-3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 6, fontWeight: 800, color: 'var(--text-3)', flexShrink: 0, overflow: 'hidden',
        }}>
          {(channel.posterUrl || channel.poster_url)
            ? <img src={channel.posterUrl ?? channel.poster_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
            : channel.title.split(' ')[0].toUpperCase().substring(0, 4)
          }
        </div>

        {/* NOW / NEXT */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent-live)', flexShrink: 0 }}>Now</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {now ? now.title : channel.title}
            </span>
            {now && <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{fmtTime(now.startTime)}–{fmtTime(now.endTime)}</span>}
          </div>
          {/* Progress bar */}
          <div style={{ height: 3, background: 'var(--bg-4)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress ?? 40}%`, background: 'var(--accent-live)', borderRadius: 2, transition: 'width 1s linear' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>Next</span>
            <span style={{ fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {next ? `${next.title}${next.startTime ? ` · ${fmtTime(next.startTime)}` : ''}` : '—'}
            </span>
          </div>
        </div>

        {/* Full Guide button */}
        <button
          onClick={(e) => { e.stopPropagation(); onOpenGuide() }}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 6,
            background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
            color: '#a78bfa', fontSize: 10, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(139,92,246,0.25)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(139,92,246,0.15)' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
          Full Guide
        </button>

        {/* Chevron */}
        <div style={{
          width: 28, height: 28, borderRadius: 5, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-3)', border: '1px solid var(--border-default)', color: 'var(--text-2)',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s',
        }}>
          <ChevronUpIcon />
        </div>
      </div>

      {/* Expanded — description + upcoming */}
      {expanded && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border-subtle)', padding: '12px 14px', gap: 10 }} onClick={(e) => e.stopPropagation()}>
          {now?.description && (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'color-mix(in srgb, var(--accent-live) 6%, var(--bg-2))',
              border: '1px solid color-mix(in srgb, var(--accent-live) 12%, var(--border-subtle))',
            }}>
              <p style={{ fontSize: 11, color: 'var(--text-1)', margin: 0, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {now.description}
              </p>
            </div>
          )}
          {!now && <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0, fontStyle: 'italic' }}>No EPG data — sync your source to load program guide</p>}
          {next && (
            <div style={{
              padding: '8px 12px', borderRadius: 8,
              background: 'var(--bg-2)',
              border: '1px solid var(--border-subtle)',
              display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <span style={{
                fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                color: 'var(--text-3)', flexShrink: 0, marginTop: 3,
                padding: '1px 5px', borderRadius: 3,
                background: 'var(--bg-3)',
              }}>Next</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {next.title}
                  {next.startTime && <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginLeft: 6 }}>{fmtTime(next.startTime)}</span>}
                </div>
                {next.description && <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{next.description}</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Channel row ───────────────────────────────────────────────────────────────

function ChannelRow({ ch, isActive, activeRef, colorMap, isFav, onToggleFav, onClick }: {
  ch: ContentItem; isActive: boolean; activeRef?: React.RefObject<HTMLDivElement | null>; colorMap: Record<string, any>
  isFav: boolean; onToggleFav: (ch: ContentItem) => void; onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const srcId = ch.primarySourceId ?? ch.primary_source_id ?? (ch as any).source_ids ?? ''
  const srcColor = colorMap[srcId]

  return (
    <div
      ref={activeRef}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        background: isActive
          ? 'rgba(244,63,94,0.08)'
          : hovered ? 'var(--bg-2)' : 'transparent',
        borderLeft: srcColor
          ? `3px solid ${srcColor.accent}`
          : isActive ? '3px solid var(--accent-live)' : '3px solid transparent',
        transition: 'background 0.1s',
        position: 'relative',
      }}
    >
      {/* Logo */}
      <div style={{
        width: 36, height: 36, borderRadius: 5, background: 'var(--bg-3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 7, fontWeight: 800, color: 'var(--text-3)', flexShrink: 0, overflow: 'hidden',
      }}>
        {(ch.posterUrl || ch.poster_url) ? (
          <img src={ch.posterUrl ?? ch.poster_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            onError={(e) => { e.currentTarget.style.display = 'none' }} />
        ) : ch.title.split(' ')[0].toUpperCase().substring(0, 4)}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600,
          color: isActive ? 'var(--accent-live)' : 'var(--text-0)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{ch.title}</span>
          {!!(ch as any).has_epg_data && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ flexShrink: 0, color: 'var(--text-3)', opacity: 0.7 }}>
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          )}
          {srcColor && <span style={{ width: 5, height: 5, borderRadius: '50%', background: srcColor.accent, flexShrink: 0, display: 'inline-block' }} />}
        </div>
        <div style={{ height: 2, background: 'var(--bg-4)', borderRadius: 1, marginTop: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: '40%', background: 'var(--accent-live)', borderRadius: 1 }} />
        </div>
      </div>

      {/* Favorite toggle — always visible when fav, hover-only otherwise */}
      {(isFav || hovered) && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFav(ch) }}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          style={{
            flexShrink: 0,
            background: 'none', border: 'none', padding: '2px 3px',
            cursor: 'pointer', lineHeight: 1,
            fontSize: 15,
            color: isFav ? '#e05555' : 'var(--text-2)',
            transition: 'color 0.1s, transform 0.1s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.2)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
        >
          {isFav ? '♥' : '♡'}
        </button>
      )}

      {isActive && !hovered && <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-live)', flexShrink: 0 }} />}
      {!isActive && hovered && <span style={{ fontSize: 9, color: 'var(--text-3)' }}>switch</span>}
    </div>
  )
}

// ── Small components ──────────────────────────────────────────────────────────

function FullscreenHint() {
  return (
    <div className="fullscreen-hint" style={{
      position: 'absolute', inset: 0,
      background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: 0, transition: 'opacity 0.15s', zIndex: 3, pointerEvents: 'none',
    }}
    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'rgba(255,255,255,0.15)', border: '2px solid rgba(255,255,255,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <FullscreenIcon />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>Full screen</span>
      </div>
    </div>
  )
}

function LivePill() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      background: 'var(--accent-live)', color: '#fff',
      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', animation: 'pulse 1.5s ease-in-out infinite', display: 'inline-block' }} />
      LIVE
    </div>
  )
}

function HintBtn({ label, shortcut, onClick }: { label: string; shortcut: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, height: 28, borderRadius: 5,
        background: 'var(--bg-2)', border: '1px solid var(--border-default)',
        color: 'var(--text-2)', fontSize: 11, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
      }}
    >
      <kbd style={{
        background: 'var(--bg-3)', border: '1px solid var(--border-default)',
        borderRadius: 3, padding: '1px 5px', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-2)',
      }}>{shortcut}</kbd>
      {label}
    </button>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const backBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 5,
  background: 'var(--bg-2)', border: '1px solid var(--border-default)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-1)', cursor: 'pointer', flexShrink: 0,
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ChevronLeftIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
}
function ChevronUpIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
}
function FullscreenIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
}
function SearchIconSm() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round"
      style={{ position: 'absolute', left: 8, pointerEvents: 'none' }}>
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  )
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

  return <canvas ref={canvasRef} style={{ width: 120, height: 36 }} />
}
