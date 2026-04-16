import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ContentItem } from '@/lib/types'
import { api } from '@/lib/api'
import { fmtTime } from '@/lib/time'
import { useSourcesStore } from '@/stores/sources.store'
import { useAppStore } from '@/stores/app.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'

// ── Layout constants ──────────────────────────────────────────────────────────
const HOUR_PX = 200       // pixels per hour
const ROW_H = 50          // row height in px
const CH_COL_W = 300      // channel list column width
const DETAIL_W = 240      // Program Detail width
const TOTAL_HOURS = 24    // 24h window fetched
const EPG_PAGE_SIZE = 100 // channels per EPG fetch batch

type EpgProgramme = {
  id: string
  title: string
  description?: string | null
  startTime: number  // unix seconds
  endTime: number
  category?: string | null
}

type EpgChannel = {
  contentId: string
  title: string
  posterUrl?: string
  sourceId: string
  catchupSupported: boolean
  catchupDays: number
  externalId: string
}

interface Props {
  channels: ContentItem[]          // channel surf list
  activeChannel: ContentItem       // currently playing channel
  onSwitchChannel: (ch: ContentItem) => void
  onFullscreen: (ch: ContentItem) => void
  onClose: () => void
}

export function EpgGuide({ channels, activeChannel, onSwitchChannel, onFullscreen, onClose }: Props) {
  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)
  const storedTz = useAppStore((s) => s.timezone)
  const tzLabel = (() => {
    const tz = storedTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    try {
      return new Intl.DateTimeFormat([], { timeZoneName: 'short', timeZone: tz }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? tz
    } catch { return tz }
  })()

  // ── Data ──────────────────────────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000)
  // Window start = 4h before now, snapped to hour
  const windowStart = nowSec - 4 * 3600 - ((nowSec - 4 * 3600) % 3600)

  const [epgChannels, setEpgChannels] = useState<EpgChannel[]>([])
  const [programmes, setProgrammes] = useState<Record<string, EpgProgramme[]>>({})
  const [loading, setLoading] = useState(true)
  const [loadedCount, setLoadedCount] = useState(0) // how many channel IDs fetched so far
  const [loadingMore, setLoadingMore] = useState(false)
  const allChannelIds = channels.map((c) => c.id)
  const channelIdKey = useMemo(() => allChannelIds.join(','), [allChannelIds.length, channels])
  const hasMore = loadedCount < allChannelIds.length

  const fetchBatch = useCallback((startIdx: number, append: boolean) => {
    const batch = allChannelIds.slice(startIdx, startIdx + EPG_PAGE_SIZE)
    if (!batch.length) return
    const isFirst = !append
    if (isFirst) setLoading(true)
    else setLoadingMore(true)

    api.epg.guide({
      contentIds: batch,
      startTime: windowStart,
      endTime: windowStart + TOTAL_HOURS * 3600,
    }).then((data) => {
      setEpgChannels((prev) => append ? [...prev, ...data.channels] : data.channels)
      setProgrammes((prev) => append ? { ...prev, ...data.programmes } : data.programmes)
      setLoadedCount(startIdx + batch.length)
      if (isFirst) setLoading(false)
      else setLoadingMore(false)
    })
  }, [channelIdKey, windowStart])

  // Initial load: first 100 channels
  useEffect(() => {
    setLoadedCount(0)
    setEpgChannels([])
    setProgrammes({})
    fetchBatch(0, false)
  }, [allChannelIds.join(',')])

  // ── UI state ──────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState('')
  const [selectedProg, setSelectedProg] = useState<{ prog: EpgProgramme; channel: EpgChannel } | null>(null)
  const [isFav, setIsFav] = useState(false)

  // ── Scroll refs ───────────────────────────────────────────────────────────
  const progScrollRef = useRef<HTMLDivElement>(null)
  const chListRef = useRef<HTMLDivElement>(null)
  const timeHdrScrollRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)

  const handleProgScroll = useCallback(() => {
    if (syncingRef.current) return
    syncingRef.current = true
    const el = progScrollRef.current
    if (!el) { syncingRef.current = false; return }
    if (chListRef.current) chListRef.current.scrollTop = el.scrollTop
    if (timeHdrScrollRef.current) timeHdrScrollRef.current.scrollLeft = el.scrollLeft
    syncingRef.current = false
  }, [])

  const handleChScroll = useCallback(() => {
    if (syncingRef.current) return
    syncingRef.current = true
    if (progScrollRef.current && chListRef.current) {
      progScrollRef.current.scrollTop = chListRef.current.scrollTop
    }
    syncingRef.current = false
  }, [])

  // Scroll to "now" on mount
  useEffect(() => {
    if (loading) return
    const nowOffset = ((nowSec - windowStart) / 3600) * HOUR_PX
    const target = Math.max(0, nowOffset - 120)
    setTimeout(() => {
      progScrollRef.current?.scrollTo({ left: target, behavior: 'instant' })
      if (timeHdrScrollRef.current) timeHdrScrollRef.current.scrollLeft = target
    }, 50)
  }, [loading])

  const scrollToNow = () => {
    const nowOffset = ((nowSec - windowStart) / 3600) * HOUR_PX
    const target = Math.max(0, nowOffset - 120)
    progScrollRef.current?.scrollTo({ left: target, behavior: 'smooth' })
  }

  // Escape is handled by LiveView (registered first, owns the chain)

  // ── Helpers ───────────────────────────────────────────────────────────────
  const fmtDur = (startTime: number, endTime: number) => {
    const mins = Math.round((endTime - startTime) / 60)
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`
  }
  const dateLabel = new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })

  // Total canvas width
  const totalW = HOUR_PX * TOTAL_HOURS
  // Position helpers
  const timeToX = (unix: number) => ((unix - windowStart) / 3600) * HOUR_PX
  const nowX = timeToX(nowSec)

  // Filtered channel list (only channels with EPG data or always show all?)
  // Show all channels that exist in epgChannels (returned from IPC)
  const filteredChannels = epgChannels.filter((ch) =>
    !filter || ch.title.toLowerCase().includes(filter.toLowerCase())
  )

  // Virtual scrolling for channel rows (shared between channel list + programme grid)
  const rowVirtualizer = useVirtualizer({
    count: filteredChannels.length,
    getScrollElement: () => progScrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 5,
  })

  // ── Watch handler ─────────────────────────────────────────────────────────
  const handleWatch = async () => {
    if (!selectedProg) return
    const { prog, channel } = selectedProg
    const nowSec2 = Math.floor(Date.now() / 1000)
    const isNow = prog.startTime <= nowSec2 && prog.endTime > nowSec2
    const isPast = prog.endTime <= nowSec2
    const contentItem = channels.find((c) => c.id === channel.contentId)
    if (!contentItem) return

    if (isPast && channel.catchupSupported) {
      const durationMins = Math.round((prog.endTime - prog.startTime) / 60)
      const result = await api.content.getCatchupUrl({
        contentId: channel.contentId,
        startTime: prog.startTime,
        duration: durationMins,
      })
      if (result.url) {
        onFullscreen({ ...contentItem, _catchupUrl: result.url })
        onClose()
      }
    } else if (isNow || !isPast) {
      // Live or future — switch to channel in Live View
      onSwitchChannel(contentItem)
      onClose()
    }
  }

  // ── Date nav (prev/next day) ──────────────────────────────────────────────
  const shiftScroll = (hours: number) => {
    const el = progScrollRef.current
    if (!el) return
    const delta = hours * HOUR_PX
    const next = el.scrollLeft + delta
    el.scrollTo({ left: next, behavior: 'smooth' })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 60,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(3px)',
          animation: 'fadeIn 0.2s ease',
        }}
      />

      {/* Bottom sheet */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, height: '73vh',
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--border-default)',
        borderRadius: '14px 14px 0 0',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', zIndex: 61,
        boxShadow: '0 -12px 48px rgba(0,0,0,0.7)',
        animation: 'epgSlideUp 0.22s cubic-bezier(0.16,1,0.3,1)',
      }}>
        {/* Handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-default)', margin: '10px auto 0', flexShrink: 0 }} />

        {/* Header */}
        <div style={{
          height: 44, flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 16px',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)' }}>EPG Guide</span>
          <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{dateLabel}</span>
          <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', padding: '2px 5px', borderRadius: 4, background: 'var(--bg-3)' }}>{tzLabel}</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => shiftScroll(-2)} style={navBtnStyle}>‹</button>
          <button onClick={() => shiftScroll(2)} style={navBtnStyle}>›</button>
          <button onClick={scrollToNow} style={{
            height: 28, padding: '0 10px', borderRadius: 7,
            background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.25)',
            color: 'var(--accent-live)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-live)', display: 'inline-block', animation: 'pulse 1.4s ease-in-out infinite' }} />
            Now
          </button>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-3)',
            border: 'none', color: 'var(--text-2)', fontSize: 18, lineHeight: 1,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        {/* Grid area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

          {/* Channel column */}
          <div style={{ width: CH_COL_W, flexShrink: 0, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' }}>
            {/* Filter input */}
            <div style={{ height: 30, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 10px' }}>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter channels…"
                style={{
                  width: '100%', background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 11, color: 'var(--text-0)', fontFamily: 'var(--font-ui)',
                }}
              />
            </div>

            {/* Channel list (scroll-synced to programme grid via virtualizer) */}
            <div
              ref={chListRef}
              onScroll={handleChScroll}
              style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
            >
              {loading
                ? <div style={{ padding: '20px 10px', fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>Loading…</div>
                : filteredChannels.length === 0
                  ? <div style={{ padding: '20px 10px', fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>No EPG data</div>
                  : <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                    {rowVirtualizer.getVirtualItems().map((vRow) => {
                      const ch = filteredChannels[vRow.index]
                      const srcColor = colorMap[ch.sourceId]
                      const isPlaying = ch.contentId === activeChannel.id
                      const nowProg = programmes[ch.contentId]?.find((p) => p.startTime <= nowSec && p.endTime > nowSec)
                      return (
                        <div
                          key={ch.contentId}
                          onClick={() => {
                            const item = channels.find((c) => c.id === ch.contentId)
                            if (item) onSwitchChannel(item)
                            onClose()
                          }}
                          style={{
                            position: 'absolute', top: 0, left: 0, width: '100%',
                            transform: `translateY(${vRow.start}px)`,
                            height: ROW_H, display: 'flex', alignItems: 'center', gap: 8,
                            padding: '0 10px',
                            borderBottom: '1px solid var(--border-subtle)',
                            cursor: 'pointer',
                            background: isPlaying ? 'rgba(139,92,246,0.1)' : 'transparent',
                            borderLeft: isPlaying ? '2px solid var(--accent-interactive)' : '2px solid transparent',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={(e) => { if (!isPlaying) (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)' }}
                          onMouseLeave={(e) => { if (!isPlaying) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                        >
                          {/* Logo */}
                          <div style={{
                            width: 28, height: 28, borderRadius: 5, flexShrink: 0,
                            background: srcColor ? `${srcColor.accent}20` : 'var(--bg-3)',
                            border: `1px solid ${srcColor ? `${srcColor.accent}30` : 'transparent'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 7, fontWeight: 700, color: srcColor?.accent ?? 'var(--text-3)',
                            overflow: 'hidden',
                          }}>
                            {ch.posterUrl
                              ? <img src={ch.posterUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                              : ch.title.split(' ')[0].toUpperCase().substring(0, 4)
                            }
                          </div>
                          {/* Name + now programme */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.title}</div>
                            {nowProg && <div style={{ fontSize: 9, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{nowProg.title}</div>}
                          </div>
                          {/* Source dot */}
                          {srcColor && <div style={{ width: 5, height: 5, borderRadius: '50%', background: srcColor.accent, flexShrink: 0 }} />}
                        </div>
                      )
                    })}
                  </div>
              }
              {/* Load more button */}
              {!loading && hasMore && (
                <button
                  onClick={() => fetchBatch(loadedCount, true)}
                  disabled={loadingMore}
                  style={{
                    width: '100%', padding: '10px 0', border: 'none',
                    background: 'transparent', color: 'var(--text-1)',
                    fontSize: 11, fontWeight: 500, cursor: loadingMore ? 'default' : 'pointer',
                    fontFamily: 'var(--font-ui)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-0)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-1)' }}
                >
                  {loadingMore ? 'Loading…' : `Load more (${allChannelIds.length - loadedCount} remaining)`}
                </button>
              )}
            </div>
          </div>

          {/* Timeline + Program Detail */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0 }}>

            {/* Timeline column */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

              {/* Time header (horizontal scroll only) */}
              <div style={{ height: 30, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, overflow: 'hidden', position: 'relative' }}>
                <div
                  ref={timeHdrScrollRef}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflowX: 'hidden', overflowY: 'hidden' }}
                >
                  <div style={{ display: 'flex', width: totalW, height: '100%' }}>
                    {Array.from({ length: TOTAL_HOURS }, (_, h) => {
                      const t = new Date((windowStart + h * 3600) * 1000)
                      const label = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      return (
                        <div key={h} style={{
                          width: HOUR_PX, flexShrink: 0, height: '100%',
                          display: 'flex', alignItems: 'center',
                          paddingLeft: 8, fontSize: 10,
                          color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
                          borderRight: '1px solid var(--border-subtle)',
                          position: 'relative',
                        }}>
                          {label}
                          {/* 30-min half mark */}
                          <div style={{ position: 'absolute', right: '50%', top: '40%', height: '40%', width: 1, background: 'var(--border-subtle)' }} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Programme scroll area */}
              <div
                ref={progScrollRef}
                onScroll={handleProgScroll}
                style={{ flex: 1, overflow: 'auto', position: 'relative' }}
              >
                {/* Canvas */}
                <div style={{ width: totalW, position: 'relative' }}>
                  {/* Now line */}
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0, left: nowX, width: 2,
                    background: 'var(--accent-live)', zIndex: 10, pointerEvents: 'none',
                    boxShadow: '0 0 8px rgba(244,63,94,0.7)',
                  }}>
                    <div style={{ position: 'absolute', top: -1, left: -4, width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-live)' }} />
                  </div>

                  {/* Programme rows (virtualized) */}
                  {loading
                    ? <div style={{ padding: 20, fontSize: 11, color: 'var(--text-3)' }}>Loading EPG data…</div>
                    : <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                      {rowVirtualizer.getVirtualItems().map((vRow) => {
                        const ch = filteredChannels[vRow.index]
                        const srcColor = colorMap[ch.sourceId]
                        const progs = programmes[ch.contentId] ?? []
                        return (
                          <div key={ch.contentId} style={{
                            position: 'absolute', top: 0, left: 0, width: totalW,
                            transform: `translateY(${vRow.start}px)`,
                            height: ROW_H, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
                          }}>
                            {progs.map((prog) => {
                              const left = timeToX(prog.startTime)
                              const right = timeToX(prog.endTime)
                              const width = right - left - 3
                              if (width < 4) return null

                              const isNow = prog.startTime <= nowSec && prog.endTime > nowSec
                              const isPast = prog.endTime <= nowSec
                              const isSelected = selectedProg?.prog.id === prog.id
                              const durationMins = Math.round((prog.endTime - prog.startTime) / 60)
                              const blockBg = isNow
                                ? (srcColor?.solidStrong ?? 'color-mix(in srgb, #8b5cf6 85%, transparent)')
                                : (srcColor?.solid      ?? 'color-mix(in srgb, #8b5cf6 65%, transparent)')

                              return (
                                <div
                                  key={prog.id}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedProg({ prog, channel: ch })
                                    api.user.getData(ch.contentId).then((d: { favorite?: number } | null) => setIsFav(!!d?.favorite))
                                  }}
                                  style={{
                                    position: 'absolute',
                                    top: 4, bottom: 4,
                                    left, width,
                                    borderRadius: 5,
                                    padding: '0 7px',
                                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                                    cursor: 'pointer',
                                    overflow: 'hidden',
                                    background: blockBg,
                                    border: `1px solid ${isSelected ? 'rgba(255,255,255,0.6)' : isNow ? 'rgba(255,255,255,0.25)' : (srcColor?.border ?? 'transparent')}`,
                                    opacity: isPast ? 0.45 : 1,
                                    transition: 'filter 0.12s',
                                  }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = 'brightness(1.15)' }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = 'none' }}
                                >
                                  <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
                                    {prog.title}
                                  </div>
                                  {durationMins >= 30 && (
                                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.75)', fontFamily: 'var(--font-mono)', marginTop: 1, whiteSpace: 'nowrap' }}>
                                      {fmtTime(prog.startTime)}–{fmtTime(prog.endTime)}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  }
                </div>
              </div>
            </div>

            {/* Detail panel */}
            <div style={{
              width: selectedProg ? DETAIL_W : 0,
              flexShrink: 0, overflow: 'hidden',
              background: 'var(--bg-2)',
              borderLeft: selectedProg ? '1px solid var(--border-subtle)' : 'none',
              transition: 'width 0.22s cubic-bezier(0.16,1,0.3,1)',
              display: 'flex', flexDirection: 'column',
            }}>
              {selectedProg && (
                <DetailPanel
                  prog={selectedProg.prog}
                  channel={selectedProg.channel}
                  nowSec={nowSec}
                  programmes={programmes}
                  colorMap={colorMap}
                  isFav={isFav}
                  fmtTime={fmtTime}
                  fmtDur={fmtDur}
                  onWatch={handleWatch}
                  onToggleFav={async () => {
                    const next = !isFav
                    setIsFav(next)
                    try {
                      await api.user.toggleFavorite(selectedProg.channel.contentId)
                    } catch {
                      setIsFav(!next) // rollback
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes epgSlideUp {
          from { transform: translateY(60px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; } to { opacity: 1; }
        }
      `}</style>
    </>
  )
}

// ── Detail panel sub-component ────────────────────────────────────────────────

function DetailPanel({
  prog, channel, nowSec, programmes, colorMap, isFav, fmtTime, fmtDur, onWatch, onToggleFav,
}: {
  prog: EpgProgramme
  channel: EpgChannel
  nowSec: number
  programmes: Record<string, EpgProgramme[]>
  colorMap: Record<string, { accent: string; dim: string }>
  isFav: boolean
  fmtTime: (unix: number) => string
  fmtDur: (start: number, end: number) => string
  onWatch: () => void
  onToggleFav: () => void
}) {
  const isNow = prog.startTime <= nowSec && prog.endTime > nowSec
  const isPast = prog.endTime <= nowSec
  const progress = isNow
    ? Math.min(100, Math.max(0, ((nowSec - prog.startTime) / (prog.endTime - prog.startTime)) * 100))
    : 0

  // Up-next: next 3 programmes after this one
  const upcoming = (programmes[channel.contentId] ?? [])
    .filter((p) => p.startTime > prog.startTime)
    .slice(0, 3)

  const srcColor = colorMap[channel.sourceId]

  const watchLabel = isPast && channel.catchupSupported ? '▶ Watch from start' : isNow ? '▶ Watch now' : '▶ Watch'
  const canWatch = isNow || isPast && channel.catchupSupported || !isPast

  return (
    <div style={{ width: DETAIL_W, padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flex: 1 }}>
      {/* Channel info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6, flexShrink: 0,
          background: srcColor ? `${srcColor.accent}20` : 'var(--bg-3)',
          border: `1px solid ${srcColor ? `${srcColor.accent}30` : 'transparent'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 7, fontWeight: 700, color: srcColor?.accent ?? 'var(--text-3)',
          overflow: 'hidden',
        }}>
          {channel.posterUrl
            ? <img src={channel.posterUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
            : channel.title.split(' ')[0].toUpperCase().substring(0, 4)
          }
        </div>
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-1)' }}>{channel.title}</span>
      </div>

      {/* Programme title */}
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.35 }}>{prog.title}</div>

      {/* Time row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {isNow && (
          <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: 'var(--accent-live)', color: '#fff', letterSpacing: '0.05em' }}>LIVE</span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
          {fmtTime(prog.startTime)} – {fmtTime(prog.endTime)}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{fmtDur(prog.startTime, prog.endTime)}</span>
      </div>

      {/* Progress bar (only for current programme) */}
      {isNow && (
        <div style={{ height: 3, background: 'var(--bg-4)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent-live)', borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
      )}

      {/* Description */}
      {prog.description && (
        <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.6 }}>{prog.description}</div>
      )}

      {/* Up next */}
      {upcoming.length > 0 && (
        <>
          <div style={{ height: 1, background: 'var(--border-subtle)' }} />
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Up next</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {upcoming.map((u) => (
              <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.title}</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{fmtTime(u.startTime)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={onWatch}
          disabled={!canWatch}
          style={{
            flex: 1, padding: '8px', borderRadius: 7, fontSize: 12, fontWeight: 600,
            background: canWatch ? 'var(--accent-interactive)' : 'var(--bg-3)',
            border: 'none', color: canWatch ? '#fff' : 'var(--text-3)', cursor: canWatch ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            transition: 'opacity 0.1s',
          }}
          onMouseEnter={(e) => { if (canWatch) (e.currentTarget as HTMLElement).style.opacity = '0.85' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
        >
          {watchLabel}
        </button>
        <button
          onClick={onToggleFav}
          style={{
            width: 34, padding: 8, borderRadius: 7, fontSize: 16,
            background: 'var(--bg-3)', border: '1px solid var(--border-default)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: isFav ? '#fbbf24' : 'var(--text-2)',
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-4)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)' }}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          {isFav ? '★' : '☆'}
        </button>
      </div>
    </div>
  )
}

// ── Shared button style ───────────────────────────────────────────────────────
const navBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 7,
  background: 'var(--bg-2)', border: '1px solid var(--border-default)',
  color: 'var(--text-1)', fontSize: 16, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
