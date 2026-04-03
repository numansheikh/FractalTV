# Experimental: TMDB metadata enrichment

Optional enrichment of movie (VOD) details using [The Movie Database (TMDB)](https://www.themoviedb.org/) API. When enabled, opening a movie’s detail page can fill in missing poster, backdrop, description, rating, genre, and year from TMDB when the Xtream provider doesn’t supply them.

## How to enable

1. **Get a free API key**  
   Register at [themoviedb.org](https://www.themoviedb.org/signup) and create an API key under [Settings → API](https://www.themoviedb.org/settings/api).

2. **Configure the app**  
   Set the key in your environment so the app can read it at build time:

   - **Development**  
     In `apps/web/src/environments/environment.ts`, set:
     ```ts
     tmdbApiKey: 'your_api_key_here',
     ```
   - **Production**  
     In `apps/web/src/environments/environment.prod.ts`, set the same, or use your build pipeline to inject the value (e.g. env var replaced at build time).

   If `tmdbApiKey` is missing or empty, TMDB is disabled and the app behaves as before.

## Behaviour

- **VOD (movies)**: When you open a movie’s detail page, the app first loads data from the Xtream API. If TMDB is enabled, it then:
  - Prefers **TMDB id** when the provider sends `info.tmdb_id`.
  - Otherwise **searches by title** (and year if `info.releasedate` is present).
  - Merges TMDB result only into **empty or missing** fields (poster, backdrop, description, rating, genre, year, duration) so provider data is never overwritten.

- **Series**: Not wired yet; only movies are enriched.

## How to remove (unroll)

To drop the experimental feature:

1. **Environment**  
   Remove `tmdbApiKey` from `apps/web/src/environments/environment.ts` and `environment.prod.ts`.

2. **Store**  
   In `apps/web/src/app/xtream-electron/stores/xtream.store.ts`:
   - Remove the `TmdbService` import and the `mergeTmdbEnrichmentIntoVod` function.
   - In `fetchVodDetailsWithMetadata`, replace the async enrichment block with the original simple `then`: set `details = vodDetails` and pass it directly to `setSelectedItem` (no `tmdbService` or `mergeTmdbEnrichmentIntoVod`).

3. **Service and types**  
   Delete:
   - `apps/web/src/app/xtream-electron/services/tmdb.service.ts`
   - `apps/web/src/app/xtream-electron/services/tmdb.types.ts`

4. **Docs**  
   Delete this file (`docs/EXPERIMENTAL-TMDB.md`).

No other files reference TMDB; the feature is isolated to the above.
