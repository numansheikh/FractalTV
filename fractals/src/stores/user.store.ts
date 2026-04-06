import { create } from 'zustand'
import { api } from '@/lib/api'

interface UserData {
  favorite: number
  watchlist: number
  last_position: number
  completed: number
  last_watched_at: number | null
  rating: number | null
}

interface UserStore {
  data: Record<string, UserData>
  loadBulk: (ids: string[]) => Promise<void>
  setFavorite: (id: string, val: boolean) => void
  setWatchlist: (id: string, val: boolean) => void
  setPosition: (id: string, pos: number) => void
  setCompleted: (id: string) => void
  setRating: (id: string, rating: number | null) => void
  clearItemHistory: (id: string) => void
}

export const useUserStore = create<UserStore>((set, get) => ({
  data: {},

  loadBulk: async (ids: string[]) => {
    if (!ids.length) return
    // Only fetch IDs we don't already have
    const existing = get().data
    const missing = ids.filter((id) => !(id in existing))
    if (!missing.length) return
    const result = await api.user.bulkGetData(missing)
    set((state) => ({ data: { ...state.data, ...result } }))
  },

  setFavorite: (id, val) => {
    set((state) => ({
      data: {
        ...state.data,
        [id]: { ...defaultData(state.data[id]), favorite: val ? 1 : 0 },
      },
    }))
  },

  setWatchlist: (id, val) => {
    set((state) => ({
      data: {
        ...state.data,
        [id]: { ...defaultData(state.data[id]), watchlist: val ? 1 : 0 },
      },
    }))
  },

  setPosition: (id, pos) => {
    set((state) => ({
      data: {
        ...state.data,
        [id]: { ...defaultData(state.data[id]), last_position: pos, last_watched_at: Date.now() / 1000 },
      },
    }))
  },

  setCompleted: (id) => {
    set((state) => ({
      data: {
        ...state.data,
        [id]: { ...defaultData(state.data[id]), completed: 1, last_position: 0 },
      },
    }))
  },

  setRating: (id, rating) => {
    set((state) => ({
      data: {
        ...state.data,
        [id]: { ...defaultData(state.data[id]), rating },
      },
    }))
  },

  clearItemHistory: (id) => {
    set((state) => ({
      data: {
        ...state.data,
        [id]: { ...defaultData(state.data[id]), last_position: 0, completed: 0, last_watched_at: null },
      },
    }))
  },
}))

function defaultData(existing?: UserData): UserData {
  return existing ?? { favorite: 0, watchlist: 0, last_position: 0, completed: 0, last_watched_at: null, rating: null }
}
