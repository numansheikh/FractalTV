export interface EpgProgram {
    id: string;
    channelExternalId: string;
    sourceId: string;
    title: string;
    description: string | null;
    startTime: number;
    endTime: number;
    category: string | null;
}
export interface NowNext {
    now: EpgProgram | null;
    next: EpgProgram | null;
}
interface ParsedProgram {
    channelId: string;
    start: number;
    end: number;
    title: string;
    description: string | null;
    category: string | null;
}
export declare function parseXmltv(xml: string): {
    channelIds: Set<string>;
    programs: ParsedProgram[];
};
export declare function syncEpg(sourceId: string, serverUrl: string, username: string, password: string, onProgress?: (msg: string) => void): Promise<{
    inserted: number;
    error?: string;
}>;
export declare function getNowNext(contentId: string): NowNext;
export {};
