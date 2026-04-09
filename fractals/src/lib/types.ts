// Central type definitions shared across all components

export interface ContentItem {
  id: string
  type: 'live' | 'movie' | 'series'
  title: string
  year?: number
  plot?: string
  posterUrl?: string
  poster_url?: string
  backdropUrl?: string
  backdrop_url?: string
  ratingTmdb?: number
  rating_tmdb?: number
  ratingImdb?: number
  rating_imdb?: number
  genres?: string
  director?: string
  cast?: string
  runtime?: number
  sourceIds?: string
  primarySourceId?: string
  primary_source_id?: string
  categoryId?: string
  enriched?: number
  // Episode-specific fields (when type would be 'series' episode)
  _streamId?: string
  _serverUrl?: string
  _username?: string
  _password?: string
  _extension?: string
  // Catchup/timeshift — bypasses normal stream URL resolution
  _catchupUrl?: string

  // Category name — populated from full content record
  category_name?: string

  // Parent series info — set on episode items so player can navigate back
  _parent?: { id: string; title: string; type: 'series' }

  // Set when returned from channels:favorites (new schema)
  canonical_id?: string

  // Continue-watching fields — present when returned from user:continue-watching
  last_position?: number
  last_watched_at?: number
  // For series: the specific episode to resume
  resume_episode_id?: string
  resume_season_number?: number
  resume_episode_number?: number
  resume_episode_title?: string
}

export type ContentType = 'all' | 'live' | 'movie' | 'series'

export type ActiveView = 'home' | 'live' | 'films' | 'series' | 'library'

export interface BreadcrumbNav {
  type?: 'live' | 'movie' | 'series'
  sourceId?: string
  category?: string
}
