import packageJson from '@package';

/**
 * Environment for Capacitor (Android/iOS) builds.
 * Xtream requests go to BACKEND_URL/xtream — use a server that implements that API.
 *
 * Default: emulator → host (run xtream-mock-server on your machine, e.g. port 3211).
 * Physical device: use your machine's LAN IP (e.g. http://192.168.1.x:3211).
 * Production: use your deployed backend URL.
 */
export const AppConfig = {
    production: true,
    environment: 'MOBILE',
    version: packageJson.version,
    BACKEND_URL: 'http://10.0.2.2:3211',
    tmdbApiKey: '' as string,
};
