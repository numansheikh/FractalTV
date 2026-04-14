import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ContentItem } from '@/lib/types'
import { useUserStore } from '@/stores/user.store'
import { HorizontalScroller } from './HorizontalScroller'
import { MoviePosterCard } from '@/components/cards/MoviePosterCard'
import { SeriesPosterCard } from '@/components/cards/SeriesPosterCard'
import { ChannelCard } from '@/components/cards/ChannelCard'
import { ContinueCard } from '@/components/cards/ContinueCard'

interface Props {
  onSelect: (item: ContentItem) => void
}

export function PersonalizedSection({ onSelect }: Props) {
  const loadBulk = useUserStore((s) => s.loadBulk)

  const { data: continueWatching = [] } = useQuery<ContentItem[]>({
    queryKey: ['personalized', 'continue-watching'],
    queryFn: () => api.user.continueWatching(),
    staleTime: 30_000,
  })

  const { data: favoriteChannels = [] } = useQuery<ContentItem[]>({
    queryKey: ['personalized', 'fav-channels'],
    queryFn: () => api.user.favorites({ type: 'live' }),
  })

  const { data: recentlyWatched = [] } = useQuery<ContentItem[]>({
    queryKey: ['personalized', 'recently-watched'],
    queryFn: () => api.user.history({ limit: 20 }),
  })

  // Bulk-load user data whenever queries resolve with items
  useEffect(() => {
    if (continueWatching.length > 0) loadBulk(continueWatching.map((i) => i.id))
  }, [continueWatching, loadBulk])

  useEffect(() => {
    if (favoriteChannels.length > 0) loadBulk(favoriteChannels.map((i) => i.id))
  }, [favoriteChannels, loadBulk])

  useEffect(() => {
    if (recentlyWatched.length > 0) loadBulk(recentlyWatched.map((i) => i.id))
  }, [recentlyWatched, loadBulk])

  const hasContinue = continueWatching.length > 0
  const hasFavChannels = favoriteChannels.length > 0
  const hasRecent = recentlyWatched.length > 0

  if (!hasContinue && !hasFavChannels && !hasRecent) return null

  return (
    <div style={{ padding: '16px 16px 0' }}>
      {hasContinue && (
        <HorizontalScroller label="Continue Watching">
          {continueWatching.map((item) => (
            <div key={item.id} style={{ width: 280, flexShrink: 0 }}>
              <ContinueCard item={item} onClick={onSelect} />
            </div>
          ))}
        </HorizontalScroller>
      )}

      {hasFavChannels && (
        <HorizontalScroller label="Favorite Channels">
          {favoriteChannels.map((item) => (
            <div key={item.id} style={{ width: 168, flexShrink: 0 }}>
              <ChannelCard item={item} onClick={onSelect} />
            </div>
          ))}
        </HorizontalScroller>
      )}

      {hasRecent && (
        <HorizontalScroller label="Recently Watched">
          {recentlyWatched.map((item) => {
            const isLive = item.type === 'live'
            return (
              <div key={item.id} style={{ width: isLive ? 168 : 130, flexShrink: 0 }}>
                {isLive
                  ? <ChannelCard item={item} onClick={onSelect} />
                  : item.type === 'series'
                    ? <SeriesPosterCard item={item} onClick={onSelect} />
                    : <MoviePosterCard item={item} onClick={onSelect} />
                }
              </div>
            )
          })}
        </HorizontalScroller>
      )}
    </div>
  )
}
