interface XtreamUserInfo {
    username: string;
    password: string;
    status: string;
    exp_date: string | null;
    max_connections: string;
    active_cons: string;
}
interface XtreamServerInfo {
    url: string;
    port: string;
    https_port: string;
    server_protocol: string;
    rtmp_port: string;
    timezone: string;
    timestamp_now: number;
    time_now: string;
}
export declare class XtreamService {
    private buildApiUrl;
    testConnection(serverUrl: string, username: string, password: string): Promise<{
        success: boolean;
        userInfo?: XtreamUserInfo;
        serverInfo?: XtreamServerInfo;
        error?: string;
    }>;
    addSource(name: string, serverUrl: string, username: string, password: string): Promise<{
        success: boolean;
        sourceId?: string;
        error?: string;
    }>;
    buildStreamUrl(serverUrl: string, username: string, password: string, type: 'live' | 'movie' | 'series', streamId: string, extension?: string): string;
    getSeriesInfo(serverUrl: string, username: string, password: string, seriesId: string): Promise<{
        seasons: Record<string, Array<{
            id: string;
            episode_num: number;
            title: string;
            container_extension: string;
            season: number;
            plot?: string;
            duration?: string;
            releaseDate?: string;
        }>>;
        seriesInfo?: Record<string, any>;
    }>;
    buildCatchupUrl(serverUrl: string, username: string, password: string, streamId: string, start: Date, duration: number): string;
}
export declare const xtreamService: XtreamService;
export {};
