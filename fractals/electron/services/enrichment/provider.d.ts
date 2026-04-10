/**
 * MetadataProvider interface — Phase C of the V3 data-model rollout.
 *
 * See `fractals/docs/data-search-v3-plan.md` section L8 (keyless light-oracle
 * pipeline) and the Phase C entry of the Implementation Plan for the rationale
 * behind the shape of this interface.
 *
 * A provider is a pluggable source of canonical identity + light metadata.
 * Each call site (sync worker, enrichment worker, manual-match UI) talks to
 * providers exclusively through this interface and never touches endpoint
 * specifics directly.
 *
 * Provider implementations are expected to be stateless aside from a shared
 * `RateLimiter` injected via their constructor. All methods must degrade
 * gracefully on error — returning `[]` or `null` rather than throwing —
 * except for programmer errors (bad input types, missing required args).
 */
/**
 * Hints used by `supports()` to decide whether a provider should be consulted
 * for a given canonical row at all. Passed from the enrichment scheduler based
 * on the output of the title normalizer (Phase B).
 */
export interface ProviderHints {
    /** BCP-47-ish primary language hint from the normalizer (e.g. `en`, `fr`). */
    languageHint?: string;
    /** Whether the normalized title is in a Latin-script or non-Latin script. */
    script?: 'latin' | 'non-latin';
}
/**
 * Hints accompanying a title lookup. These are what the provider may use to
 * score/filter raw candidates before returning them.
 */
export interface LookupHints {
    /** Release year, when known (from provider data or filename parsing). */
    year?: number;
    /** BCP-47-ish primary language hint from the normalizer. */
    languageHint?: string;
    /** Canonical type the caller is looking for — movies, series, and live channels take different code paths. */
    type: 'movie' | 'series' | 'live';
    /** ISO 3166-1 alpha-2 country hint. Currently only consumed by the iptv-org provider as a soft filter. */
    countryHint?: string;
}
/**
 * External identifier namespaces the enrichment pipeline understands. Not
 * every provider can resolve every namespace; unsupported combinations return
 * `null` from `lookupByExternalId`.
 */
export type ExternalIdType = 'imdb' | 'tmdb' | 'wikidata' | 'iptv-org';
/**
 * Live-channel metadata payload — populated only when `Candidate.type === 'live'`.
 * Mirrors the iptv-org channel record shape (L10), with optional fields where
 * the upstream API doesn't always carry them.
 */
export interface LiveChannelMetadata {
    /** iptv-org tvg-id namespace ID (e.g. `BBCOne.uk`). */
    iptvOrgId: string;
    /** Curated channel name from iptv-org (preferred over provider-supplied names). */
    canonicalName: string;
    country: string | null;
    languages: string[];
    categories: string[];
    network: string | null;
    owners: string[];
    logoUrl: string | null;
    isNsfw: boolean;
    broadcastArea: string[];
    altNames: string[];
}
/**
 * Outcome of a provider lookup. A single candidate represents one potential
 * match — the caller (enrichment worker / manual-match UI) decides whether to
 * auto-accept the top-scored candidate or surface multiple for manual picking,
 * per L12.
 */
export interface Candidate {
    /** Cross-reference IDs discovered by this provider. Any subset may be present. */
    externalIds: {
        imdbId?: string;
        tmdbId?: number;
        wikidataQid?: string;
        /** iptv-org tvg-id, only present on live-channel candidates. */
        iptvOrgId?: string;
    };
    /** Display title, preferring the original/canonical form when available. */
    title: string;
    /** Release year as an integer (e.g. `1999`), or undefined if unknown. */
    year?: number;
    /** Canonical type. */
    type: 'movie' | 'series' | 'live';
    /** Full-resolution poster URL (provider-supplied, may be an Amazon CDN URL). */
    posterUrl?: string;
    /** ~300px-wide thumbnail URL derived from `posterUrl`. */
    thumbnailUrl?: string;
    /** Poster natural width in pixels, when known. */
    posterW?: number;
    /** Poster natural height in pixels, when known. */
    posterH?: number;
    /** Map of language code → localized label (per L8, ~15 top languages). */
    multilingualLabels?: Record<string, string>;
    /** Name of the provider that produced this candidate. Used for debug + audit. */
    rawSource: string;
    /** Optional 0..1 confidence score. Caller-defined semantics; not normalized across providers. */
    confidence?: number;
    /** Live-channel-specific payload. Defined iff `type === 'live'`. */
    channelMetadata?: LiveChannelMetadata;
}
/**
 * Pluggable metadata provider. Implementations live under
 * `electron/services/enrichment/providers/*.provider.ts`.
 */
export interface MetadataProvider {
    /** Short stable identifier (e.g. `imdb-suggest`, `wikidata`, `iptv-org`). */
    name: string;
    /** Lower = tried first. IMDb suggest = 10, Wikidata = 20, iptv-org = 30. */
    priority: number;
    /** Fast-path filter based on language/script hints. */
    supports(hints: ProviderHints): boolean;
    /** Title search. Returns zero or more candidates ranked by the provider's own heuristic. */
    lookupByTitle(query: string, hints: LookupHints): Promise<Candidate[]>;
    /** Cross-reference lookup. Returns `null` on miss or when the namespace is unsupported. */
    lookupByExternalId(type: ExternalIdType, id: string): Promise<Candidate | null>;
}
