import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ContentItem } from '@/lib/types'
import { useAppStore } from '@/stores/app.store'
import { useSearchStore } from '@/stores/search.store'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { api } from '@/lib/api'
import { fmtTime } from '@/lib/time'
import { EpgGuide } from './EpgGuide'

interface Props {
  channel: ContentItem
  onFullscreen: () => void
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
  const [iptvInfo, setIptvInfo] = useState<ContentItem | null>(null)

  const { data: siblings = [] } = useQuery({
    queryKey: ['channel-siblings-lv', iptvInfo?.id],
    queryFn: () => api.channels.siblings(iptvInfo!.id),
    enabled: !!iptvInfo?.id,
    staleTime: 10 * 60_000,
  })

  // Fetch enriched channel data (category name + iptv-org fields)
  useEffect(() => {
    setCategoryName(null)
    setIptvInfo(null)
    // Default to expanded only if EPG data is known to exist on this channel.
    // iptv-org data isn't loaded yet — we'll expand once it arrives if needed.
    setEpgExpanded(!!channel.has_epg_data)
    api.content.get(channel.id).then((item: any) => {
      if (item?.category_name) setCategoryName(item.category_name.split(',')[0])
      if (item?.io_name) {
        setIptvInfo(item as ContentItem)
        // iptv-org data arrived — ensure the panel is expanded to show it
        setEpgExpanded(true)
      }
    })
  }, [channel.id])

  const handleBrowseCategory = () => {
    if (!categoryName) return
    useSearchStore.getState().setQuery('')
    setView('live')
    setCategoryFilter(categoryName)
    onClose()
  }
  const activeChannelRef = useRef<HTMLDivElement>(null)
  const isFirstMount = useRef(true)
  const playerZoneRef = useRef<HTMLDivElement>(null)

  // Register this view's player zone as the embedded anchor and start playback.
  // Runs once on mount; channel changes go through setPlayingContent only.
  useEffect(() => {
    const el = playerZoneRef.current
    if (!el) return
    const { setEmbeddedAnchor, setPlayingContent, setPlayerMode } = useAppStore.getState()
    setEmbeddedAnchor(el)
    setPlayingContent(channel)
    setPlayerMode('embedded')
    return () => {
      const s = useAppStore.getState()
      s.setEmbeddedAnchor(null)
      // Only stop stream if embedded (fullscreen transition keeps playing;
      // NavRail handles the fullscreen-nav-away case separately)
      if (s.playerMode === 'embedded') {
        s.setPlayerMode('hidden')
        s.setPlayingContent(null)
      }
    }
  }, [])

  // Update playing content when channel changes (channel surf, list click)
  useEffect(() => {
    useAppStore.getState().setPlayingContent(channel)
  }, [channel.id])

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
      if (e.key === 'f' || e.key === 'F') { e.stopImmediatePropagation(); onFullscreen(); return }
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
              <LiveChannelListCard
                key={ch.id}
                ch={ch}
                isActive={ch.id === channel.id}
                activeRef={ch.id === channel.id ? activeChannelRef : undefined}
                colorMap={colorMap}
                isFav={!!userData[ch.id]?.favorite}
                onToggleFav={handleToggleFav}
                onClick={() => {
                  if (ch.id === channel.id) {
                    onFullscreen()
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
            <HintBtn label="Full screen" shortcut="F" onClick={() => onFullscreen()} />
            <HintBtn label="Close" shortcut="Esc" onClick={onClose} />
          </div>
        </div>

        {/* ── Right: player + EPG ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Player zone — PlayerOverlay overlays playerZoneRef in 'embedded' mode */}
          <div
            style={{ flex: 1, position: 'relative', background: '#000', overflow: 'hidden', cursor: 'pointer', minHeight: 0 }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('.art-bottom, .art-controls, .art-volume, .art-control')) return
              onFullscreen()
            }}
            title="Click to go fullscreen"
          >
            <div ref={playerZoneRef} style={{ width: '100%', height: '100%' }} />

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

          {/* Bottom panel: iptv identity (left) + EPG (right) */}
          <div style={{
            flexShrink: 0,
            height: epgExpanded ? 260 : 86,
            transition: 'height 220ms cubic-bezier(0.32,0.72,0,1)',
            borderTop: '1px solid var(--border-default)',
            display: 'flex', overflow: 'hidden',
          }}>
            {iptvInfo && (
              <IptvStrip item={iptvInfo} expanded={epgExpanded} onClick={() => setEpgExpanded((v) => !v)} siblings={siblings} onSwitchChannel={onSwitchChannel} />
            )}
            <EpgStrip channel={channel} expanded={epgExpanded} onToggle={() => setEpgExpanded((v) => !v)} onOpenGuide={() => setShowGuide(true)} onNoData={() => setEpgExpanded(false)} />
          </div>
        </div>
      </div>

      {/* EPG Full Guide */}
      {showGuide && (
        <EpgGuide
          channels={channelSurfList}
          activeChannel={channel}
          onSwitchChannel={(ch) => { onSwitchChannel(ch); setShowGuide(false) }}
          onFullscreen={(ch) => { useAppStore.getState().setPlayingContent(ch); onFullscreen(); setShowGuide(false) }}
          onClose={() => setShowGuide(false)}
        />
      )}
    </div>
  )
}

// ── Iptv-org identity strip (left panel of bottom section) ───────────────────

function IptvStrip({ item, expanded, onClick, siblings, onSwitchChannel }: {
  item: ContentItem; expanded: boolean; onClick: () => void
  siblings?: { id: string; title: string; source_id: string }[]
  onSwitchChannel?: (ch: ContentItem) => void
}) {
  const [imgError, setImgError] = useState(false)
  const { sources } = useSourcesStore()
  const siblingColorMap = buildColorMapFromSources(sources)
  const sourceNames: Record<string, string> = {}
  for (const s of sources) sourceNames[s.id] = s.name
  const logoUrl = item.io_logo_url ?? item.posterUrl ?? item.poster_url ?? null
  const logo: string | null = imgError ? null : logoUrl
  const initials = item.title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')

  const categoryLabels: string[] = (() => {
    if (!item.io_category_labels) return []
    try { const p = JSON.parse(item.io_category_labels); return Array.isArray(p) ? p.filter((v: unknown) => typeof v === 'string') : [] } catch { return [] }
  })()

  return (
    <div
      onClick={onClick}
      style={{
        width: 240, flexShrink: 0,
        borderRight: '1px solid var(--border-default)',
        background: 'var(--bg-2)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', cursor: 'pointer',
        height: '100%',
      }}
    >
      {/* Always-visible row */}
      <div style={{ height: 86, minHeight: 86, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px' }}>
        {/* Logo */}
        <div style={{
          width: 48, height: 48, borderRadius: 7, flexShrink: 0,
          background: 'var(--bg-3)', border: '1px solid var(--border-default)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {logo
            ? <img src={logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 5 }} onError={() => setImgError(true)} />
            : <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.02em' }}>{initials}</span>
          }
        </div>
        {/* Name + flag + chip */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.io_name ?? item.title}
          </span>
          {(item.io_country_flag || item.io_country_name) && (
            <span style={{ fontSize: 11, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.io_country_flag} {item.io_country_name}
            </span>
          )}
          {categoryLabels[0] && (
            <span style={{
              fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--text-1)', background: 'var(--bg-4)',
              border: '1px solid var(--border-default)',
              padding: '1px 5px', borderRadius: 8, alignSelf: 'flex-start',
            }}>
              {categoryLabels[0]}
            </span>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ flex: 1, overflow: 'auto', borderTop: '1px solid var(--border-subtle)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }} onClick={(e) => e.stopPropagation()}>
          {item.io_network && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ fontSize: 10, color: 'var(--text-1)', minWidth: 60, flexShrink: 0 }}>Network</span>
              <span style={{ fontSize: 11, color: 'var(--text-0)', fontWeight: 500 }}>{item.io_network}</span>
            </div>
          )}
          {categoryLabels.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {categoryLabels.map((l) => (
                <span key={l} style={{
                  fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: 'var(--text-1)', background: 'var(--bg-4)',
                  border: '1px solid var(--border-default)',
                  padding: '1px 5px', borderRadius: 8,
                }}>
                  {l}
                </span>
              ))}
            </div>
          )}
          {item.io_is_nsfw ? (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#e05555', padding: '2px 6px', borderRadius: 4, alignSelf: 'flex-start' }}>NSFW</span>
          ) : null}

          {siblings && siblings.length > 0 && (
            <div style={{ borderRadius: 8, border: '1px solid var(--border-default)', flexShrink: 0 }}>
              <div style={{ padding: '6px 10px', background: 'var(--accent-interactive)', borderBottom: '1px solid rgba(0,0,0,0.18)', borderRadius: '8px 8px 0 0' }}>
                <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#fff', margin: 0, fontFamily: 'var(--font-ui)' }}>
                  Also on
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-2)', padding: '4px 0', borderRadius: '0 0 8px 8px', overflowX: 'auto' }}>
                {siblings.map((s) => {
                  const sc = siblingColorMap[s.source_id]
                  const name = sourceNames[s.source_id] ?? s.source_id
                  return (
                    <button
                      key={s.id}
                      onClick={(e) => { e.stopPropagation(); onSwitchChannel?.({ id: s.id, type: 'live', title: s.title, primary_source_id: s.source_id } as ContentItem) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '5px 10px',
                        background: 'none', border: 'none',
                        cursor: 'pointer', textAlign: 'left', width: '100%',
                        minWidth: 'max-content',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc?.accent ?? 'var(--text-3)', flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: 'var(--text-1)', fontFamily: 'var(--font-ui)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-0)', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap' }}>
                        {s.title}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── EPG strip ─────────────────────────────────────────────────────────────────

function EpgStrip({ channel, expanded, onToggle, onOpenGuide, onNoData }: { channel: ContentItem; expanded: boolean; onToggle: () => void; onOpenGuide: () => void; onNoData?: () => void }) {
  const [nowNext, setNowNext] = useState<{ now: any; next: any } | null>(null)
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    let alive = true
    setFetched(false)
    let triedShortEpg = false
    const loadNowNext = async () => {
      const data = await api.epg.nowNext(channel.id)
      if (!alive) return
      setNowNext(data)
      setFetched(true)
      if (!data?.now && !data?.next) {
        // Xtream short-EPG on-demand fallback: a single channel may be
        // missing from the full xmltv.php dump. Fetch once per selection;
        // the IPC handler has its own 1-hour cache guard.
        if (!triedShortEpg) {
          triedShortEpg = true
          const r = await api.epg.fetchShort(channel.id)
          if (alive && r.inserted > 0) {
            const refreshed = await api.epg.nowNext(channel.id)
            if (alive) setNowNext(refreshed)
            return
          }
        }
        onNoData?.()
      }
    }
    loadNowNext()
    const interval = setInterval(() => {
      api.epg.nowNext(channel.id).then((data) => { if (alive) setNowNext(data) })
    }, 60_000)
    return () => { alive = false; clearInterval(interval) }
  }, [channel.id])

  const now = nowNext?.now
  const next = nowNext?.next
  const hasData = !!(now || next)

  const progress = now
    ? Math.min(100, Math.max(0, ((Date.now() / 1000 - now.startTime) / (now.endTime - now.startTime)) * 100))
    : null


  return (
    <div
      onClick={onToggle}
      style={{
        flex: 1, minWidth: 0,
        background: 'var(--bg-1)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        cursor: 'pointer',
        height: '100%',
      }}
    >
      {/* Collapsed row */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 86, minHeight: 86 }}>
        {fetched && !hasData ? (
          /* No EPG data — minimal message only */
          <span style={{ fontSize: 12, color: 'var(--text-1)', fontFamily: 'var(--font-ui)', fontStyle: 'italic' }}>
            No EPG data
          </span>
        ) : (
          <>
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
                  {now?.title ?? '—'}
                </span>
                {now && <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{fmtTime(now.startTime)}–{fmtTime(now.endTime)}</span>}
              </div>
              {/* Progress bar — only when we have real data */}
              {now && (
                <div style={{ height: 3, background: 'var(--bg-4)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progress ?? 0}%`, background: 'var(--accent-live)', borderRadius: 2, transition: 'width 1s linear' }} />
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>Next</span>
                <span style={{ fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {next ? `${next.title}${next.startTime ? ` · ${fmtTime(next.startTime)}` : ''}` : '—'}
                </span>
              </div>
            </div>
          </>
        )}

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
      {expanded && hasData && (
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

function LiveChannelListCard({ ch, isActive, activeRef, colorMap, isFav, onToggleFav, onClick }: {
  ch: ContentItem; isActive: boolean; activeRef?: React.RefObject<HTMLDivElement | null>; colorMap: Record<string, any>
  isFav: boolean; onToggleFav: (ch: ContentItem) => void; onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const srcId = ch.primarySourceId ?? ch.primary_source_id ?? (ch as any).source_ids ?? ''
  const srcColor = colorMap[srcId]

  const { data: nowNext } = useQuery({
    queryKey: ['epg-now-next', ch.id],
    queryFn: () => api.epg.nowNext(ch.id),
    enabled: !!ch.has_epg_data,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
  const epgProgress = (() => {
    const now = nowNext?.now
    if (!now) return null
    const total = now.endTime - now.startTime
    if (total <= 0) return null
    return Math.min(100, Math.max(0, (Date.now() / 1000 - now.startTime) / total * 100))
  })()

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
          {srcColor && <span style={{ width: 5, height: 5, borderRadius: '50%', background: srcColor.accent, flexShrink: 0, display: 'inline-block' }} />}
        </div>
        <div style={{ height: 2, background: 'var(--bg-4)', borderRadius: 1, marginTop: 4, overflow: 'hidden' }}>
          {epgProgress !== null && (
            <div style={{ height: '100%', width: `${epgProgress}%`, background: 'var(--accent-live)', borderRadius: 1 }} />
          )}
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
      background: 'rgba(0,0,0,0)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: 0, transition: 'opacity 0.15s, background 0.15s', zIndex: 3,
    }}
    onMouseEnter={(e) => {
      const el = e.currentTarget as HTMLElement
      el.style.opacity = '1'
      el.style.background = 'rgba(0,0,0,0.35)'
    }}
    onMouseLeave={(e) => {
      const el = e.currentTarget as HTMLElement
      el.style.opacity = '0'
      el.style.background = 'rgba(0,0,0,0)'
    }}
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

