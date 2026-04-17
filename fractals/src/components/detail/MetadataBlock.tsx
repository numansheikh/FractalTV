import { useState } from 'react'
import { ContentItem } from '@/lib/types'

interface Props {
  item: ContentItem
  isSeries?: boolean
  hideHero?: boolean
}

function titleInitials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function parseGenres(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean)
    return [String(parsed)].filter(Boolean)
  } catch {
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
  }
}

function formatRuntime(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  return `${minutes}m`
}

/**
 * Derive display title from search_title (anyAscii lowercase).
 * Strips the IPTV prefix if present, then sentence-cases (first letter only).
 * Falls back to raw title if search_title is absent.
 */
function displayTitleFromSearchTitle(
  searchTitle: string | null | undefined,
  rawTitle: string,
  mdPrefix: string | null | undefined,
): string {
  let s = (searchTitle || rawTitle).trim()
  // Strip prefix — case-insensitive to handle both raw and anyAscii-lowercased variants
  if (mdPrefix) {
    const pre = mdPrefix.toLowerCase()
    const sLower = s.toLowerCase()
    if (sLower.startsWith(`${pre} - `)) s = s.slice(pre.length + 3).trim()
    else if (sLower.startsWith(`${pre}: `)) s = s.slice(pre.length + 2).trim()
  }
  // Strip (YYYY) year patterns — may still be present if md_populate hasn't run
  s = s.replace(/\s*\([12][0-9]{3}\)/g, '').trim()
  // Strip trailing bracket noise and asterisk
  s = s.replace(/\s*\[.*?\]/g, '').trim()
  s = s.replace(/\*$/, '').trim()
  // Title-case: capitalize first letter of each word (skip common articles/prepositions)
  const articles = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'but', 'or', 'nor'])
  return s.split(/\s+/).map((word, i) => {
    const lower = word.toLowerCase()
    if (i > 0 && articles.has(lower)) return lower
    return word.charAt(0).toUpperCase() + word.slice(1)
  }).join(' ')
}

export function MetadataBlock({ item, isSeries, hideHero }: Props) {
  const [heroError, setHeroError] = useState(false)
  const backdrop = item.backdropUrl ?? item.backdrop_url
  const poster = item.posterUrl ?? item.poster_url
  const rawHero = backdrop || poster
  const heroSrc = rawHero && !heroError ? rawHero : null
  const heroIsPosterFallback = !backdrop && !!poster
  const rating = item.tmdbRating ?? (item as any).tvmazeRating ?? item.ratingTmdb ?? item.rating_tmdb ?? item.ratingImdb ?? item.rating_imdb
  const tvmazeNetwork = (item as any).tvmazeNetwork ?? null
  const tvmazeStatus = (item as any).tvmazeStatus ?? null
  const creator = item.tmdbCreator ?? null
  const genres = parseGenres(item.genres)
  const typeAccent = isSeries ? 'var(--accent-series)' : 'var(--accent-film)'

  const mdPrefix = (item as any).md_prefix ?? null
  const mdLanguage = (item as any).md_language ?? null
  const mdQuality = (item as any).md_quality ?? null
  const searchTitle = (item as any).search_title ?? null
  const displayTitle = displayTitleFromSearchTitle(searchTitle, item.title, mdPrefix)
  // Show raw subtitle when a prefix was stripped or the title contains non-ASCII (transliterated)
  const showRawSubtitle = !!mdPrefix || /[^\x00-\x7F]/.test(item.title)

  // Content facts: year, runtime, rating, network, status, director/creator
  const contentMeta: string[] = []
  if (item.year) contentMeta.push(String(item.year))
  if (item.runtime) contentMeta.push(formatRuntime(item.runtime))
  if (rating) contentMeta.push(`★ ${Number(rating).toFixed(1)}`)
  if (isSeries && item.seasonCount) {
    const ep = item.episodeCount ? ` · ${item.episodeCount} ep` : ''
    contentMeta.push(`${item.seasonCount} season${item.seasonCount !== 1 ? 's' : ''}${ep}`)
  }
  if (tvmazeNetwork) contentMeta.push(tvmazeNetwork)
  if (tvmazeStatus && tvmazeStatus !== 'Running' && tvmazeStatus !== 'Returning Series') contentMeta.push(tvmazeStatus)
  const credit = isSeries ? (creator ?? item.director) : item.director
  if (credit) contentMeta.push(credit)

  // Source tags: IPTV prefix + language, deduped (e.g. "DE" not "DE · DE")
  const sourceTags: string[] = []
  if (mdQuality) sourceTags.push(mdQuality)
  if (mdPrefix) {
    sourceTags.push(mdPrefix)
    const lang = mdLanguage?.toUpperCase()
    if (lang && lang !== mdPrefix.toUpperCase()) sourceTags.push(lang)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!hideHero && !heroSrc && (
        <div style={{
          position: 'relative',
          borderRadius: 8,
          overflow: 'hidden',
          height: 180,
          background: `linear-gradient(135deg, color-mix(in srgb, ${typeAccent} 22%, var(--bg-2)), var(--bg-2) 70%)`,
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{
            fontSize: 56, fontWeight: 700,
            color: typeAccent, opacity: 0.55,
            letterSpacing: '-0.03em', fontFamily: 'var(--font-ui)',
          }}>
            {titleInitials(item.title)}
          </span>
          <div style={{
            position: 'absolute',
            bottom: 0, left: 0, right: 0,
            height: '55%',
            background: 'linear-gradient(to bottom, transparent, var(--bg-2))',
            pointerEvents: 'none',
          }} />
        </div>
      )}
      {!hideHero && heroSrc && (
        <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', height: 180, background: 'var(--bg-2)' }}>
          {heroIsPosterFallback && (
            <img
              src={heroSrc}
              alt=""
              aria-hidden
              onError={() => setHeroError(true)}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                filter: 'blur(24px) saturate(1.1)',
                transform: 'scale(1.15)',
                opacity: 0.7,
              }}
            />
          )}
          <img
            src={heroSrc}
            alt=""
            onError={() => setHeroError(true)}
            style={{
              position: 'relative',
              width: '100%', height: '100%',
              objectFit: heroIsPosterFallback ? 'contain' : 'cover',
              display: 'block',
            }}
          />
          <div style={{
            position: 'absolute',
            bottom: 0, left: 0, right: 0,
            height: '55%',
            background: 'linear-gradient(to bottom, transparent, var(--bg-2))',
            pointerEvents: 'none',
          }} />
        </div>
      )}

      {/* Title — clean title-cased version; negative margin overlaps the hero banner by 20px */}
      <h2 style={{
        fontSize: 22,
        fontWeight: 600,
        color: 'var(--text-0)',
        margin: 0,
        marginTop: !hideHero ? -35 : 0,
        lineHeight: 1.25,
        fontFamily: 'var(--font-ui)',
        position: 'relative',
      }}>
        {displayTitle}
      </h2>

      {/* Raw title subtitle — shown only when it differs from the clean version */}
      {showRawSubtitle && (
        <p style={{
          fontSize: 11,
          color: 'var(--text-2)',
          margin: 0,
          lineHeight: 1.4,
          fontFamily: 'var(--font-mono)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {item.title}
        </p>
      )}

      {/* Meta line */}
      {contentMeta.length > 0 && (
        <span style={{
          fontSize: 13, color: 'var(--text-1)',
          fontFamily: 'var(--font-ui)', lineHeight: 1.4,
        }}>
          {contentMeta.join(' · ')}
        </span>
      )}

      {/* Genre pills — in place of source category tags */}
      {genres.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {genres.map((g) => (
            <span key={g} style={{
              fontSize: 11, padding: '4px 8px', borderRadius: 4,
              background: 'var(--bg-3)', color: 'var(--text-1)',
              fontFamily: 'var(--font-ui)',
            }}>
              {g}
            </span>
          ))}
        </div>
      ) : sourceTags.length > 0 ? (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {sourceTags.map((tag) => (
            <span key={tag} style={{
              fontSize: 10, fontWeight: 500,
              padding: '2px 6px', borderRadius: 3,
              background: 'var(--bg-3)',
              color: 'var(--text-3)',
              fontFamily: 'var(--font-ui)',
              letterSpacing: '0.04em',
              lineHeight: 1.6,
            }}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
