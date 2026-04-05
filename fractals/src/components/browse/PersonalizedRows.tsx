import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ContentItem } from './ContentCard'
import { PosterCard } from './PosterCard'
import { ChannelCard } from './ChannelCard'
import { useUserStore } from '@/stores/user.store'

interface Props {
  onSelect: (item: ContentItem) => void
  type: 'all' | 'live' | 'movie' | 'series'
}

export function PersonalizedRows({ onSelect, type }: Props) {
  const loadBulk = useUserStore((s) => s.loadBulk)

  // Continue Watching — resumable movies
  const { data: continueWatching = [] } = useQuery({
    queryKey: ['personalized', 'continue-watching'],
    queryFn: async () => {
      const items = await api.user.continueWatching()
      if (items.length) loadBulk(items.map((i: any) => i.id))
      return items as ContentItem[]
    },
    staleTime: 30_000,
    enabled: type === 'all' || type === 'movie',
  })

  // Favorite channels
  const { data: favoriteChannels = [] } = useQuery({
    queryKey: ['personalized', 'favorite-channels'],
    queryFn: async () => {
      const items = await api.user.favorites({ type: 'live' })
      if (items.length) loadBulk(items.map((i: any) => i.id))
      return items as ContentItem[]
    },
    staleTime: 30_000,
    enabled: type === 'all' || type === 'live',
  })

  // Recently Watched
  const { data: recentlyWatched = [] } = useQuery({
    queryKey: ['personalized', 'recently-watched'],
    queryFn: async () => {
      const items = await api.user.history({ limit: 20 })
      if (items.length) loadBulk(items.map((i: any) => i.id))
      return items as ContentItem[]
    },
    staleTime: 30_000,
  })

  const hasContinue = continueWatching.length > 0 && (type === 'all' || type === 'movie')
  const hasFavChannels = favoriteChannels.length > 0 && (type === 'all' || type === 'live')
  const hasRecent = recentlyWatched.length > 0

  if (!hasContinue && !hasFavChannels && !hasRecent) return null

  return (
    <div style={{ marginBottom: 16 }}>
      {hasContinue && (
        <ScrollRow label="Continue Watching">
          {continueWatching.map((item) => (
            <div key={item.id} style={{ width: 154, flexShrink: 0 }}>
              <PosterCard item={item} onClick={onSelect} />
            </div>
          ))}
        </ScrollRow>
      )}

      {hasFavChannels && (
        <ScrollRow label="Favorite Channels">
          {favoriteChannels.map((item) => (
            <div key={item.id} style={{ width: 158, flexShrink: 0 }}>
              <ChannelCard item={item} onClick={onSelect} />
            </div>
          ))}
        </ScrollRow>
      )}

      {hasRecent && (
        <ScrollRow label="Recently Watched">
          {recentlyWatched.map((item) => (
            <div key={item.id} style={{ width: item.type === 'live' ? 158 : 154, flexShrink: 0 }}>
              {item.type === 'live'
                ? <ChannelCard item={item} onClick={onSelect} />
                : <PosterCard item={item} onClick={onSelect} />
              }
            </div>
          ))}
        </ScrollRow>
      )}
    </div>
  )
}

function ScrollRow({ label, children }: {
  label: string
  children: React.ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scroll = (dir: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * 400, behavior: 'smooth' })
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '0 2px' }}>
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', margin: 0 }}>
          {label}
        </p>
        <div style={{ flex: 1 }} />
        <button onClick={() => scroll(-1)} style={arrowStyle}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <button onClick={() => scroll(1)} style={arrowStyle}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
      <div ref={scrollRef} style={{
        display: 'flex', gap: 10, overflowX: 'auto', overflowY: 'hidden',
        scrollbarWidth: 'none', paddingBottom: 4,
      }}>
        {children}
      </div>
    </div>
  )
}

const arrowStyle: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 6,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)', cursor: 'pointer',
  transition: 'all 0.1s',
}
