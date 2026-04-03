import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { AppConfig } from '../../../environments/environment';
import type {
    TmdbMovieDetails,
    TmdbSearchResponse,
    TmdbTvDetails,
    TmdbTvSearchResponse,
} from './tmdb.types';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/**
 * Experimental: Enrichment data from TMDB that can be merged into Xtream VOD info.
 * Only fields we use for display; matches Xtream info shape where possible.
 */
export interface TmdbEnrichment {
    movie_image?: string;
    backdrop_path?: string[];
    description?: string;
    plot?: string;
    rating_imdb?: string;
    genre?: string;
    releasedate?: string;
    duration?: string;
    country?: string;
}

/** Enrichment for series (TV show) - maps to XtreamSerieInfo shape */
export interface TmdbTvEnrichment {
    cover?: string;
    backdrop_path?: string[];
    plot?: string;
    genre?: string;
    releaseDate?: string;
    rating?: string;
}

@Injectable({ providedIn: 'root' })
export class TmdbService {
    private readonly http = inject(HttpClient);

    private get apiKey(): string | undefined {
        return (AppConfig as { tmdbApiKey?: string }).tmdbApiKey;
    }

    /** True if TMDB enrichment is enabled (API key set). */
    get isEnabled(): boolean {
        const key = this.apiKey;
        return typeof key === 'string' && key.length > 0;
    }

    /**
     * Fetch movie details by TMDB id.
     * Returns null if disabled, key missing, or request fails.
     */
    async getMovieByTmdbId(tmdbId: number): Promise<TmdbEnrichment | null> {
        if (!this.isEnabled || !tmdbId) return null;

        const url = `${TMDB_BASE}/movie/${tmdbId}?api_key=${this.apiKey}`;
        return firstValueFrom(
            this.http.get<TmdbMovieDetails>(url).pipe(
                map((data) => this.normalizeMovieToEnrichment(data)),
                catchError(() => of(null))
            )
        ).then((v) => v ?? null);
    }

    /**
     * Search movie by title and optional year; returns enrichment from first result.
     * Used when Xtream does not provide tmdb_id.
     */
    async searchMovie(title: string, year?: string): Promise<TmdbEnrichment | null> {
        if (!this.isEnabled || !title?.trim()) return null;

        const params = new URLSearchParams({
            api_key: this.apiKey!,
            query: title.trim(),
            ...(year ? { year } : {}),
        });
        const url = `${TMDB_BASE}/search/movie?${params}`;
        const res = await firstValueFrom(
            this.http.get<TmdbSearchResponse>(url).pipe(catchError(() => of({ results: [] })))
        ).then((r) => r ?? { results: [] });
        const first = res?.results?.[0];
        if (!first?.id) return null;
        return this.getMovieByTmdbId(first.id);
    }

    /**
     * Fetch only the poster URL for a movie (single search request, no details).
     * Used by "Refresh all" on listing to avoid full-detail API calls.
     */
    async getMoviePosterOnly(name: string, year?: string): Promise<string | null> {
        if (!this.isEnabled || !name?.trim()) return null;
        const params = new URLSearchParams({
            api_key: this.apiKey!,
            query: name.trim(),
            ...(year ? { year } : {}),
        });
        const url = `${TMDB_BASE}/search/movie?${params}`;
        const res = await firstValueFrom(
            this.http.get<TmdbSearchResponse>(url).pipe(catchError(() => of({ results: [] })))
        ).then((r) => r ?? { results: [] });
        const first = res?.results?.[0];
        if (!first?.poster_path) return null;
        return `${TMDB_IMAGE_BASE}/w500${first.poster_path}`;
    }

    /**
     * Fetch only the poster URL for a TV show (single search request, no details).
     */
    async getTvPosterOnly(name: string, year?: string): Promise<string | null> {
        if (!this.isEnabled || !name?.trim()) return null;
        const params = new URLSearchParams({
            api_key: this.apiKey!,
            query: name.trim(),
            ...(year ? { first_air_date_year: year } : {}),
        });
        const url = `${TMDB_BASE}/search/tv?${params}`;
        const res = await firstValueFrom(
            this.http
                .get<TmdbTvSearchResponse>(url)
                .pipe(catchError(() => of({ results: [] })))
        ).then((r) => r ?? { results: [] });
        const first = res?.results?.[0];
        if (!first?.poster_path) return null;
        return `${TMDB_IMAGE_BASE}/w500${first.poster_path}`;
    }

    /**
     * Enrich VOD metadata from TMDB: by tmdb_id if present, else search by title/year.
     */
    async enrichForVod(info: {
        tmdb_id?: number;
        name?: string;
        o_name?: string;
        releasedate?: string;
    }): Promise<TmdbEnrichment | null> {
        if (!this.isEnabled) return null;

        if (info?.tmdb_id) {
            const byId = await this.getMovieByTmdbId(info.tmdb_id);
            if (byId) return byId;
        }

        const name = info?.name || info?.o_name;
        const year = info?.releasedate ? String(info.releasedate).slice(0, 4) : undefined;
        if (name) return this.searchMovie(name, year);
        return null;
    }

    /**
     * Fetch TV show details by TMDB id.
     */
    async getTvShowByTmdbId(tmdbId: number): Promise<TmdbTvEnrichment | null> {
        if (!this.isEnabled || !tmdbId) return null;

        const url = `${TMDB_BASE}/tv/${tmdbId}?api_key=${this.apiKey}`;
        return firstValueFrom(
            this.http.get<TmdbTvDetails>(url).pipe(
                map((data) => this.normalizeTvToEnrichment(data)),
                catchError(() => of(null))
            )
        ).then((v) => v ?? null);
    }

    /**
     * Search TV show by name; returns enrichment from first result.
     */
    async searchTvShow(name: string, year?: string): Promise<TmdbTvEnrichment | null> {
        if (!this.isEnabled || !name?.trim()) return null;

        const params = new URLSearchParams({
            api_key: this.apiKey!,
            query: name.trim(),
            ...(year ? { first_air_date_year: year } : {}),
        });
        const url = `${TMDB_BASE}/search/tv?${params}`;
        const res = await firstValueFrom(
            this.http
                .get<TmdbTvSearchResponse>(url)
                .pipe(catchError(() => of({ results: [] })))
        ).then((r) => r ?? { results: [] });
        const first = res?.results?.[0];
        if (!first?.id) return null;
        return this.getTvShowByTmdbId(first.id);
    }

    /**
     * Enrich series (TV show) metadata from TMDB: by tmdb_id if present, else search by name/year.
     */
    async enrichForSeries(info: {
        tmdb_id?: number;
        name?: string;
        releaseDate?: string;
    }): Promise<TmdbTvEnrichment | null> {
        if (!this.isEnabled) return null;

        if (info?.tmdb_id) {
            const byId = await this.getTvShowByTmdbId(info.tmdb_id);
            if (byId) return byId;
        }

        const name = info?.name;
        const year = info?.releaseDate ? String(info.releaseDate).slice(0, 4) : undefined;
        if (name) return this.searchTvShow(name, year);
        return null;
    }

    private normalizeTvToEnrichment(t: TmdbTvDetails): TmdbTvEnrichment {
        const genre = t.genres?.map((g) => g.name).join(', ');
        const year = t.first_air_date?.slice(0, 4);
        const rating =
            t.vote_average != null ? t.vote_average.toFixed(1) : undefined;
        return {
            cover: t.poster_path ? `${TMDB_IMAGE_BASE}/w500${t.poster_path}` : undefined,
            backdrop_path: t.backdrop_path
                ? [`${TMDB_IMAGE_BASE}/w780${t.backdrop_path}`]
                : undefined,
            plot: t.overview,
            genre,
            releaseDate: year,
            rating,
        };
    }

    private normalizeMovieToEnrichment(m: TmdbMovieDetails): TmdbEnrichment {
        const genre = m.genres?.map((g) => g.name).join(', ');
        const year = m.release_date?.slice(0, 4);
        const duration = m.runtime ? `${Math.floor(m.runtime / 60)}h ${m.runtime % 60}m` : undefined;
        const rating = m.vote_average != null ? m.vote_average.toFixed(1) : undefined;

        return {
            movie_image: m.poster_path ? `${TMDB_IMAGE_BASE}/w500${m.poster_path}` : undefined,
            backdrop_path: m.backdrop_path ? [`${TMDB_IMAGE_BASE}/w780${m.backdrop_path}`] : undefined,
            description: m.overview,
            plot: m.overview,
            rating_imdb: rating,
            genre,
            releasedate: year,
            duration,
            country: undefined,
        };
    }
}
