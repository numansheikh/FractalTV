import packageJson from '@package';

export const AppConfig = {
    production: true,
    environment: 'PROD',
    version: packageJson.version,
    BACKEND_URL: 'https://iptvnator-playlist-parser-api.vercel.app',
    /** Optional: TMDB API key for experimental movie/series metadata enrichment. Leave empty to disable. */
    tmdbApiKey: '' as string,
};
