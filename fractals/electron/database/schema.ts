import { sqliteTable, text, integer, real, blob } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─── Sources ────────────────────────────────────────────────────────────────

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['xtream', 'm3u'] }).notNull(),
  name: text('name').notNull(),
  // Xtream fields
  serverUrl: text('server_url'),
  username: text('username'),
  password: text('password'),
  // M3U fields
  m3uUrl: text('m3u_url'),
  // Status
  status: text('status', { enum: ['active', 'error', 'syncing'] }).notNull().default('active'),
  lastSync: integer('last_sync', { mode: 'timestamp' }),
  lastError: text('last_error'),
  itemCount: integer('item_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

// ─── Categories ─────────────────────────────────────────────────────────────

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(), // category_id from Xtream
  name: text('name').notNull(),
  type: text('type', { enum: ['live', 'movie', 'series'] }).notNull(),
})

// ─── Content ─────────────────────────────────────────────────────────────────
// Unified table for live channels, movies, series, and episodes.
// When the same content exists across multiple sources, we store ONE row here
// and multiple rows in content_sources.

export const content = sqliteTable('content', {
  id: text('id').primaryKey(),

  // Xtream/source reference (from the first source that provided it)
  primarySourceId: text('primary_source_id').notNull().references(() => sources.id),
  externalId: text('external_id').notNull(), // stream_id or series_id from Xtream

  // Content type
  type: text('type', { enum: ['live', 'movie', 'series', 'episode'] }).notNull(),

  // Basic info (always present from Xtream)
  title: text('title').notNull(),
  categoryId: text('category_id'),

  // TMDB enrichment (nullable until enriched)
  tmdbId: integer('tmdb_id'),
  originalTitle: text('original_title'),
  year: integer('year'),
  plot: text('plot'),
  posterUrl: text('poster_url'),
  backdropUrl: text('backdrop_url'),
  ratingImdb: real('rating_imdb'),
  ratingTmdb: real('rating_tmdb'),
  genres: text('genres'), // JSON array: ["Action", "Drama"]
  languages: text('languages'), // JSON array: ["en", "fr"]
  country: text('country'),
  director: text('director'),
  cast: text('cast'), // JSON array of names
  keywords: text('keywords'), // JSON array from TMDB
  runtime: integer('runtime'), // minutes

  // Series hierarchy
  parentId: text('parent_id').references((): any => content.id),
  seasonNumber: integer('season_number'),
  episodeNumber: integer('episode_number'),

  // Stream info (for live/movie — series episodes use content_sources)
  containerExtension: text('container_extension'),
  catchupSupported: integer('catchup_supported', { mode: 'boolean' }).notNull().default(false),
  catchupDays: integer('catchup_days').notNull().default(0),

  // Enrichment status
  enriched: integer('enriched', { mode: 'boolean' }).notNull().default(false),
  enrichedAt: integer('enriched_at', { mode: 'timestamp' }),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

// ─── Content Sources ─────────────────────────────────────────────────────────
// Maps content to the source(s) it's available from.
// One content item can be available from multiple sources.

export const contentSources = sqliteTable('content_sources', {
  id: text('id').primaryKey(),
  contentId: text('content_id').notNull().references(() => content.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(), // stream_id in this specific source
  streamUrl: text('stream_url'), // constructed on demand, not stored
  quality: text('quality'), // e.g. "FHD", "HD", "SD"
  priority: integer('priority').notNull().default(0), // higher = preferred
})

// ─── EPG ─────────────────────────────────────────────────────────────────────

export const epg = sqliteTable('epg', {
  id: text('id').primaryKey(),
  channelExternalId: text('channel_external_id').notNull(),
  sourceId: text('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  startTime: integer('start_time', { mode: 'timestamp' }).notNull(),
  endTime: integer('end_time', { mode: 'timestamp' }).notNull(),
  category: text('category'),
})

// ─── Embeddings ──────────────────────────────────────────────────────────────

export const embeddings = sqliteTable('embeddings', {
  contentId: text('content_id').primaryKey().references(() => content.id, { onDelete: 'cascade' }),
  vector: blob('vector').notNull(), // Float32Array serialized as Buffer
  model: text('model').notNull().default('all-MiniLM-L6-v2'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

// ─── User Data ───────────────────────────────────────────────────────────────

export const userData = sqliteTable('user_data', {
  contentId: text('content_id').primaryKey().references(() => content.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').notNull().default('default'),
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
  watchlist: integer('watchlist', { mode: 'boolean' }).notNull().default(false),
  lastPosition: integer('last_position').notNull().default(0), // seconds
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  lastWatchedAt: integer('last_watched_at', { mode: 'timestamp' }),
  rating: integer('rating'), // user's personal rating 1-5
})

// ─── Profiles ────────────────────────────────────────────────────────────────

export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  pin: text('pin'), // nullable = no PIN required
  isChild: integer('is_child', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

// ─── Type exports ─────────────────────────────────────────────────────────────

export type Source = typeof sources.$inferSelect
export type NewSource = typeof sources.$inferInsert
export type Category = typeof categories.$inferSelect
export type Content = typeof content.$inferSelect
export type NewContent = typeof content.$inferInsert
export type ContentSource = typeof contentSources.$inferSelect
export type EpgEntry = typeof epg.$inferSelect
export type UserData = typeof userData.$inferSelect
export type Profile = typeof profiles.$inferSelect
