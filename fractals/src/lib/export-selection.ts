export type CheckState = 'unchecked' | 'checked' | 'partial'

export interface TreeNode {
  id: string
  label: string
  count?: number
  children?: TreeNode[]
  leafKind?: 'favorites-channels' | 'favorites-movies' | 'favorites-series' | 'channels-cat' | 'movies-cat' | 'series-cat'
  sourceId?: string
  categoryId?: string
}

export interface ExportTree {
  favorites: { channels: number; movies: number; series: number }
  sources: Array<{
    id: string
    name: string
    type: 'xtream' | 'm3u'
    channels: Array<{ id: string; name: string; count: number }>
    movies: Array<{ id: string; name: string; count: number }>
    series: Array<{ id: string; name: string; count: number }>
  }>
}

export type Selection = Set<string>

export function buildNodes(tree: ExportTree): TreeNode[] {
  const nodes: TreeNode[] = []

  nodes.push({
    id: 'favorites',
    label: 'Favorites',
    children: [
      { id: 'favorites:channels', label: 'Channels', count: tree.favorites.channels, leafKind: 'favorites-channels' },
      { id: 'favorites:movies', label: 'Movies', count: tree.favorites.movies, leafKind: 'favorites-movies' },
      { id: 'favorites:series', label: 'Series', count: tree.favorites.series, leafKind: 'favorites-series' },
    ],
  })

  for (const src of tree.sources) {
    const srcNode: TreeNode = {
      id: `src:${src.id}`,
      label: src.name,
      children: [],
      sourceId: src.id,
    }

    if (src.channels.length > 0) {
      srcNode.children!.push({
        id: `src:${src.id}:channels`,
        label: 'Channels',
        sourceId: src.id,
        children: src.channels.map((c) => ({
          id: `src:${src.id}:channels:${c.id}`,
          label: c.name,
          count: c.count,
          leafKind: 'channels-cat',
          sourceId: src.id,
          categoryId: c.id,
        })),
      })
    }
    if (src.movies.length > 0) {
      srcNode.children!.push({
        id: `src:${src.id}:movies`,
        label: 'Movies',
        sourceId: src.id,
        children: src.movies.map((c) => ({
          id: `src:${src.id}:movies:${c.id}`,
          label: c.name,
          count: c.count,
          leafKind: 'movies-cat',
          sourceId: src.id,
          categoryId: c.id,
        })),
      })
    }
    if (src.series.length > 0) {
      srcNode.children!.push({
        id: `src:${src.id}:series`,
        label: 'Series',
        sourceId: src.id,
        children: src.series.map((c) => ({
          id: `src:${src.id}:series:${c.id}`,
          label: c.name,
          count: c.count,
          leafKind: 'series-cat',
          sourceId: src.id,
          categoryId: c.id,
        })),
      })
    }

    nodes.push(srcNode)
  }

  return nodes
}

export function getLeafIds(node: TreeNode): string[] {
  if (!node.children || node.children.length === 0) return [node.id]
  return node.children.flatMap(getLeafIds)
}

export function computeState(node: TreeNode, selection: Selection): CheckState {
  if (!node.children || node.children.length === 0) {
    return selection.has(node.id) ? 'checked' : 'unchecked'
  }
  const leaves = getLeafIds(node)
  const checkedCount = leaves.filter((id) => selection.has(id)).length
  if (checkedCount === 0) return 'unchecked'
  if (checkedCount === leaves.length) return 'checked'
  return 'partial'
}

export function toggleNode(node: TreeNode, selection: Selection): Selection {
  const next = new Set(selection)
  const leaves = getLeafIds(node)
  const state = computeState(node, selection)
  if (state === 'checked') {
    for (const id of leaves) next.delete(id)
  } else {
    for (const id of leaves) next.add(id)
  }
  return next
}

export function countSelectedItems(nodes: TreeNode[], selection: Selection): number {
  let total = 0
  const walk = (n: TreeNode) => {
    if (!n.children || n.children.length === 0) {
      if (selection.has(n.id)) total += n.count ?? 0
      return
    }
    for (const c of n.children) walk(c)
  }
  for (const n of nodes) walk(n)
  return total
}

export interface ResolvedSelection {
  favoritesChannels: boolean
  favoritesMovies: boolean
  favoritesSeries: boolean
  channelCategoryIds: Array<{ sourceId: string; categoryId: string }>
  movieCategoryIds: Array<{ sourceId: string; categoryId: string }>
  seriesCategoryIds: Array<{ sourceId: string; categoryId: string }>
}

export function resolveSelection(nodes: TreeNode[], selection: Selection): ResolvedSelection {
  const out: ResolvedSelection = {
    favoritesChannels: false,
    favoritesMovies: false,
    favoritesSeries: false,
    channelCategoryIds: [],
    movieCategoryIds: [],
    seriesCategoryIds: [],
  }
  const walk = (n: TreeNode) => {
    if (!n.children || n.children.length === 0) {
      if (!selection.has(n.id)) return
      switch (n.leafKind) {
        case 'favorites-channels': out.favoritesChannels = true; break
        case 'favorites-movies': out.favoritesMovies = true; break
        case 'favorites-series': out.favoritesSeries = true; break
        case 'channels-cat': out.channelCategoryIds.push({ sourceId: n.sourceId!, categoryId: n.categoryId! }); break
        case 'movies-cat': out.movieCategoryIds.push({ sourceId: n.sourceId!, categoryId: n.categoryId! }); break
        case 'series-cat': out.seriesCategoryIds.push({ sourceId: n.sourceId!, categoryId: n.categoryId! }); break
      }
      return
    }
    for (const c of n.children) walk(c)
  }
  for (const n of nodes) walk(n)
  return out
}
