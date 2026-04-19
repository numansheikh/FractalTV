import { useState } from 'react'
import { ContentItem } from '@/lib/types'

interface Props {
  item: ContentItem
  sourceAccent?: string
  catchupSupported: boolean
  catchupDays?: number
}

export function IdentityCard({ item, sourceAccent, catchupSupported, catchupDays }: Props) {
  const isMatched = !!item.io_name

  if (!isMatched) {
    return <UnmatchedIdentity item={item} sourceAccent={sourceAccent} catchupSupported={catchupSupported} catchupDays={catchupDays} />
  }
  return <MatchedIdentity item={item} sourceAccent={sourceAccent} catchupSupported={catchupSupported} catchupDays={catchupDays} />
}

function UnmatchedIdentity({ item, sourceAccent, catchupSupported, catchupDays }: Props) {
  const [imgError, setImgError] = useState(false)
  const logo = item.posterUrl ?? item.poster_url
  const hasLogo = logo && !imgError
  const initials = item.title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')

  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <LogoBox logo={hasLogo ? logo : null} initials={initials} accent={sourceAccent} onError={() => setImgError(true)} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <h2 style={{
          fontSize: 18, fontWeight: 600,
          color: 'var(--text-0)',
          margin: 0, lineHeight: 1.3,
          fontFamily: 'var(--font-ui)',
          wordBreak: 'break-word',
        }}>
          {item.title}
        </h2>
        {catchupSupported && (
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-ui)' }}>
            Catchup{catchupDays ? ` · ${catchupDays} days` : ''}
          </p>
        )}
      </div>
    </div>
  )
}

function MatchedIdentity({ item, sourceAccent, catchupSupported, catchupDays }: Props) {
  const [imgError, setImgError] = useState(false)
  const [altNamesOpen, setAltNamesOpen] = useState(false)

  const logoUrl = item.io_logo_url ?? item.posterUrl ?? item.poster_url ?? null
  const logo: string | null = imgError ? null : logoUrl

  const initials = item.title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')

  const altNames: string[] = safeJsonArray(item.io_alt_names)
  const owners: string[] = safeJsonArray(item.io_owners)
  const categoryLabels: string[] = safeJsonArray(item.io_category_labels)

  const ioNameDiffers = item.io_name && item.io_name.toLowerCase() !== item.title.toLowerCase()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {item.io_is_blocked ? (
        <div style={{
          padding: '4px 10px',
          borderRadius: 4,
          background: 'color-mix(in srgb, #f59e0b 18%, transparent)',
          border: '1px solid color-mix(in srgb, #f59e0b 40%, transparent)',
          fontSize: 11, color: '#f59e0b',
          fontFamily: 'var(--font-ui)', fontWeight: 600,
        }}>
          Channel is blocked in some regions
        </div>
      ) : null}

      {/* Logo + title row */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <LogoBox logo={logo} initials={initials} accent={sourceAccent} onError={() => setImgError(true)} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <h2 style={{
              fontSize: 18, fontWeight: 600,
              color: 'var(--text-0)',
              margin: 0, lineHeight: 1.3,
              fontFamily: 'var(--font-ui)',
              wordBreak: 'break-word',
            }}>
              {item.title}
            </h2>
            {item.io_is_nsfw ? (
              <span style={{
                fontSize: 10, fontWeight: 700,
                background: '#e05555', color: '#fff',
                padding: '1px 5px', borderRadius: 3,
                fontFamily: 'var(--font-ui)',
                flexShrink: 0,
              }}>
                NSFW
              </span>
            ) : null}
          </div>

          {ioNameDiffers && (
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-1)', fontFamily: 'var(--font-ui)' }}>
              {item.io_name}
            </p>
          )}

          {(item.io_country_flag || item.io_country_name) && (
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-0)', fontFamily: 'var(--font-ui)' }}>
              {item.io_country_flag} {item.io_country_name}
            </p>
          )}

          {catchupSupported && (
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-ui)' }}>
              Catchup{catchupDays ? ` · ${catchupDays} days` : ''}
            </p>
          )}
        </div>
      </div>

      {/* Category chips */}
      {categoryLabels.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {categoryLabels.map((label) => (
            <span key={label} style={{
              fontSize: 10, fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 10,
              background: 'var(--bg-3)',
              color: 'var(--text-1)',
              border: '1px solid var(--border-default)',
              fontFamily: 'var(--font-ui)',
            }}>
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Meta fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {item.io_network && <MetaRow label="Network" value={item.io_network} />}
        {owners.length > 0 && <MetaRow label="Owner" value={owners.join(', ')} />}
        {item.io_launched && <MetaRow label="Launched" value={item.io_launched} />}
        {item.io_closed && <MetaRow label="Closed" value={item.io_closed} />}
        {item.io_replaced_by && <MetaRow label="Replaced by" value={item.io_replaced_by} />}
        {item.io_website && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', minWidth: 90 }}>
              Website
            </span>
            <a href={item.io_website} target="_blank" rel="noreferrer" style={{
              fontSize: 11, color: 'var(--accent-interactive)',
              fontFamily: 'var(--font-mono)',
              wordBreak: 'break-all',
              textDecoration: 'none',
            }}>
              {item.io_website.replace(/^https?:\/\//, '')}
            </a>
          </div>
        )}
      </div>

      {/* Alt names collapsible */}
      {altNames.length > 0 && (
        <div>
          <button
            onClick={() => setAltNamesOpen((v) => !v)}
            style={{
              background: 'none', border: 'none', padding: 0,
              cursor: 'pointer',
              fontSize: 12, color: 'var(--text-1)',
              fontFamily: 'var(--font-ui)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span>{altNamesOpen ? '▾' : '▸'}</span>
            Also known as
          </button>
          {altNamesOpen && (
            <div style={{ marginTop: 4, paddingLeft: 14 }}>
              {altNames.map((n, i) => (
                <p key={i} style={{
                  margin: '2px 0',
                  fontSize: 11, color: 'var(--text-1)',
                  fontFamily: 'var(--font-ui)',
                }}>
                  {n}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LogoBox({ logo, initials, accent, onError }: { logo: string | null; initials: string; accent?: string; onError: () => void }) {
  return (
    <div style={{
      width: 96, height: 96,
      borderRadius: 8,
      background: 'var(--bg-3)',
      border: '1px solid var(--border-default)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {logo ? (
        <img
          src={logo}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 10 }}
          onError={onError}
        />
      ) : (
        <span style={{
          fontSize: 28, fontWeight: 700,
          color: accent ?? 'var(--text-1)',
          letterSpacing: '-0.02em',
        }}>
          {initials}
        </span>
      )}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{
        fontSize: 11, color: 'var(--text-1)',
        fontFamily: 'var(--font-mono)',
        minWidth: 90, flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 11, color: 'var(--text-0)',
        fontFamily: 'var(--font-mono)',
        wordBreak: 'break-all',
      }}>
        {value}
      </span>
    </div>
  )
}

function safeJsonArray(raw?: string): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'string' && v)
  } catch { /* ignore */ }
  return []
}
