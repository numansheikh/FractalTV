/**
 * EnrichmentFallback — V3 minimal status display.
 *
 * V3 enrichment runs in a background worker driven by keyless providers
 * (IMDb suggest + Wikidata for VoD, iptv-org for Live). There's no per-item
 * "enrich now" action any more — this component just surfaces the current
 * state for unresolved canonicals and invites the user to wait. The manual
 * match / "wrong match" UI is deferred to Phase G.
 */
import { ContentItem } from '@/lib/types'

interface Props {
  item: ContentItem
  onEnriched: () => void
}

export function EnrichmentFallback({ item }: Props) {
  if (item.enriched) return null
  if (item.type === 'live') return null

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        background: 'var(--bg-2)',
        border: '1px solid var(--border-subtle)',
        fontSize: 11,
        color: 'var(--text-2)',
        fontFamily: 'var(--font-ui)',
        lineHeight: 1.5,
      }}
    >
      Metadata pending — the background enrichment worker will pull clean
      title, poster, and multilingual labels from IMDb + Wikidata shortly.
    </div>
  )
}
