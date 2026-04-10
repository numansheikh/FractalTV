import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSourcesStore } from '@/stores/sources.store'
import { useUserStore } from '@/stores/user.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { ContentItem } from './ContentCard'
import { api } from '@/lib/api'

interface Props {
  item: ContentItem
  onClick: (item: ContentItem) => void
}

export function ChannelCard({ item, onClick }: Props) {
  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)
  const userData = useUserStore((s) => s.data[item.id])
  const setFav = useUserStore((s) => s.setFavorite)
  const [hovered, setHovered] = useState(false)
  const qc = useQueryClient()
  const primarySourceId = item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const poster = item.posterUrl ?? item.poster_url
  const isFavorite = userData?.favorite === 1

  const toggleFav = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const removing = isFavorite
    setFav(item.id, !isFavorite)
    if (removing) {
      const strip = (old: ContentItem[] | undefined) => old?.filter((i) => i.id !== item.id)
      qc.setQueriesData<ContentItem[]>({ queryKey: ['browse-favorites'] }, strip)
      qc.setQueriesData<ContentItem[]>({ queryKey: ['library', 'favorites'] }, strip)
    }
    try {
      await api.user.toggleFavorite(item.id)
    } catch {
      setFav(item.id, isFavorite)
    }
    qc.invalidateQueries({ queryKey: ['browse-favorites'] })
    qc.invalidateQueries({ queryKey: ['library', 'favorites'] })
    qc.invalidateQueries({ queryKey: ['channels', 'favorites'] })
  }

  return (
    <div
      onClick={() => onClick(item)}
      title={item.title}
      style={{
        display: 'flex', flexDirection: 'column',
        borderRadius: 8, overflow: 'hidden',
        background: 'var(--color-card)',
        border: `1px solid ${sourceColor ? sourceColor.accent + '22' : 'var(--color-border)'}`,
        cursor: 'pointer', transition: 'all 0.12s',
        userSelect: 'none', position: 'relative',
      }}
      onMouseEnter={(e) => {
        setHovered(true)
        e.currentTarget.style.background = 'var(--color-card-hover)'
        e.currentTarget.style.borderColor = sourceColor ? sourceColor.accent + '55' : 'var(--color-border-strong)'
        e.currentTarget.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={(e) => {
        setHovered(false)
        e.currentTarget.style.background = 'var(--color-card)'
        e.currentTarget.style.borderColor = sourceColor ? sourceColor.accent + '22' : 'var(--color-border)'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      {/* Logo area — 16:9 */}
      <div style={{
        width: '100%', paddingTop: '56.25%', position: 'relative',
        background: sourceColor ? sourceColor.accent + '14' : 'var(--color-surface)',
      }}>
        {poster ? (
          <img
            src={poster} alt=""
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', padding: '10%' }}
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke={sourceColor?.accent ?? 'var(--color-text-muted)'}
              strokeWidth="1.5" opacity={0.5}>
              <rect x="2" y="7" width="20" height="15" rx="2" />
              <polyline points="17 2 12 7 7 2" />
            </svg>
          </div>
        )}
        {/* Source color stripe — top edge */}
        {sourceColor && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: sourceColor.accent, opacity: 0.7,
          }} />
        )}
        {/* Hover favorite toggle */}
        {hovered && (
          <button onClick={toggleFav} title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            style={{
              position: 'absolute', top: 5, right: 5, zIndex: 2,
              width: 24, height: 24, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isFavorite ? 'rgba(239,68,68,0.25)' : 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
              border: `1px solid ${isFavorite ? 'rgba(239,68,68,0.4)' : 'var(--border-default)'}`,
              cursor: 'pointer', padding: 0,
            }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill={isFavorite ? '#ef4444' : 'none'} stroke={isFavorite ? '#ef4444' : 'var(--text-1)'} strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        )}
        {/* Persistent favorite indicator */}
        {isFavorite && !hovered && (
          <div style={{
            position: 'absolute', top: 5, right: 5,
            width: 20, height: 20, borderRadius: 5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#ef4444" stroke="none">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </div>
        )}
      </div>

      {/* Name row */}
      <div style={{ padding: '5px 7px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <p style={{
          fontSize: 11, fontWeight: 500, lineHeight: 1.3,
          color: 'var(--color-text-primary)',
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {item.title}
        </p>
      </div>
    </div>
  )
}
