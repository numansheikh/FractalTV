export interface M3uEntry {
    title: string;
    groupTitle: string;
    tvgId?: string;
    tvgName?: string;
    tvgLogo?: string;
    duration: number;
    url: string;
    type: 'live' | 'movie' | 'series';
}
export declare function parseM3u(text: string): M3uEntry[];
export declare const m3uService: {
    testConnection(m3uUrl: string): Promise<{
        count: number;
        error?: string;
    }>;
    addSource(name: string, m3uUrl: string): Promise<{
        id: string;
        error?: string;
    }>;
};
