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

  // iptv-org enrichment — present when channel has an iptv_org_id match
  io_name?: string
  io_alt_names?: string       // JSON array
  io_network?: string
  io_owners?: string          // JSON array
  io_country?: string
  io_country_name?: string
  io_country_flag?: string
  io_category_labels?: string // JSON array
  io_is_nsfw?: number
  io_is_blocked?: number
  io_launched?: string
  io_closed?: string
  io_replaced_by?: string
  io_website?: string
  io_logo_url?: string

  // EPG — computed from DB, 1 if EPG data exists for this channel
  has_epg_data?: number

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
