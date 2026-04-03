/**
 * TMDB API response types (experimental feature).
 * @see https://developer.themoviedb.org/reference/movie-details
 */

export interface TmdbGenre {
    id: number;
    name: string;
}

export interface TmdbMovieDetails {
    id: number;
    title: string;
    original_title?: string;
    overview?: string;
    poster_path?: string;
    backdrop_path?: string;
    release_date?: string;
    runtime?: number;
    vote_average?: number;
    vote_count?: number;
    genres?: TmdbGenre[];
    imdb_id?: string;
}

export interface TmdbSearchResult {
    id: number;
    title: string;
    poster_path?: string;
    backdrop_path?: string;
    release_date?: string;
    vote_average?: number;
}

export interface TmdbSearchResponse {
    results: TmdbSearchResult[];
    total_results: number;
}

/** TV show details from TMDB API (GET /tv/{id}) */
export interface TmdbTvDetails {
    id: number;
    name: string;
    original_name?: string;
    overview?: string;
    poster_path?: string;
    backdrop_path?: string;
    first_air_date?: string;
    vote_average?: number;
    vote_count?: number;
    genres?: TmdbGenre[];
    number_of_seasons?: number;
    number_of_episodes?: number;
}

/** TV search result (from GET /search/tv) */
export interface TmdbTvSearchResult {
    id: number;
    name: string;
    poster_path?: string;
    backdrop_path?: string;
    first_air_date?: string;
    vote_average?: number;
}

export interface TmdbTvSearchResponse {
    results: TmdbTvSearchResult[];
    total_results: number;
}
