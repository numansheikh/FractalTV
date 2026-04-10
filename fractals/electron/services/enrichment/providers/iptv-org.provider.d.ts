/**
 * iptv-org MetadataProvider implementation — L10 of the V3 data-search plan.
 *
 * Routes live-TV canonical lookups against the locally-cached iptv-org bulk
 * dataset. Direct tvg-id lookups are O(1); title lookups are linear-scan
 * fuzzy matching against normalized names + alt_names.
 */
import type { IptvOrgCache } from '../iptv-org-cache';
import type { MetadataProvider } from '../provider';
/**
 * Construct an iptv-org MetadataProvider bound to the given cache.
 * Factory rather than class per project convention (named exports only,
 * functional style).
 */
export declare function createIptvOrgProvider(cache: IptvOrgCache): MetadataProvider;
