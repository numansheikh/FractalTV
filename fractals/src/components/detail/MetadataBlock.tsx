import { ContentItem } from '@/lib/types'

interface Props {
  item: ContentItem
  isEnriched: boolean
  isSeries?: boolean
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

export function MetadataBlock({ item, isEnriched }: Props) {
  const backdrop = item.backdropUrl ?? item.backdrop_url
  const rating = item.ratingTmdb ?? item.rating_tmdb ?? item.ratingImdb ?? item.rating_imdb
  const genres = parseGenres(item.genres)

  const metaparts: string[] = []
  if (item.year) metaparts.push(String(item.year))
  if (item.runtime) metaparts.push(formatRuntime(item.runtime))
  if (rating) metaparts.push(`★ ${Number(rating).toFixed(1)}`)
  if (item.director) metaparts.push(item.director)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Backdrop strip */}
      {backdrop && (
        <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
          <img
            src={backdrop}
            alt=""
            style={{
              width: '100%',
              maxHeight: 180,
              objectFit: 'cover',
              display: 'block',
            }}
          />
          {/* Gradient overlay at bottom fading to --bg-1 */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '50%',
            background: 'linear-gradient(to bottom, transparent, var(--bg-1))',
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

      {/* No metadata note */}
      {!isEnriched && (
        <p style={{
          fontSize: 11,
          color: 'var(--text-3)',
          margin: 0,
          fontStyle: 'italic',
          fontFamily: 'var(--font-ui)',
        }}>
          No metadata — fetching…
        </p>
      )}
    </div>
  )
}
