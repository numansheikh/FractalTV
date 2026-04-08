import { create } from 'zustand'
import { ContentItem } from '@/lib/types'

interface ContextMenuState {
  item: ContentItem | null
  x: number
  y: number
  visible: boolean
  show: (x: number, y: number, item: ContentItem) => void
  hide: () => void
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  item: null,
  x: 0,
  y: 0,
  visible: false,
  show: (x, y, item) => set({ x, y, item, visible: true }),
  hide: () => set({ visible: false, item: null }),
}))
