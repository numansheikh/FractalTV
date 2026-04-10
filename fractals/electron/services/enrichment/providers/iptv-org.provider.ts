/**
 * iptv-org MetadataProvider implementation — L10 of the V3 data-search plan.
 *
 * Routes live-TV canonical lookups against the locally-cached iptv-org bulk
 * dataset. Direct tvg-id lookups are O(1); title lookups are linear-scan
 * fuzzy matching against normalized names + alt_names.
 */

import type { IptvOrgCache, IptvOrgChannel } from '../iptv-org-cache'
import type {
  Candidate,
  ExternalIdType,
  LiveChannelMetadata,
  LookupHints,
  MetadataProvider,
  ProviderHints,
} from '../provider'

// ── Matching internals ─────────────────────────────────────────────────────

/**
 * Cheap name normalizer for fuzzy matching. This is deliberately independent
 * of `title-normalizer.ts` — that one is tuned for VoD provider titles (year
 * extraction, quality tags, etc.); channel names don't have those patterns,
 * they need a simpler cleanup.
 *
 * Steps: NFKC → lowercase → strip punctuation → collapse whitespace.
 */
function normalizeChannelName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    // Strip everything that isn't a letter, number, or whitespace.
    // \p{L} and \p{N} keep all Unicode letters/digits (Arabic, Cyrillic, CJK…).
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface ScoredCandidate {
  channel: IptvOrgChannel
  score: number
}

/**
 * Score a single channel against a normalized query.
 *
 * Scoring per the Phase E brief:
 *   1.0  exact normalized match on `name`
 *   0.9  exact normalized match on any `alt_names` entry
 *   0.7  `name` starts with query (or query starts with name — symmetric)
 *   0.5  `name` contains query (or query contains name)
 *   <0.4 dropped (returned as 0)
 */
function scoreChannel(channel: IptvOrgChannel, normalizedQuery: string): number {
  if (!normalizedQuery) return 0

  const normName = normalizeChannelName(channel.name)

  if (normName === normalizedQuery) return 1.0

  for (const alt of channel.alt_names) {
    if (normalizeChannelName(alt) === normalizedQuery) return 0.9
  }

  if (normName.startsWith(normalizedQuery) || normalizedQuery.startsWith(normName)) {
    return 0.7
  }

  if (normName.includes(normalizedQuery) || normalizedQuery.includes(normName)) {
    return 0.5
  }

  // Alt-name substring check as a weak fallback.
  for (const alt of channel.alt_names) {
    const normAlt = normalizeChannelName(alt)
    if (normAlt && (normAlt.includes(normalizedQuery) || normalizedQuery.includes(normAlt))) {
      return 0.5
    }
  }

  return 0
}

/**
 * Convert an iptv-org channel record into a Candidate shape with the
 * live-specific metadata payload attached.
 */
function channelToCandidate(channel: IptvOrgChannel, confidence: number): Candidate {
  const channelMetadata: LiveChannelMetadata = {
    iptvOrgId: channel.id,
    canonicalName: channel.name,
    country: channel.country ?? null,
    languages: channel.languages ?? [],
    categories: channel.categories ?? [],
    network: channel.network ?? null,
    owners: channel.owners ?? [],
    logoUrl: channel.logo ?? null,
    isNsfw: Boolean(channel.is_nsfw),
    broadcastArea: channel.broadcast_area ?? [],
    altNames: channel.alt_names ?? [],
  }

  return {
    rawSource: 'iptv-org',
    title: channel.name,
    type: 'live',
    externalIds: {
      iptvOrgId: channel.id,
      wikidataQid: channel.wikidata_id ?? undefined,
    },
    confidence,
    channelMetadata,
  }
}

// ── Provider factory ───────────────────────────────────────────────────────

/**
 * Construct an iptv-org MetadataProvider bound to the given cache.
 * Factory rather than class per project convention (named exports only,
 * functional style).
 */
export function createIptvOrgProvider(cache: IptvOrgCache): MetadataProvider {
  const name = 'iptv-org'
  // Priority 30 — per provider.ts comment: "IMDb suggest = 10, Wikidata = 20, iptv-org = 30".
  const priority = 30

  function supports(_hints: ProviderHints): boolean {
    // The provider chain routes by type; iptv-org accepts any language/script.
    return true
  }

  async function lookupByExternalId(
    type: ExternalIdType,
    id: string
  ): Promise<Candidate | null> {
    if (type !== 'iptv-org') return null
    if (!id) return null

    const channels = await cache.getChannels()
    const match = channels.find((c) => c.id === id)
    if (!match) return null
    return channelToCandidate(match, 1.0)
  }

  async function lookupByTitle(
    query: string,
    hints: LookupHints
  ): Promise<Candidate[]> {
    // Only meaningful for live channels. Other types short-circuit.
    if (hints.type !== 'live') return []

    const normalizedQuery = normalizeChannelName(query)
    if (!normalizedQuery) return []

    const channels = await cache.getChannels()

    // Soft country filter: caller may pass an explicit countryHint, or
    // (legacy) a 2-letter languageHint that doubles as a country code.
    // Currently used as a tiebreaker only — we don't drop non-matching
    // channels, just slightly downrank them.
    const countryHint =
      hints.countryHint?.toUpperCase() ??
      (hints.languageHint && /^[a-zA-Z]{2}$/.test(hints.languageHint)
        ? hints.languageHint.toUpperCase()
        : null)

    const scored: ScoredCandidate[] = []
    for (const channel of channels) {
      let score = scoreChannel(channel, normalizedQuery)
      if (score >= 0.4) {
        if (
          countryHint &&
          channel.country &&
          channel.country.toUpperCase() !== countryHint
        ) {
          // Mild deprioritization, not exclusion.
          score -= 0.05
        }
        scored.push({ channel, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 10).map(({ channel, score }) => channelToCandidate(channel, score))
  }

  return {
    name,
    priority,
    supports,
    lookupByTitle,
    lookupByExternalId,
  }
}
