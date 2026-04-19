import { describe, it, expect } from 'vitest'
import {
  buildNodes, computeState, toggleNode, resolveSelection, countSelectedItems,
  getLeafIds,
  type ExportTree, type Selection,
} from '../src/lib/export-selection'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TREE: ExportTree = {
  favorites: { channels: 5, movies: 3, series: 2 },
  sources: [
    {
      id: 'src1',
      name: 'Source 1',
      type: 'xtream',
      channels: [
        { id: 'ch-cat-1', name: 'News', count: 10 },
        { id: 'ch-cat-2', name: 'Sports', count: 8 },
      ],
      movies: [
        { id: 'mv-cat-1', name: 'Action', count: 20 },
      ],
      series: [],
    },
  ],
}

// ─── buildNodes ───────────────────────────────────────────────────────────────

describe('buildNodes', () => {
  it('always produces a Favorites root node', () => {
    const nodes = buildNodes(TREE)
    expect(nodes[0].id).toBe('favorites')
    expect(nodes[0].children).toHaveLength(3)
  })

  it('produces a source node per source', () => {
    const nodes = buildNodes(TREE)
    const src = nodes.find(n => n.id === 'src:src1')
    expect(src).toBeDefined()
    expect(src?.label).toBe('Source 1')
  })

  it('produces channel category leaves with correct leafKind', () => {
    const nodes = buildNodes(TREE)
    const src = nodes.find(n => n.id === 'src:src1')!
    const chGroup = src.children?.find(c => c.label === 'Channels')
    expect(chGroup?.children?.[0].leafKind).toBe('channels-cat')
    expect(chGroup?.children?.[0].categoryId).toBe('ch-cat-1')
  })

  it('skips empty category groups', () => {
    const nodes = buildNodes(TREE)
    const src = nodes.find(n => n.id === 'src:src1')!
    const seriesGroup = src.children?.find(c => c.label === 'Series')
    expect(seriesGroup).toBeUndefined() // series is empty
  })
})

// ─── getLeafIds ───────────────────────────────────────────────────────────────

describe('getLeafIds', () => {
  it('returns node id for leaf', () => {
    const nodes = buildNodes(TREE)
    const favNode = nodes[0].children![0] // favorites:channels
    expect(getLeafIds(favNode)).toEqual(['favorites:channels'])
  })

  it('returns all descendant leaf ids for a parent', () => {
    const nodes = buildNodes(TREE)
    const favNode = nodes[0] // favorites root
    const ids = getLeafIds(favNode)
    expect(ids).toContain('favorites:channels')
    expect(ids).toContain('favorites:movies')
    expect(ids).toContain('favorites:series')
    expect(ids).toHaveLength(3)
  })
})

// ─── computeState ─────────────────────────────────────────────────────────────

describe('computeState', () => {
  it('returns unchecked when nothing selected', () => {
    const nodes = buildNodes(TREE)
    const sel: Selection = new Set()
    expect(computeState(nodes[0], sel)).toBe('unchecked')
  })

  it('returns checked when all leaves selected', () => {
    const nodes = buildNodes(TREE)
    const leaves = getLeafIds(nodes[0])
    const sel: Selection = new Set(leaves)
    expect(computeState(nodes[0], sel)).toBe('checked')
  })

  it('returns partial when some leaves selected', () => {
    const nodes = buildNodes(TREE)
    const sel: Selection = new Set(['favorites:channels'])
    expect(computeState(nodes[0], sel)).toBe('partial')
  })

  it('returns checked for a leaf that is selected', () => {
    const nodes = buildNodes(TREE)
    const leaf = nodes[0].children![0] // favorites:channels
    const sel: Selection = new Set(['favorites:channels'])
    expect(computeState(leaf, sel)).toBe('checked')
  })

  it('returns unchecked for a leaf not selected', () => {
    const nodes = buildNodes(TREE)
    const leaf = nodes[0].children![0]
    const sel: Selection = new Set()
    expect(computeState(leaf, sel)).toBe('unchecked')
  })
})

// ─── toggleNode ───────────────────────────────────────────────────────────────

describe('toggleNode', () => {
  it('checks all leaves when node is unchecked', () => {
    const nodes = buildNodes(TREE)
    const sel: Selection = new Set()
    const next = toggleNode(nodes[0], sel) // favorites root, currently unchecked
    expect(next.has('favorites:channels')).toBe(true)
    expect(next.has('favorites:movies')).toBe(true)
    expect(next.has('favorites:series')).toBe(true)
  })

  it('unchecks all leaves when node is checked', () => {
    const nodes = buildNodes(TREE)
    const sel: Selection = new Set(['favorites:channels', 'favorites:movies', 'favorites:series'])
    const next = toggleNode(nodes[0], sel)
    expect(next.size).toBe(0)
  })

  it('checks all leaves when node is partial', () => {
    const nodes = buildNodes(TREE)
    const sel: Selection = new Set(['favorites:channels'])
    const next = toggleNode(nodes[0], sel) // partial → check all
    expect(next.has('favorites:movies')).toBe(true)
    expect(next.has('favorites:series')).toBe(true)
  })

  it('does not mutate the original selection', () => {
    const nodes = buildNodes(TREE)
    const sel: Selection = new Set()
    const next = toggleNode(nodes[0], sel)
    expect(sel.size).toBe(0)
    expect(next.size).toBeGreaterThan(0)
  })
})

// ─── countSelectedItems ───────────────────────────────────────────────────────

describe('countSelectedItems', () => {
  it('returns 0 when nothing selected', () => {
    const nodes = buildNodes(TREE)
    expect(countSelectedItems(nodes, new Set())).toBe(0)
  })

  it('sums counts for selected leaves', () => {
    const nodes = buildNodes(TREE)
    // favorites:channels = 5, favorites:movies = 3
    const sel: Selection = new Set(['favorites:channels', 'favorites:movies'])
    expect(countSelectedItems(nodes, sel)).toBe(8)
  })

  it('counts category items correctly', () => {
    const nodes = buildNodes(TREE)
    // src1 News = 10, src1 Sports = 8
    const sel: Selection = new Set([
      'src:src1:channels:ch-cat-1',
      'src:src1:channels:ch-cat-2',
    ])
    expect(countSelectedItems(nodes, sel)).toBe(18)
  })
})

// ─── resolveSelection ─────────────────────────────────────────────────────────

describe('resolveSelection', () => {
  it('returns all false and empty arrays when nothing selected', () => {
    const nodes = buildNodes(TREE)
    const result = resolveSelection(nodes, new Set())
    expect(result.favoritesChannels).toBe(false)
    expect(result.favoritesMovies).toBe(false)
    expect(result.favoritesSeries).toBe(false)
    expect(result.channelCategoryIds).toHaveLength(0)
    expect(result.movieCategoryIds).toHaveLength(0)
    expect(result.seriesCategoryIds).toHaveLength(0)
  })

  it('sets favoritesChannels when favorites:channels is selected', () => {
    const nodes = buildNodes(TREE)
    const result = resolveSelection(nodes, new Set(['favorites:channels']))
    expect(result.favoritesChannels).toBe(true)
    expect(result.favoritesMovies).toBe(false)
  })

  it('populates channelCategoryIds with sourceId + categoryId', () => {
    const nodes = buildNodes(TREE)
    const sel: Selection = new Set(['src:src1:channels:ch-cat-1'])
    const result = resolveSelection(nodes, sel)
    expect(result.channelCategoryIds).toHaveLength(1)
    expect(result.channelCategoryIds[0]).toEqual({ sourceId: 'src1', categoryId: 'ch-cat-1' })
  })

  it('populates movieCategoryIds correctly', () => {
    const nodes = buildNodes(TREE)
    const sel: Selection = new Set(['src:src1:movies:mv-cat-1'])
    const result = resolveSelection(nodes, sel)
    expect(result.movieCategoryIds).toHaveLength(1)
    expect(result.movieCategoryIds[0]).toEqual({ sourceId: 'src1', categoryId: 'mv-cat-1' })
  })

  it('handles full selection across all types', () => {
    const nodes = buildNodes(TREE)
    const all = new Set<string>()
    for (const n of nodes) for (const id of getLeafIds(n)) all.add(id)
    const result = resolveSelection(nodes, all)
    expect(result.favoritesChannels).toBe(true)
    expect(result.favoritesMovies).toBe(true)
    expect(result.favoritesSeries).toBe(true)
    expect(result.channelCategoryIds).toHaveLength(2)
    expect(result.movieCategoryIds).toHaveLength(1)
  })
})
