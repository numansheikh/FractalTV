import { Component, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from 'm3u-state';
import { LoadingOverlayComponent } from '../loading-overlay/loading-overlay.component';
import { NavigationComponent } from '../navigation/navigation.component';
import { NavigationItem } from '../navigation/navigation.interface';
import { XtreamStore } from '../stores/xtream.store';

@Component({
    templateUrl: './xtream-shell.component.html',
    styleUrls: ['./xtream-shell.component.scss'],
    imports: [
        LoadingOverlayComponent,
        NavigationComponent,
        RouterOutlet,
        TranslateModule,
    ],
})
export class XtreamShellComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    readonly xtreamStore = inject(XtreamStore);

    readonly getImportCount = this.xtreamStore.getImportCount;
    readonly isImporting = this.xtreamStore.isImporting;
    readonly itemsToImport = this.xtreamStore.itemsToImport;
    readonly portalStatus = this.xtreamStore.portalStatus;

    readonly mainNavigationItems: NavigationItem[] = [
        {
            id: 'vod',
            icon: 'movie',
            labelKey: 'PORTALS.SIDEBAR.MOVIES',
        },
        {
            id: 'live',
            icon: 'live_tv',
            labelKey: 'PORTALS.SIDEBAR.LIVE_TV',
        },
        {
            id: 'series',
            icon: 'tv',
            labelKey: 'PORTALS.SIDEBAR.SERIES',
        },
    ];

    private currentPlaylistId: string | null = null;

    constructor() {
        // Subscribe to route params to handle switching between playlists
        this.route.params.pipe(takeUntilDestroyed()).subscribe(async (params) => {
            const newPlaylistId = params['id'];
            console.log('[Xtream DEBUG] Route params:', { newPlaylistId, currentPlaylistId: this.currentPlaylistId });

            // Skip if playlist ID hasn't changed
            if (this.currentPlaylistId === newPlaylistId) {
                console.log('[Xtream DEBUG] Same playlist, skipping');
                return;
            }

            // Always reset the store when playlist changes to prevent stale data
            this.xtreamStore.resetStore(newPlaylistId);
            this.currentPlaylistId = newPlaylistId;

            this.store.dispatch(
                PlaylistActions.setActivePlaylist({
                    playlistId: newPlaylistId,
                })
            );

            console.log('[Xtream DEBUG] Fetching playlist...');
            await this.xtreamStore.fetchXtreamPlaylist();
            const afterFetch = this.xtreamStore.currentPlaylist();
            console.log('[Xtream DEBUG] After fetchPlaylist:', afterFetch ? { id: afterFetch.id, name: afterFetch.name, hasCredentials: !!(afterFetch.serverUrl && afterFetch.username) } : 'currentPlaylist is null');

            console.log('[Xtream DEBUG] Checking portal status...');
            await this.xtreamStore.checkPortalStatus();
            console.log('[Xtream DEBUG] Portal status:', this.xtreamStore.portalStatus());

            // Load content as soon as playlist is ready
            const playlist = this.xtreamStore.currentPlaylist();
            if (playlist !== null && playlist.id === newPlaylistId) {
                console.log('[Xtream DEBUG] Calling initializeContent()');
                this.xtreamStore.initializeContent();
            } else {
                console.warn('[Xtream DEBUG] Skipping initializeContent - playlist:', playlist?.id, 'expectedId:', newPlaylistId);
            }
        });

        // Show snackbar when content load fails (e.g. API/network error)
        effect(() => {
            const err = this.xtreamStore.contentLoadError();
            if (err) {
                const title = this.translate.instant(
                    'HOME.PLAYLISTS.CONTENT_LOAD_FAILED'
                );
                this.snackBar.open(`${title}: ${err}`, undefined, {
                    duration: 6000,
                });
                this.xtreamStore.clearContentError();
            }
        });
    }

    handleCategoryClick(category: 'vod' | 'live' | 'series') {
        this.xtreamStore.setSelectedContentType(category);
        this.router.navigate([category], {
            relativeTo: this.route,
        });
    }

    handlePageClick(page: 'search' | 'recent' | 'favorites' | 'recently-added') {
        this.xtreamStore.setSelectedContentType(undefined);
        this.router.navigate([page], {
            relativeTo: this.route,
        });
    }
}