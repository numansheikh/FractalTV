import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { GlobalSearchResult } from 'services';
import {
    XTREAM_DATA_SOURCE,
    XtreamContentItem,
} from '../../data-sources/xtream-data-source.interface';
import { createLogger } from '../../../shared/utils/logger';

/**
 * Search filters configuration
 */
export interface SearchFilters {
    live: boolean;
    movie: boolean;
    series: boolean;
}

/**
 * Search state for managing search results
 */
export interface SearchState {
    searchTerm: string;
    searchFilters: SearchFilters;
    searchResults: XtreamContentItem[];
    searchTotal: number;
    globalSearchResults: GlobalSearchResult[];
    isSearching: boolean;
}

/**
 * Initial search filters
 */
const initialSearchFilters: SearchFilters = {
    live: true,
    movie: true,
    series: true,
};

/**
 * Initial search state
 */
const initialSearchState: SearchState = {
    searchTerm: '',
    searchFilters: initialSearchFilters,
    searchResults: [],
    searchTotal: 0,
    globalSearchResults: [],
    isSearching: false,
};

/**
 * Search feature store for managing content search.
 * Handles:
 * - Local playlist search
 * - Global search results from external sources
 */
export function withSearch() {
    const logger = createLogger('withSearch');
    return signalStoreFeature(
        withState<SearchState>(initialSearchState),

        withMethods((store) => {
            const dataSource = inject(XTREAM_DATA_SOURCE);

            return {
                /**
                 * Search content within the current playlist (paginated).
                 * When offset is 0, replaces results; when offset > 0, appends (load more).
                 */
                async searchContent(
                    searchTerm: string,
                    types: string[],
                    excludeHidden?: boolean,
                    offset = 0,
                    limit = 50
                ): Promise<{ results: XtreamContentItem[]; total: number }> {
                    const storeAny = store as any;
                    const playlistId = storeAny.playlistId?.();

                    if (!playlistId || !searchTerm.trim()) {
                        patchState(store, {
                            searchResults: [],
                            searchTotal: 0,
                        });
                        return { results: [], total: 0 };
                    }

                    patchState(store, { isSearching: true });

                    try {
                        const { results, total } =
                            await dataSource.searchContent(
                                playlistId,
                                searchTerm,
                                types,
                                excludeHidden,
                                offset,
                                limit
                            );

                        const nextResults =
                            offset === 0
                                ? results
                                : [...store.searchResults(), ...results];

                        patchState(store, {
                            searchResults: nextResults,
                            searchTotal: total,
                            isSearching: false,
                        });

                        return { results: nextResults, total };
                    } catch (error) {
                        logger.error('Error searching content', error);
                        patchState(store, {
                            searchResults: [],
                            searchTotal: 0,
                            isSearching: false,
                        });
                        return { results: [], total: 0 };
                    }
                },

                /**
                 * Set global search results (from external search)
                 */
                setGlobalSearchResults(
                    results: GlobalSearchResult[],
                    total?: number
                ): void {
                    patchState(store, {
                        searchResults: results as any,
                        searchTotal: total ?? results.length,
                        globalSearchResults: results,
                        isSearching: false,
                    });
                },

                /**
                 * Set the searching state
                 */
                setIsSearching(value: boolean): void {
                    patchState(store, { isSearching: value });
                },

                /**
                 * Set the search term
                 */
                setSearchTerm(term: string): void {
                    patchState(store, { searchTerm: term });
                },

                /**
                 * Set search filters
                 */
                setSearchFilters(filters: SearchFilters): void {
                    patchState(store, { searchFilters: filters });
                },

                /**
                 * Update a single filter
                 */
                updateSearchFilter(
                    key: keyof SearchFilters,
                    value: boolean
                ): void {
                    patchState(store, {
                        searchFilters: {
                            ...store.searchFilters(),
                            [key]: value,
                        },
                    });
                },

                /**
                 * Clear search results
                 */
                resetSearchResults(): void {
                    patchState(store, initialSearchState);
                },
            };
        })
    );
}
