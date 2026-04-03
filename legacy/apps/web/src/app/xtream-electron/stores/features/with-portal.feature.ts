import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { filter, firstValueFrom, timeout } from 'rxjs';
import { selectPlaylistById } from 'm3u-state';
import { Playlist } from 'shared-interfaces';
import {
    XTREAM_DATA_SOURCE,
    XtreamPlaylistData,
} from '../../data-sources/xtream-data-source.interface';
import {
    XtreamApiService,
    XtreamCredentials,
} from '../../services/xtream-api.service';
import { PortalStatusType } from '../../xtream-state';
import { createLogger } from '../../../shared/utils/logger';

/**
 * Portal state for managing playlist and portal status
 */
export interface PortalState {
    playlistId: string | null;
    currentPlaylist: XtreamPlaylistData | null;
    portalStatus: PortalStatusType;
}

/**
 * Initial portal state
 */
const initialPortalState: PortalState = {
    playlistId: null,
    currentPlaylist: null,
    portalStatus: 'unavailable',
};

/**
 * Portal feature store for managing the current Xtream playlist and status.
 * Handles:
 * - Setting/clearing playlist ID
 * - Fetching playlist details
 * - Checking portal status (active, inactive, expired, unavailable)
 */
export function withPortal() {
    const logger = createLogger('withPortal');
    return signalStoreFeature(
        withState<PortalState>(initialPortalState),

        withMethods((store) => {
            const apiService = inject(XtreamApiService);
            const dataSource = inject(XTREAM_DATA_SOURCE);
            const ngrxStore = inject(Store);

            return {
                /**
                 * Set the current playlist ID
                 */
                setPlaylistId(playlistId: string): void {
                    patchState(store, { playlistId });
                },

                /**
                 * Fetch playlist details from data source
                 */
                async fetchPlaylist(): Promise<void> {
                    const playlistId = store.playlistId();
                    if (!playlistId) {
                        console.log('[Xtream DEBUG] fetchPlaylist: no playlistId, skipping');
                        return;
                    }

                    try {
                        console.log('[Xtream DEBUG] fetchPlaylist: getPlaylist from dataSource', playlistId);
                        let playlist =
                            await dataSource.getPlaylist(playlistId);

                        if (!playlist) {
                            console.log('[Xtream DEBUG] fetchPlaylist: DB returned null, trying NgRx fallback');
                            let meta =
                                ngrxStore.selectSignal(
                                    selectPlaylistById(playlistId)
                                )() as Playlist | null;

                            if (!meta) {
                                console.log('[Xtream DEBUG] fetchPlaylist: not in store, waiting up to 10s...');
                                try {
                                    meta = await firstValueFrom(
                                        ngrxStore
                                            .select(
                                                selectPlaylistById(playlistId)
                                            )
                                            .pipe(
                                                filter(
                                                    (p): p is Playlist =>
                                                        p != null
                                                ),
                                                timeout(10000)
                                            )
                                    );
                                    console.log('[Xtream DEBUG] fetchPlaylist: got playlist from store after wait');
                                } catch {
                                    logger.error(
                                        'Playlist not found in store after waiting'
                                    );
                                    console.error('[Xtream DEBUG] fetchPlaylist: playlist not in store after 10s');
                                    return;
                                }
                            }

                            if (
                                meta?.serverUrl &&
                                meta?.username &&
                                meta?.password
                            ) {
                                console.log('[Xtream DEBUG] fetchPlaylist: creating playlist in DB from NgRx meta');
                                const newPlaylist: XtreamPlaylistData = {
                                    id: meta._id,
                                    name: meta.title ?? meta.filename ?? '',
                                    serverUrl: meta.serverUrl,
                                    username: meta.username,
                                    password: meta.password,
                                    type: 'xtream',
                                };
                                await dataSource.createPlaylist(newPlaylist);
                                playlist = newPlaylist;
                            } else {
                                console.warn('[Xtream DEBUG] fetchPlaylist: meta missing serverUrl/username/password', { hasServerUrl: !!meta?.serverUrl, hasUsername: !!meta?.username, hasPassword: !!meta?.password });
                            }
                        } else {
                            console.log('[Xtream DEBUG] fetchPlaylist: got playlist from DB');
                        }

                        if (playlist) {
                            patchState(store, {
                                currentPlaylist: playlist,
                            });
                            console.log('[Xtream DEBUG] fetchPlaylist: currentPlaylist set');
                        } else {
                            console.warn('[Xtream DEBUG] fetchPlaylist: no playlist to set');
                        }
                    } catch (error) {
                        logger.error('Error fetching playlist', error);
                        console.error('[Xtream DEBUG] fetchPlaylist error:', error);
                    }
                },

                /**
                 * Check portal status via API
                 */
                async checkPortalStatus(): Promise<void> {
                    const playlist = store.currentPlaylist();
                    if (!playlist) {
                        console.log('[Xtream DEBUG] checkPortalStatus: no currentPlaylist');
                        patchState(store, { portalStatus: 'unavailable' });
                        return;
                    }

                    const credentials: XtreamCredentials = {
                        serverUrl: playlist.serverUrl,
                        username: playlist.username,
                        password: playlist.password,
                    };
                    console.log('[Xtream DEBUG] checkPortalStatus: calling getAccountInfo', { serverUrl: credentials.serverUrl?.slice(0, 40) + '...' });

                    try {
                        const response =
                            await apiService.getAccountInfo(credentials);
                        console.log('[Xtream DEBUG] checkPortalStatus: response', response?.user_info ? { status: response.user_info.status } : 'no user_info');

                        if (!response?.user_info?.status) {
                            patchState(store, { portalStatus: 'unavailable' });
                            return;
                        }

                        if (response.user_info.status === 'Active') {
                            const expDate = new Date(
                                parseInt(response.user_info.exp_date) * 1000
                            );
                            if (expDate < new Date()) {
                                patchState(store, { portalStatus: 'expired' });
                            } else {
                                patchState(store, { portalStatus: 'active' });
                            }
                        } else {
                            patchState(store, { portalStatus: 'inactive' });
                        }
                    } catch (error) {
                        logger.error('Error checking portal status', error);
                        console.error('[Xtream DEBUG] checkPortalStatus error:', error);
                        patchState(store, { portalStatus: 'unavailable' });
                    }
                },

                /**
                 * Update playlist details
                 */
                updatePlaylist(updates: Partial<XtreamPlaylistData>): void {
                    const current = store.currentPlaylist();
                    if (current) {
                        patchState(store, {
                            currentPlaylist: { ...current, ...updates },
                        });
                    }
                },

                /**
                 * Reset portal state
                 */
                resetPortal(): void {
                    patchState(store, initialPortalState);
                },
            };
        })
    );
}
