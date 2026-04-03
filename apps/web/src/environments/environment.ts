import packageJson from '@package';

export const AppConfig = {
    production: false,
    environment: 'LOCAL',
    version: packageJson.version,
    BACKEND_URL: 'http://localhost:3000',
    /** Optional: TMDB API key for experimental movie/series metadata enrichment. Leave empty to disable. */
    tmdbApiKey: '6b1134d6382480dbbecad0055d5ab2e4' as string,
};
