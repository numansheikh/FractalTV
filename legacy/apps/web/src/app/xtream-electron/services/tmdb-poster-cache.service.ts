import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { StorageMap } from '@ngx-pwa/local-storage';

const CACHE_STORAGE_KEY = 'fractals_tmdb_poster_cache';
const PERSIST_DEBOUNCE_MS = 1500;

/**
 * In-memory cache of TMDB poster URLs keyed by playlist + content id (VOD or series).
 * Persisted to storage so posters survive app restarts. Used so movie/series listings
 * can show TMDB posters when the user has opened (or refreshed) a detail.
 */
@Injectable({ providedIn: 'root' })
export class TmdbPosterCacheService {
    private readonly storage = inject(StorageMap);
    private persistTimer: ReturnType<typeof setTimeout> | null = null;
    private loadPromise: Promise<void> | null = null;

    /** Exposed so components can depend on it for reactivity when cache updates */
    readonly cache = signal<Map<string, string>>(new Map());

    private vodKey(playlistId: string, vodId: string | number): string {
        return `${playlistId}_vod_${vodId}`;
    }

    private seriesKey(playlistId: string, serialId: string | number): string {
        return `${playlistId}_series_${serialId}`;
    }

    /**
     * Load cache from storage. Safe to call multiple times; runs once.
     * Call early (e.g. when entering Xtream/category view) so listings show persisted posters.
     */
    async loadFromStorage(): Promise<void> {
        if (this.loadPromise) return this.loadPromise;
        this.loadPromise = (async () => {
            try {
                const raw = await firstValueFrom(
                    this.storage.get(CACHE_STORAGE_KEY)
                ) as Record<string, string> | null | undefined;
                if (raw && typeof raw === 'object') {
                    const map = new Map<string, string>(Object.entries(raw));
                    this.cache.set(map);
                }
            } catch {
                // ignore
            }
        })();
        return this.loadPromise;
    }

    private schedulePersist(): void {
        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            this.persist();
        }, PERSIST_DEBOUNCE_MS);
    }

    /** Persist cache to storage (e.g. after bulk refresh). Debounced persist also runs on set/setSeries. */
    async persist(): Promise<void> {
        try {
            const map = this.cache();
            const obj: Record<string, string> = {};
            map.forEach((value, key) => {
                obj[key] = value;
            });
            await firstValueFrom(this.storage.set(CACHE_STORAGE_KEY, obj));
        } catch {
            // ignore
        }
    }

    set(playlistId: string, vodId: string | number, posterUrl: string): void {
        const map = new Map(this.cache());
        map.set(this.vodKey(playlistId, vodId), posterUrl);
        this.cache.set(map);
        this.schedulePersist();
    }

    get(playlistId: string, vodId: string | number): string | undefined {
        return this.cache().get(this.vodKey(playlistId, vodId));
    }

    setSeries(playlistId: string, serialId: string | number, posterUrl: string): void {
        const map = new Map(this.cache());
        map.set(this.seriesKey(playlistId, serialId), posterUrl);
        this.cache.set(map);
        this.schedulePersist();
    }

    getSeries(playlistId: string, serialId: string | number): string | undefined {
        return this.cache().get(this.seriesKey(playlistId, serialId));
    }
}
