/**
 * iptv-org bulk dataset cache — L10 of the V3 data-search plan.
 *
 * Responsible for fetching and persisting the iptv-org bulk JSON datasets
 * (channels, categories, languages, countries, blocklist) to userData, and
 * exposing them to the iptv-org metadata provider.
 *
 * Network policy:
 *   - On first call to any getter, we load whatever is on disk. If there is
 *     no cache at all and the caller needs data, `refresh()` is awaited.
 *   - If data exists but is older than CACHE_TTL_MS, we return it immediately
 *     and kick off a background refresh (`setImmediate`).
 *   - If a refresh fails but a stale cache exists, we log a warning and keep
 *     the stale copy. If no cache exists AND the network fails, the error
 *     propagates — the caller (sync worker / scheduler) decides what to do.
 *
 * Designed for Node 20+ runtime (uses the built-in `fetch` global and
 * `node:fs/promises`). Not usable in the renderer process.
 */
/**
 * Shape observed from `https://iptv-org.github.io/api/channels.json` on
 * 2026-04-10. Fields documented but absent in the actual response
 * (`languages`, `broadcast_area`, `subdivision`, `city`, `logo`,
 * `wikidata_id`) are typed as optional so the provider can handle future
 * API additions without recompilation.
 */
export interface IptvOrgChannel {
    id: string;
    name: string;
    alt_names: string[];
    network: string | null;
    owners: string[];
    country: string;
    categories: string[];
    is_nsfw: boolean;
    launched: string | null;
    closed: string | null;
    replaced_by: string | null;
    website: string | null;
    subdivision?: string | null;
    city?: string | null;
    broadcast_area?: string[];
    languages?: string[];
    logo?: string | null;
    wikidata_id?: string | null;
}
export interface IptvOrgCategory {
    id: string;
    name: string;
    description?: string;
}
export interface IptvOrgLanguage {
    code: string;
    name: string;
}
export interface IptvOrgCountry {
    code: string;
    name: string;
    languages?: string[];
    flag?: string;
}
export interface IptvOrgBlocklistEntry {
    channel: string;
    ref?: string;
    reason?: string;
}
export interface IptvOrgCache {
    initCache(): Promise<void>;
    getChannels(): Promise<IptvOrgChannel[]>;
    getCategories(): Promise<IptvOrgCategory[]>;
    getLanguages(): Promise<IptvOrgLanguage[]>;
    getCountries(): Promise<IptvOrgCountry[]>;
    getBlocklist(): Promise<IptvOrgBlocklistEntry[]>;
    refresh(force?: boolean): Promise<void>;
    getCacheAge(): number | null;
    getCacheDir(): string;
}
/**
 * Factory for the iptv-org cache. Returns an object whose methods close over
 * the resolved cache directory and in-memory state. Not a class per project
 * convention (functional style, no classes when avoidable).
 */
export declare function createIptvOrgCache(): IptvOrgCache;
