import { ColorScheme } from './color-scheme.enum';
import { Language } from './language.enum';
import { StreamFormat } from './stream-format.enum';
import { Theme } from './theme.enum';

/**
 * Contains all types of supported video players
 */
export enum VideoPlayer {
    VideoJs = 'videojs',
    Html5Player = 'html5',
    MPV = 'mpv',
    VLC = 'vlc',
    ArtPlayer = 'artplayer',
}

/**
 * Describes all available settings options of the application
 */
export interface Settings {
    player: VideoPlayer;
    epgUrl: string[];
    streamFormat: StreamFormat;
    language: Language;
    showCaptions: boolean;
    theme: Theme;
    /** Visual style: Modern (default) or Vintage (warm, retro) */
    colorScheme: ColorScheme;
    /** When TMDB enrichment is used: prefer TMDB poster/backdrop over provider thumbnail */
    preferTmdbPoster: boolean;
    /** Per-category override: key = `${playlistId}_${categoryId}`, value = prefer TMDB poster for that category */
    preferTmdbPosterByCategory?: Record<string, boolean>;
    mpvPlayerPath: string;
    mpvReuseInstance: boolean;
    vlcPlayerPath: string;
    remoteControl: boolean;
    remoteControlPort: number;
    /** Custom download folder path (uses system Downloads folder if not set) */
    downloadFolder?: string;
}
