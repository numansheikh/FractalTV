export declare const api: {
    ping: () => Promise<any>;
    sources: {
        list: () => Promise<any>;
        addXtream: (args: {
            name: string;
            serverUrl: string;
            username: string;
            password: string;
        }) => Promise<any>;
        testXtream: (args: {
            serverUrl: string;
            username: string;
            password: string;
        }) => Promise<any>;
        addM3u: (args: {
            name: string;
            m3uUrl: string;
        }) => Promise<any>;
        testM3u: (args: {
            m3uUrl: string;
        }) => Promise<any>;
        remove: (sourceId: string) => Promise<any>;
        update: (args: {
            sourceId: string;
            name?: string;
            serverUrl?: string;
            username?: string;
            password?: string;
            m3uUrl?: string;
        }) => Promise<any>;
        toggleDisabled: (sourceId: string) => Promise<any>;
        setColor: (sourceId: string, colorIndex: number) => Promise<any>;
        sync: (sourceId: string) => Promise<any>;
        accountInfo: (sourceId: string) => Promise<any>;
        startupCheck: () => Promise<any>;
        totalCount: () => Promise<any>;
        exportBackup: (opts?: {
            includeUserData?: boolean;
        }) => Promise<any>;
        import: (filePath: string) => Promise<any>;
        factoryReset: () => Promise<any>;
    };
    categories: {
        list: (args: {
            type?: "live" | "movie" | "series";
            sourceIds?: string[];
        }) => Promise<any>;
    };
    search: {
        query: (args: {
            query: string;
            type?: "live" | "movie" | "series";
            sourceIds?: string[];
            limit?: number;
            offset?: number;
        }) => Promise<any>;
    };
    content: {
        get: (contentId: string) => Promise<any>;
        getStreamUrl: (args: {
            contentId: string;
            sourceId?: string;
        }) => Promise<any>;
        getCatchupUrl: (args: {
            contentId: string;
            startTime: number;
            duration: number;
        }) => Promise<any>;
        browse: (args: {
            type?: "live" | "movie" | "series";
            categoryName?: string;
            sourceIds?: string[];
            sortBy?: string;
            sortDir?: string;
            limit?: number;
            offset?: number;
        }) => Promise<any>;
    };
    series: {
        getInfo: (contentId: string) => Promise<any>;
    };
    user: {
        getData: (contentId: string) => Promise<any>;
        setPosition: (contentId: string, position: number) => Promise<any>;
        toggleFavorite: (contentId: string) => Promise<any>;
        toggleWatchlist: (contentId: string) => Promise<any>;
        favorites: (args?: {
            type?: "live" | "movie" | "series";
        }) => Promise<any>;
        watchlist: (args?: {
            type?: "live" | "movie" | "series";
        }) => Promise<any>;
        continueWatching: (args?: {
            type?: "movie" | "series";
        }) => Promise<any>;
        history: (args?: {
            limit?: number;
        }) => Promise<any>;
        bulkGetData: (contentIds: string[]) => Promise<any>;
        setCompleted: (contentId: string) => Promise<any>;
        setRating: (contentId: string, rating: number | null) => Promise<any>;
        clearContinue: (contentId: string) => Promise<any>;
        clearItemHistory: (contentId: string) => Promise<any>;
        clearHistory: () => Promise<any>;
        clearFavorites: () => Promise<any>;
        clearAllData: () => Promise<any>;
        reorderFavorites: (order: {
            contentId: string;
            sortOrder: number;
        }[]) => Promise<any>;
    };
    channels: {
        favorites: (args?: {
            profileId?: string;
        }) => Promise<any>;
        toggleFavorite: (canonicalId: string) => Promise<any>;
        reorderFavorites: (order: {
            canonicalId: string;
            sortOrder: number;
        }[]) => Promise<any>;
        getData: (canonicalId: string) => Promise<any>;
    };
    player: {
        openExternal: (args: {
            player: "mpv" | "vlc";
            url: string;
            title: string;
            customPath?: string;
        }) => Promise<any>;
        detectExternal: () => Promise<any>;
    };
    enrichment: {
        status: () => Promise<any>;
        start: () => Promise<any>;
    };
    epg: {
        sync: (sourceId: string) => Promise<any>;
        nowNext: (contentId: string) => Promise<any>;
        guide: (args: {
            contentIds: string[];
            startTime?: number;
            endTime?: number;
        }) => Promise<any>;
        onProgress: (cb: (data: {
            sourceId: string;
            message: string;
        }) => void) => () => Electron.IpcRenderer;
    };
    dialog: {
        openFile: (args?: {
            filters?: {
                name: string;
                extensions: string[];
            }[];
        }) => Promise<any>;
        saveFile: (args?: {
            defaultPath?: string;
            filters?: {
                name: string;
                extensions: string[];
            }[];
        }) => Promise<any>;
    };
    window: {
        toggleFullscreen: () => Promise<any>;
        isFullscreen: () => Promise<any>;
    };
    debug: {
        categoryItems: (search: string) => Promise<any>;
    };
    settings: {
        get: (key: string) => Promise<any>;
    };
    on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
};
declare global {
    interface Window {
        api: typeof api & {
            settings: {
                get: (key: string) => Promise<string | null>;
            };
        };
        electronDevTools: () => void;
    }
}
