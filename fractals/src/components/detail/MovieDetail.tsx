import { useQuery } from '@tanstack/react-query'
import { ContentItem, BreadcrumbNav } from '@/lib/types'
import { api } from '@/lib/api'
import { useSourcesStore } from '@/stores/sources.store'
import { buildColorMapFromSources } from '@/lib/sourceColors'
import { SlidePanel } from '@/components/layout/SlidePanel'
import { MetadataBlock } from './MetadataBlock'
import { ActionButtons } from './ActionButtons'
import { AboutBlock } from './AboutBlock'
import { DetailShell, BreadcrumbItem } from './DetailShell'

interface Props {
  item: ContentItem
  onPlay: (item: ContentItem) => void
  onClose: () => void
  onNavigate: (nav: BreadcrumbNav) => void
  isPlaying?: boolean
}

export function MovieDetail({ item, onPlay, onClose, onNavigate, isPlaying }: Props) {
  const { sources } = useSourcesStore()
  const colorMap = buildColorMapFromSources(sources)

  const { data: enrichedItem } = useQuery({
    queryKey: ['content', item.id],
    queryFn: () => api.content.get(item.id),
    staleTime: 5 * 60_000,
  })

  const c = (enrichedItem as ContentItem | null) ?? item
  const primarySourceId = c.primarySourceId ?? c.primary_source_id ?? item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]
  const sourceColor = primarySourceId ? colorMap[primarySourceId] : undefined
  const primarySource = primarySourceId ? sources.find((s) => s.id === primarySourceId) : undefined

  let allSourceIds: string[] = []
  try {
    if (c.sourceIds) allSourceIds = JSON.parse(c.sourceIds)
  } catch {
    if (c.sourceIds) allSourceIds = [c.sourceIds]
  }
  if (!allSourceIds.length && primarySourceId) allSourceIds = [primarySourceId]

  const categoryName = (c as any).categoryName ?? (c as any).category_name

  const breadcrumbs: BreadcrumbItem[] = [
    ...(primarySource && sourceColor ? [{
      label: primarySource.name,
      color: sourceColor.accent,
      onClick: () => onNavigate({ sourceId: primarySourceId }),
    }] : []),
    { label: 'Films', color: 'var(--accent-film)', onClick: () => onNavigate({ type: 'movie' }) },
    ...(categoryName ? [{
      label: categoryName,
      color: 'var(--accent-film)',
      onClick: () => onNavigate({ type: 'movie', category: categoryName }),
      bold: true,
    }] : []),
  ]

  return (
    <SlidePanel open={true} onClose={onClose} width={380} suppressClose={isPlaying}>
      <DetailShell
        typeBadge={{ label: 'FILM', accent: 'var(--accent-film)' }}
        breadcrumbs={breadcrumbs}
        primarySource={primarySource}
        primarySourceColor={sourceColor}
        allSourceIds={allSourceIds}
        sourceColorMap={colorMap}
        onClose={onClose}
      >
        <MetadataBlock item={c} />
        <ActionButtons item={c} onPlay={onPlay} />
        <AboutBlock item={c} onClose={onClose} />
      </DetailShell>
    </SlidePanel>
  )
}
