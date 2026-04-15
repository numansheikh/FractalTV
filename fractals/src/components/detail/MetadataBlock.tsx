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

export function MetadataBlock({ item, isSeries, hideHero }: Props) {
  const [heroError, setHeroError] = useState(false)
  const backdrop = item.backdropUrl ?? item.backdrop_url
  const poster = item.posterUrl ?? item.poster_url
  const rawHero = backdrop || poster
  const heroSrc = rawHero && !heroError ? rawHero : null
  const heroIsPosterFallback = !backdrop && !!poster
  const rating = item.ratingTmdb ?? item.rating_tmdb ?? item.ratingImdb ?? item.rating_imdb
  const genres = parseGenres(item.genres)
  const typeAccent = isSeries ? 'var(--accent-series)' : 'var(--accent-film)'

  const metaparts: string[] = []
  if (item.year) metaparts.push(String(item.year))
  if (item.runtime) metaparts.push(formatRuntime(item.runtime))
  if (rating) metaparts.push(`★ ${Number(rating).toFixed(1)}`)
  if (item.director) metaparts.push(item.director)

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
          {/* Blurred fill — when only a portrait poster is available, scale-up + blur
              it so it can fill a wide hero strip without black bars. */}
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
          {/* Sharp image: contain-fit for poster fallback (keeps portrait intact),
              cover-fit for a proper landscape backdrop. */}
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
          {/* Gradient fade to --bg-1 at bottom */}
          <div style={{
            position: 'absolute',
            bottom: 0, left: 0, right: 0,
            height: '55%',
            background: 'linear-gradient(to bottom, transparent, var(--bg-2))',
            pointerEvents: 'none',
          }} />
        </div>
      )}

      {/* Title */}
      <h2 style={{
        fontSize: 22,
        fontWeight: 600,
        color: 'var(--text-0)',
        margin: 0,
        lineHeight: 1.25,
        fontFamily: 'var(--font-ui)',
      }}>
        {item.title}
      </h2>

      {/* Meta line */}
      {metaparts.length > 0 && (
        <p style={{
          fontSize: 13,
          color: 'var(--text-1)',
          margin: 0,
          fontFamily: 'var(--font-ui)',
          lineHeight: 1.4,
        }}>
          {metaparts.join(' · ')}
        </p>
      )}

      {/* Genre pills */}
      {genres.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {genres.map((g) => (
            <span
              key={g}
              style={{
                fontSize: 11,
                padding: '6px 10px',
                borderRadius: 4,
                background: 'var(--bg-3)',
                color: 'var(--text-1)',
                fontFamily: 'var(--font-ui)',
              }}
            >
              {g}
            </span>
          ))}
        </div>
      )}

      {/* No metadata note — hidden until g2+ TMDB integration */}
    </div>
  )
}
