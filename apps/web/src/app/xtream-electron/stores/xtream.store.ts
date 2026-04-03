import { computed, inject } from '@angular/core';
import {
    signalStore,
    withComputed,
    withMethods,
} from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { selectActivePlaylist } from 'm3u-state';
import {
    XtreamSerieDetails,
    XtreamVodDetails,
} from 'shared-interfaces';

// Import existing features that are already separate
import { withFavorites } from '../with-favorites.feature';
import { withRecentItems } from '../with-recent-items';

// Import services
import { XtreamApiService } from '../services/xtream-api.service';
import { TmdbPosterCacheService } from '../services/tmdb-poster-cache.service';
import { TmdbService } from '../services/tmdb.service';
import type { TmdbEnrichment, TmdbTvEnrichment } from '../services/tmdb.service';

// Import new feature stores
import {
    withPortal,
    withContent,
    withSelection,
    withSearch,
    withEpg,
    withPlayer,
    withPlaybackPositions,
} from './features';
import { SettingsStore } from '../../services/settings-store.service';
import { createLogger } from '../../shared/utils/logger';

/**
 * Experimental: Merge TMDB enrichment into Xtream VOD info.
 * When preferTmdbPoster is true, TMDB poster/backdrop override provider; otherwise only fill empty fields.
 */
function mergeTmdbEnrichmentIntoVod(
    vod: XtreamVodDetails,
    enrichment: TmdbEnrichment,
    preferTmdbPoster: boolean
): XtreamVodDetails {
    const info = { ...vod.info };
    const setIfEmpty = (key: keyof typeof info, value: string | string[] | undefined) => {
        const current = info[key];
        if (value != null && value !== '' && (current == null || current === '' || (Array.isArray(current) && current.length === 0))) {
            (info as Record<string, unknown>)[key] = value;
        }
    };
    const setOverride = (key: keyof typeof info, value: string | string[] | undefined) => {
        if (value != null && value !== '') (info as Record<string, unknown>)[key] = value;
    };
    if (preferTmdbPoster) {
        setOverride('movie_image', enrichment.movie_image);
        setOverride('backdrop_path', enrichment.backdrop_path);
    } else {
        setIfEmpty('movie_image', enrichment.movie_image);
        setIfEmpty('backdrop_path', enrichment.backdrop_path);
    }
    setIfEmpty('description', enrichment.description);
    setIfEmpty('plot', enrichment.plot);
    setIfEmpty('rating_imdb', enrichment.rating_imdb);
    setIfEmpty('genre', enrichment.genre);
    setIfEmpty('releasedate', enrichment.releasedate);
    setIfEmpty('duration', enrichment.duration);
    setIfEmpty('country', enrichment.country);
    return { ...vod, info };
}

/**
 * Merge TMDB TV enrichment into Xtream series info.
 */
function mergeTmdbTvEnrichmentIntoSeries(
    serial: XtreamSerieDetails,
    enrichment: TmdbTvEnrichment,
    preferTmdbPoster: boolean
): XtreamSerieDetails {
    const info = { ...serial.info };
    const setIfEmpty = (key: keyof typeof info, value: string | string[] | undefined) => {
        const current = info[key];
        if (value != null && value !== '' && (current == null || current === '' || (Array.isArray(current) && current.length === 0))) {
            (info as Record<string, unknown>)[key] = value;
        }
    };
    const setOverride = (key: keyof typeof info, value: string | string[] | undefined) => {
        if (value != null && value !== '') (info as Record<string, unknown>)[key] = value;
    };
    if (preferTmdbPoster) {
        setOverride('cover', enrichment.cover);
        setOverride('backdrop_path', enrichment.backdrop_path);
    } else {
        setIfEmpty('cover', enrichment.cover);
        setIfEmpty('backdrop_path', enrichment.backdrop_path);
    }
    setIfEmpty('plot', enrichment.plot);
    setIfEmpty('genre', enrichment.genre);
    setIfEmpty('releaseDate', enrichment.releaseDate);
    setIfEmpty('rating', enrichment.rating);
    return { ...serial, info };
}

/**
 * XtreamStore - Facade composing all feature stores.
 *
 * This store provides a unified API for components while delegating
 * to specialized feature stores for different concerns:
 *
 * - withPortal: Playlist and portal status management
 * - withContent: Categories and streams management
 * - withSelection: UI selection and pagination
 * - withSearch: Search functionality
 * - withEpg: EPG (Electronic Program Guide) data
 * - withPlayer: Stream URL construction and player integration
 * - withFavorites: Favorites management
 * - withRecentItems: Recently viewed items
 * - withPlaybackPositions: Playback position tracking
 *
 * @see docs/XTREAM_STORE_REFACTORING_PLAN.md
 */
export const XtreamStore = signalStore(
    { providedIn: 'root' },

    // Compose all features
    withPortal(),
    withContent(),
    withSelection(),
    withSearch(),
    withEpg(),
    withPlayer(),
    withFavorites(),
    withRecentItems(),
    withPlaybackPositions(),

    // Cross-feature computed properties
    withComputed((store) => ({
        /**
         * Get global recent items (from withRecentItems)
         */
        globalRecentItems: computed(() => {
            return store.recentItems();
        }),

        /**
         * Alias for importCount for backward compatibility
         */
        getImportCount: computed(() => store.importCount()),
    })),

    // Cross-feature methods & orchestration
    withMethods((store) => {
        const xtreamApiService = inject(XtreamApiService);
        const tmdbService = inject(TmdbService);
        const tmdbPosterCache = inject(TmdbPosterCacheService);
        const settingsStore = inject(SettingsStore);
        const ngrxStore = inject(Store);
        const logger = createLogger('XtreamStore');
        const searchContent = (store as any).searchContent as (
            term: string,
            types: string[],
            excludeHidden?: boolean,
            offset?: number,
            limit?: number
        ) => Promise<{ results: unknown[]; total: number }>;

        return {
            /**
             * Full store reset for switching between playlists
             */
            resetStore(newPlaylistId?: string): void {
                store.resetPortal();
                store.resetContent();
                store.resetSelection();
                store.resetSearchResults();
                store.clearEpg();
                store.resetPlayer();

                if (newPlaylistId) {
                    store.setPlaylistId(newPlaylistId);
                }
            },

            /**
             * Initialize the store for a playlist
             */
            async initialize(): Promise<void> {
                await store.fetchPlaylist();
                await store.checkPortalStatus();
                await store.initializeContent();
                const playlist = store.currentPlaylist();
                if (playlist) {
                    store.loadAllPositions(playlist.id);
                }
            },

            /**
             * Fetch Xtream playlist (convenience alias)
             */
            async fetchXtreamPlaylist(): Promise<void> {
                await store.fetchPlaylist();
            },

            /**
             * Fetch VOD details with metadata.
             * When TMDB is enabled (experimental), enriches with poster/backdrop/description/rating.
             */
            fetchVodDetailsWithMetadata(
                params: { vodId: string; categoryId: number }
            ): void {
                const playlist = ngrxStore.selectSignal(selectActivePlaylist)();
                if (!playlist) return;

                store.setIsLoadingDetails(true);
                store.setDetailsError(null);
                xtreamApiService
                    .getVodInfo(
                        {
                            serverUrl: playlist.serverUrl,
                            username: playlist.username,
                            password: playlist.password,
                        },
                        params.vodId
                    )
                    .then(async (vodDetails: XtreamVodDetails) => {
                        let details = vodDetails;
                        if (tmdbService.isEnabled && vodDetails?.info) {
                            const enrichment = await tmdbService.enrichForVod({
                                tmdb_id: vodDetails.info.tmdb_id,
                                name: vodDetails.info.name,
                                o_name: vodDetails.info.o_name,
                                releasedate: vodDetails.info.releasedate,
                            });
                            if (enrichment) {
                                const categoryKey = `${playlist._id}_${params.categoryId}`;
                                const byCat =
                                    settingsStore.preferTmdbPosterByCategory?.() ??
                                    {};
                                const preferPoster =
                                    byCat[categoryKey] ??
                                    settingsStore.preferTmdbPoster();
                                details = mergeTmdbEnrichmentIntoVod(
                                    vodDetails,
                                    enrichment,
                                    preferPoster
                                );
                                if (enrichment.movie_image) {
                                    tmdbPosterCache.set(
                                        playlist._id,
                                        params.vodId,
                                        enrichment.movie_image
                                    );
                                }
                            }
                        }
                        store.setSelectedCategory(params.categoryId);
                        store.setSelectedItem({
                            ...details,
                            stream_id: params.vodId,
                        });
                    })
                    .catch((error: unknown) => {
                        logger.error('Error fetching VOD details', error);
                        store.setDetailsError(
                            error instanceof Error ? error.message : 'Unknown error'
                        );
                    })
                    .finally(() => {
                        store.setIsLoadingDetails(false);
                    });
            },

            /**
             * Experimental: Re-fetch TMDB enrichment for the current VOD and update selected item.
             * No-op if TMDB is disabled or current item is not a VOD with info.
             */
            async refreshVodTmdbEnrichment(): Promise<void> {
                const item = store.selectedItem() as (XtreamVodDetails & { stream_id?: string }) | null;
                if (!item?.info || !tmdbService.isEnabled) return;
                const enrichment = await tmdbService.enrichForVod({
                    tmdb_id: item.info.tmdb_id,
                    name: item.info.name,
                    o_name: item.info.o_name,
                    releasedate: item.info.releasedate,
                });
                if (enrichment) {
                    const playlistId = store.currentPlaylist()?.id;
                    const categoryId = store.selectedCategoryId();
                    const categoryKey =
                        playlistId != null && categoryId != null
                            ? `${playlistId}_${categoryId}`
                            : null;
                    const byCat =
                        settingsStore.preferTmdbPosterByCategory?.() ?? {};
                    const preferPoster =
                        categoryKey != null && byCat[categoryKey] !== undefined
                            ? byCat[categoryKey]
                            : settingsStore.preferTmdbPoster();
                    const merged = mergeTmdbEnrichmentIntoVod(
                        item,
                        enrichment,
                        preferPoster
                    );
                    store.setSelectedItem({ ...merged, stream_id: item.stream_id });
                    if (enrichment.movie_image && playlistId && item.stream_id != null) {
                        tmdbPosterCache.set(
                            playlistId,
                            String(item.stream_id),
                            enrichment.movie_image
                        );
                    }
                }
            },

            /**
             * Experimental: Re-fetch TMDB enrichment for the current series and update selected item.
             */
            async refreshSerialTmdbEnrichment(): Promise<void> {
                const item = store.selectedItem() as (XtreamSerieDetails & { series_id?: string }) | null;
                if (!item?.info || !tmdbService.isEnabled) return;
                const enrichment = await tmdbService.enrichForSeries({
                    name: item.info.name,
                    releaseDate: item.info.releaseDate,
                });
                if (enrichment) {
                    const playlistId = store.currentPlaylist()?.id;
                    const categoryId = store.selectedCategoryId();
                    const categoryKey =
                        playlistId != null && categoryId != null
                            ? `${playlistId}_${categoryId}`
                            : null;
                    const byCat =
                        settingsStore.preferTmdbPosterByCategory?.() ?? {};
                    const preferPoster =
                        categoryKey != null && byCat[categoryKey] !== undefined
                            ? byCat[categoryKey]
                            : settingsStore.preferTmdbPoster();
                    const merged = mergeTmdbTvEnrichmentIntoSeries(
                        item,
                        enrichment,
                        preferPoster
                    );
                    store.setSelectedItem({ ...merged, series_id: item.series_id });
                    if (enrichment.cover && playlistId && item.series_id != null) {
                        tmdbPosterCache.setSeries(playlistId, item.series_id, enrichment.cover);
                    }
                }
            },

            /**
             * Refresh TMDB poster cache for all VOD or series items in the current category.
             * Fetches only poster URLs (search API only). Calls onProgress(current, total) for UI.
             */
            async refreshCategoryTmdbEnrichment(
                onProgress?: (current: number, total: number) => void
            ): Promise<void> {
                if (!tmdbService.isEnabled) return;
                const playlist = store.currentPlaylist();
                const playlistId = playlist?.id;
                if (!playlistId) return;
                const contentType = store.selectedContentType();
                const items = store.selectItemsFromSelectedCategory() as any[];
                if (!items?.length) return;
                const delayMs = 200;

                const toProcess =
                    contentType === 'vod'
                        ? items
                              .map((item: any) => ({
                                  id: item.xtream_id ?? item.stream_id,
                                  name: item.name ?? item.title,
                                  year: item.releasedate ?? item.added,
                              }))
                              .filter((x: any) => x.id != null && x.name)
                        : contentType === 'series'
                          ? items
                                .map((item: any) => ({
                                    id: item.series_id ?? item.xtream_id ?? item.stream_id,
                                    name: item.name ?? item.title,
                                    year: item.releaseDate ?? item.added,
                                }))
                                .filter((x: any) => x.id != null && x.name)
                          : [];
                const total = toProcess.length;
                if (total === 0) return;
                onProgress?.(0, total);

                if (contentType === 'vod') {
                    let current = 0;
                    for (const { id: vodId, name, year } of toProcess) {
                        const posterUrl = await tmdbService.getMoviePosterOnly(
                            String(name),
                            year ? String(year).slice(0, 4) : undefined
                        );
                        if (posterUrl) {
                            tmdbPosterCache.set(playlistId, vodId, posterUrl);
                        }
                        current += 1;
                        onProgress?.(current, total);
                        await new Promise((r) => setTimeout(r, delayMs));
                    }
                } else if (contentType === 'series') {
                    let current = 0;
                    for (const { id: serialId, name, year } of toProcess) {
                        const posterUrl = await tmdbService.getTvPosterOnly(
                            String(name),
                            year ? String(year).slice(0, 4) : undefined
                        );
                        if (posterUrl) {
                            tmdbPosterCache.setSeries(playlistId, serialId, posterUrl);
                        }
                        current += 1;
                        onProgress?.(current, total);
                        await new Promise((r) => setTimeout(r, delayMs));
                    }
                }
                onProgress?.(total, total);
            },

            /**
             * Fetch series details with metadata
             * Accepts object format for backward compatibility with rxMethod callers
             */
            fetchSerialDetailsWithMetadata(
                params: { serialId: string; categoryId: number }
            ): void {
                const playlist = ngrxStore.selectSignal(selectActivePlaylist)();
                if (!playlist) return;

                store.setIsLoadingDetails(true);
                store.setDetailsError(null);
                xtreamApiService.getSeriesInfo({
                    serverUrl: playlist.serverUrl,
                    username: playlist.username,
                    password: playlist.password,
                }, params.serialId).then(async (serialDetails: XtreamSerieDetails) => {
                    let details = serialDetails;
                    if (tmdbService.isEnabled && serialDetails?.info) {
                        const categoryKey = `${playlist._id}_${params.categoryId}`;
                        const byCat = settingsStore.preferTmdbPosterByCategory?.() ?? {};
                        const preferPoster = byCat[categoryKey] ?? settingsStore.preferTmdbPoster();
                        const enrichment = await tmdbService.enrichForSeries({
                            name: serialDetails.info.name,
                            releaseDate: serialDetails.info.releaseDate,
                        });
                        if (enrichment) {
                            details = mergeTmdbTvEnrichmentIntoSeries(
                                serialDetails,
                                enrichment,
                                preferPoster
                            );
                            if (enrichment.cover) {
                                tmdbPosterCache.setSeries(playlist._id, params.serialId, enrichment.cover);
                            }
                        }
                    }
                    store.setSelectedCategory(params.categoryId);
                    store.setSelectedItem({
                        ...details,
                        series_id: params.serialId,
                    });
                }).catch((error: unknown) => {
                    logger.error('Error fetching series details', error);
                    store.setDetailsError(
                        error instanceof Error ? error.message : 'Unknown error'
                    );
                }).finally(() => {
                    store.setIsLoadingDetails(false);
                });
            },

            /**
             * Legacy method stubs for backward compatibility
             */
            createLinkToPlayVod(): void {
                // No-op, kept for compatibility
            },

            addToFavorites(item: unknown): void {
                logger.debug('Legacy addToFavorites called', item);
            },

            removeFromFavorites(favoriteId: string): void {
                logger.debug('Legacy removeFromFavorites called', favoriteId);
            },

            // Alias methods for backward compatibility
            fetchLiveCategories(): void {
                store.fetchAllCategories();
            },

            fetchVodCategories(): void {
                store.fetchAllCategories();
            },

            fetchSerialCategories(): void {
                store.fetchAllCategories();
            },

            fetchLiveStreams(): void {
                store.fetchAllContent();
            },

            fetchVodStreams(): void {
                store.fetchAllContent();
            },

            fetchSerialStreams(): void {
                store.fetchAllContent();
            },

            /**
             * Search content wrapper for rxMethod compatibility
             * Can be called with object { term, types, excludeHidden, offset?, limit? }
             * Returns a promise so callers can await (e.g. to restore scroll after load more).
             */
            searchContent(params: {
                term: string;
                types: string[];
                excludeHidden?: boolean;
                offset?: number;
                limit?: number;
            }): Promise<{ results: unknown[]; total: number }> {
                return searchContent(
                    params.term,
                    params.types,
                    params.excludeHidden,
                    params.offset ?? 0,
                    params.limit ?? 50
                );
            },
        };
    })
);

// Type alias for the store
export type XtreamStoreType = InstanceType<typeof XtreamStore>;
