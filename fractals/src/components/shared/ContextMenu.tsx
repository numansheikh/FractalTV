import { useEffect, useCallback } from 'react'
import { useContextMenuStore } from '@/stores/contextMenu.store'
import { useUserStore } from '@/stores/user.store'
import { useAppStore } from '@/stores/app.store'
import { useSearchStore } from '@/stores/search.store'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

const VIEW_MAP = { live: 'live', movie: 'films', series: 'series' } as const

export function ContextMenu() {
  const { visible, x, y, item, hide } = useContextMenuStore()
  const userData = useUserStore((s) => item ? s.data[item.id] : undefined)
  const setFav = useUserStore((s) => s.setFavorite)
  const setWl = useUserStore((s) => s.setWatchlist)
  const qc = useQueryClient()

  const isFavorite = userData?.favorite === 1
  const isWatchlist = userData?.watchlist === 1
  const isLive = item?.type === 'live'

  // Close on click outside, Escape, or scroll
  useEffect(() => {
    if (!visible) return
    const close = () => hide()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
    }
  }, [visible, hide])

  const handleFavorite = useCallback(() => {
    if (!item) return
    setFav(item.id, !isFavorite)
    api.user.toggleFavorite(item.id).catch(() => {
      setFav(item.id, isFavorite)
    })
    hide()
  }, [item, isFavorite, setFav, hide])

  const handleWatchlist = useCallback(() => {
    if (!item) return
    setWl(item.id, !isWatchlist)
    api.user.toggleWatchlist(item.id).then(() => {
      qc.invalidateQueries({ queryKey: ['home-watchlist'] })
      qc.invalidateQueries({ queryKey: ['library', 'watchlist'] })
    }).catch(() => {
      setWl(item.id, isWatchlist)
    })
    hide()
  }, [item, isWatchlist, setWl, qc, hide])

  const handleBrowseCategory = useCallback(async () => {
    if (!item) return
    hide()
    const full = await api.content.get(item.id) as any
    const categoryName = full?.category_name?.split(',')[0]
    if (!categoryName) return
    const viewKey = item.type ? VIEW_MAP[item.type as keyof typeof VIEW_MAP] : undefined
    if (viewKey) {
      useSearchStore.getState().setQuery('')
      const store = useAppStore.getState()
      store.clearSourceFilter()
      store.setView(viewKey as any)
      store.setCategoryFilter(categoryName)
    }
  }, [item, hide])

  if (!visible || !item) return null

  // Clamp menu position to viewport
  const menuW = 180
  const menuH = isLive ? 100 : 130 // approximate
  const posX = Math.min(x, window.innerWidth - menuW - 8)
  const posY = Math.min(y, window.innerHeight - menuH - 8)

  return (
    <div
      style={{
        position: 'fixed',
        left: posX,
        top: posY,
        width: menuW,
        zIndex: 200,
        background: 'var(--bg-2)',
        border: '1px solid var(--border-strong)',
        borderRadius: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
        padding: '4px 0',
        fontFamily: 'var(--font-ui)',
        fontSize: 12,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem
        icon={<HeartIcon filled={isFavorite} />}
        label={isFavorite ? 'Remove Favorite' : 'Add to Favorites'}
        onClick={handleFavorite}
      />
      {!isLive && (
        <MenuItem
          icon={<BookmarkIcon filled={isWatchlist} />}
          label={isWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
          onClick={handleWatchlist}
        />
      )}
      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 8px' }} />
      <MenuItem
        icon={<FolderIcon />}
        label="Browse Category"
        onClick={handleBrowseCategory}
      />
    </div>
  )
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 12px',
        background: 'transparent',
        border: 'none',
        color: 'var(--text-1)',
        fontSize: 12,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'var(--font-ui)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, width: 14, justifyContent: 'center' }}>{icon}</span>
      {label}
    </button>
  )
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24"
      fill={filled ? '#f43f5e' : 'none'}
      stroke={filled ? '#f43f5e' : 'currentColor'}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24"
      fill={filled ? '#8b5cf6' : 'none'}
      stroke={filled ? '#8b5cf6' : 'currentColor'}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}
