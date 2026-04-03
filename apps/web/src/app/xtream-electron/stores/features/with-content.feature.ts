import { computed, inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withState,
} from '@ngrx/signals';
import {
    XtreamCategory,
    XtreamLiveStream,
    XtreamSerieItem,
    XtreamVodStream,
} from 'shared-interfaces';
import {
    XTREAM_DATA_SOURCE,
    XtreamCategoryFromDb,
} from '../../data-sources/xtream-data-source.interface';
import { XtreamCredentials } from '../../services/xtream-api.service';
import { ContentType } from '../../xtream-state';
import { createLogger } from '../../../shared/utils/logger';

/**
 * Content state for managing categories and streams
 */
export interface ContentState {
    liveCategories: (XtreamCategory | XtreamCategoryFromDb)[];
    vodCategories: (XtreamCategory | XtreamCategoryFromDb)[];
    serialCategories: (XtreamCategory | XtreamCategoryFromDb)[];
    liveStreams: XtreamLiveStream[];
    vodStreams: XtreamVodStream[];
    serialStreams: XtreamSerieItem[];
    isLoadingCategories: boolean;
    isLoadingContent: boolean;
    isImporting: boolean;
    importCount: number;
    itemsToImport: number;
    /** Set when categories or content fetch fails so UI can show a message */
    contentLoadError?: string | null;
}

/**
 * Initial content state
 */
const initialContentState: ContentState = {
    liveCategories: [],
    vodCategories: [],
    serialCategories: [],
    liveStreams: [],
    vodStreams: [],
    serialStreams: [],
    isLoadingCategories: false,
    isLoadingContent: false,
    isImporting: false,
    importCount: 0,
    itemsToImport: 0,
    contentLoadError: null,
};

/**
 * Content feature store for managing Xtream categories and streams.
 * Handles:
 * - Fetching categories (live, vod, series)
 * - Fetching content/streams (live, movies, series)
 * - Import progress tracking
 */
export function withContent() {
    const logger = createLogger('withContent');
    return signalStoreFeature(
        withState<ContentState>(initialContentState),

        withComputed((store) => ({
            /**
             * Get categories by content type
             */
            getCategoriesByType: computed(() => {
                return (type: ContentType) => {
                    switch (type) {
                        case 'live':
                            return store.liveCategories();
                        case 'vod':
                            return store.vodCategories();
                        case 'series':
                            return store.serialCategories();
                    }
                };
            }),

            /**
             * Get streams/content by type
             */
            getContentByType: computed(() => {
                return (type: ContentType) => {
                    switch (type) {
                        case 'live':
                            return store.liveStreams();
                        case 'vod':
                            return store.vodStreams();
                        case 'series':
                            return store.serialStreams();
                    }
                };
            }),

            /**
             * Get import count
             */
            getImportCount: computed(() => store.importCount()),

            /**
             * Check if content is being imported
             */
            isContentImporting: computed(() => store.isImporting()),
        })),

        withMethods((store) => {
            const dataSource = inject(XTREAM_DATA_SOURCE);

            /**
             * Helper to get credentials from parent store
             * This will be provided by the parent store's currentPlaylist
             */
            const getCredentialsFromStore = (): {
                playlistId: string;
                credentials: XtreamCredentials;
            } | null => {
                // Access parent store state (currentPlaylist is from withPortal)
                const storeAny = store as any;
                const playlist = storeAny.currentPlaylist?.();
                const playlistId = storeAny.playlistId?.();

                if (!playlist || !playlistId) {
                    return null;
                }

                return {
                    playlistId,
                    credentials: {
                        serverUrl: playlist.serverUrl,
                        username: playlist.username,
                        password: playlist.password,
                    },
                };
            };

            return {
                /**
                 * Fetch all categories in parallel
                 */
                async fetchAllCategories(): Promise<void> {
                    const ctx = getCredentialsFromStore();
                    if (!ctx) return;

                    patchState(store, { isLoadingCategories: true });

                    try {
                        const [live, vod, series] = await Promise.all([
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'live'
                            ),
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'vod'
                            ),
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'series'
                            ),
                        ]);

                        patchState(store, {
                            liveCategories: live,
                            vodCategories: vod,
                            serialCategories: series,
                            isLoadingCategories: false,
                        });
                    } catch (error) {
                        logger.error('Error fetching categories', error);
                        console.error('[Xtream DEBUG] fetchAllCategories error:', error);
                        const message =
                            error instanceof Error
                                ? error.message
                                : String(error);
                        patchState(store, {
                            isLoadingCategories: false,
                            contentLoadError: message,
                        });
                    }
                },

                /**
                 * Fetch all content/streams in parallel with progress tracking
                 */
                async fetchAllContent(): Promise<void> {
                    const ctx = getCredentialsFromStore();
                    if (!ctx) return;

                    patchState(store, { isLoadingContent: true });

                    // Track combined progress across all content types
                    let totalItems = 0;
                    let importedItems = 0;

                    const onTotal = (count: number) => {
                        totalItems += count;
                        patchState(store, { itemsToImport: totalItems });
                    };

                    const onProgress = (count: number) => {
                        importedItems += count;
                        patchState(store, { importCount: importedItems });
                    };

                    try {
                        const [live, vod, series] = await Promise.all([
                            dataSource.getContent(
                                ctx.playlistId,
                                ctx.credentials,
                                'live',
                                onProgress,
                                onTotal
                            ),
                            dataSource.getContent(
                                ctx.playlistId,
                                ctx.credentials,
                                'movie',
                                onProgress,
                                onTotal
                            ),
                            dataSource.getContent(
                                ctx.playlistId,
                                ctx.credentials,
                                'series',
                                onProgress,
                                onTotal
                            ),
                        ]);

                        patchState(store, {
                            liveStreams: live as XtreamLiveStream[],
                            vodStreams: vod as XtreamVodStream[],
                            serialStreams: series as XtreamSerieItem[],
                            isLoadingContent: false,
                        });
                    } catch (error) {
                        logger.error('Error fetching content', error);
                        console.error('[Xtream DEBUG] fetchAllContent error:', error);
                        const message =
                            error instanceof Error
                                ? error.message
                                : String(error);
                        patchState(store, {
                            isLoadingContent: false,
                            contentLoadError: message,
                        });
                    }
                },

                /**
                 * Initialize content (fetch categories and content)
                 */
                async initializeContent(): Promise<void> {
                    const ctx = getCredentialsFromStore();
                    if (!ctx) {
                        console.warn('[Xtream DEBUG] initializeContent: getCredentialsFromStore returned null');
                        return;
                    }
                    console.log('[Xtream DEBUG] initializeContent: starting', { playlistId: ctx.playlistId });

                    patchState(store, {
                        isImporting: true,
                        importCount: 0,
                        itemsToImport: 0,
                        contentLoadError: null,
                    });

                    try {
                        console.log('[Xtream DEBUG] initializeContent: fetchAllCategories...');
                        await this.fetchAllCategories();
                        console.log('[Xtream DEBUG] initializeContent: fetchAllCategories done');

                        console.log('[Xtream DEBUG] initializeContent: fetchAllContent...');
                        await this.fetchAllContent();
                        console.log('[Xtream DEBUG] initializeContent: fetchAllContent done');

                        // Restore user data if needed
                        const restoreKey = `xtream-restore-${ctx.playlistId}`;
                        const restoreData = localStorage.getItem(restoreKey);
                        if (restoreData) {
                            try {
                                const {
                                    favoritedXtreamIds,
                                    recentlyViewedXtreamIds,
                                } = JSON.parse(restoreData);
                                await dataSource.restoreUserData(
                                    ctx.playlistId,
                                    favoritedXtreamIds,
                                    recentlyViewedXtreamIds
                                );
                                localStorage.removeItem(restoreKey);
                            } catch (err) {
                                logger.error('Error restoring user data', err);
                            }
                        }
                    } finally {
                        patchState(store, { isImporting: false });
                    }
                },

                /**
                 * Reload categories from database (after visibility changes)
                 */
                async reloadCategories(): Promise<void> {
                    const ctx = getCredentialsFromStore();
                    if (!ctx) return;

                    try {
                        const [live, vod, series] = await Promise.all([
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'live'
                            ),
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'vod'
                            ),
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'series'
                            ),
                        ]);

                        patchState(store, {
                            liveCategories: live,
                            vodCategories: vod,
                            serialCategories: series,
                        });
                    } catch (error) {
                        logger.error('Error reloading categories', error);
                    }
                },

                /**
                 * Update import progress
                 */
                setImportProgress(count: number, total?: number): void {
                    const updates: Partial<ContentState> = {
                        importCount: count,
                    };
                    if (total !== undefined) {
                        updates.itemsToImport = total;
                    }
                    patchState(store, updates);
                },

                /**
                 * Reset content state
                 */
                resetContent(): void {
                    patchState(store, initialContentState);
                },

                /**
                 * Clear content load error (e.g. after showing snackbar)
                 */
                clearContentError(): void {
                    patchState(store, { contentLoadError: null });
                },
            };
        })
    );
}
