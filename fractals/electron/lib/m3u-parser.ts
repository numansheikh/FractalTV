/**
 * M3U parser — pure functions, no Electron/DB dependencies.
 * Safe to import from worker threads.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface M3uEntry {
  title: string
  groupTitle: string   // category name
  tvgId?: string       // EPG channel ID
  tvgName?: string
  tvgLogo?: string
  tvgLanguage?: string // from tvg-language attribute
  tvgCountry?: string  // from tvg-country attribute
  duration: number     // EXTINF duration in seconds (-1 = live/unknown)
  url: string
  type: 'live' | 'movie' | 'series'
  containerExtension?: string // extracted from URL (.mp4, .mkv, etc.)
  httpHeaders?: Record<string, string> // from #EXTVLCOPT directives
}

export interface M3uParseResult {
  entries: M3uEntry[]
  epgUrl: string | null // from url-tvg or x-tvg-url in #EXTM3U header
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function guessType(url: string): 'live' | 'movie' | 'series' {
  if (url.match(/\/series\//i)) return 'series'
  if (url.match(/\/movie\//i) || url.match(/\.(mp4|mkv|avi|mov|wmv|flv)(\?|$)/i)) return 'movie'
  return 'live'
}

/** Extract container extension from a URL. Returns lowercase without dot, or undefined. */
export function extractContainerExt(url: string): string | undefined {
  const m = url.match(/\.(mp4|mkv|ts|avi|mov|flv|wmv)(\?|$)/i)
  return m ? m[1].toLowerCase() : undefined
}

/** Extract EPG URL from the #EXTM3U header line. */
function parseEpgUrl(line: string): string | null {
  const m = line.match(/(?:url-tvg|x-tvg-url)\s*=\s*"([^"]+)"/i)
  return m ? m[1].trim() : null
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export function parseM3u(text: string): M3uParseResult {
  const lines = text.split(/\r?\n/)
  const entries: M3uEntry[] = []
  let current: Partial<M3uEntry> | null = null
  let epgUrl: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Parse #EXTM3U header for EPG URL
    if (trimmed.startsWith('#EXTM3U')) {
      epgUrl = parseEpgUrl(trimmed)
      continue
    }

    if (trimmed.startsWith('#EXTINF:')) {
      const commaIdx = trimmed.indexOf(',')
      const title = commaIdx >= 0 ? trimmed.slice(commaIdx + 1).trim() : 'Unknown'
      const meta = commaIdx >= 0 ? trimmed.slice(8, commaIdx) : trimmed.slice(8)

      const durMatch = meta.match(/^(-?\d+)/)
      const duration = durMatch ? parseInt(durMatch[1], 10) : -1

      const attrs: Record<string, string> = {}
      const attrRegex = /([\w-]+)="([^"]*)"/g
      let m: RegExpExecArray | null
      while ((m = attrRegex.exec(meta)) !== null) {
        attrs[m[1].toLowerCase()] = m[2]
      }

      current = {
        title,
        groupTitle: attrs['group-title'] || 'Uncategorized',
        tvgId: attrs['tvg-id'] || undefined,
        tvgName: attrs['tvg-name'] || undefined,
        tvgLogo: attrs['tvg-logo'] || undefined,
        tvgLanguage: attrs['tvg-language'] || undefined,
        tvgCountry: attrs['tvg-country'] || undefined,
        duration,
      }
    } else if (trimmed.startsWith('#EXTVLCOPT:') && current) {
      // #EXTVLCOPT:http-user-agent=Mozilla/5.0 ...
      // #EXTVLCOPT:http-referrer=https://example.com
      const optBody = trimmed.slice(11) // after '#EXTVLCOPT:'
      const eqIdx = optBody.indexOf('=')
      if (eqIdx > 0) {
        const key = optBody.slice(0, eqIdx).trim().toLowerCase()
        const val = optBody.slice(eqIdx + 1).trim()
        if (key === 'http-user-agent') {
          if (!current.httpHeaders) current.httpHeaders = {}
          current.httpHeaders['User-Agent'] = val
        } else if (key === 'http-referrer' || key === 'http-referer') {
          if (!current.httpHeaders) current.httpHeaders = {}
          current.httpHeaders['Referer'] = val
        } else if (key === 'http-origin') {
          if (!current.httpHeaders) current.httpHeaders = {}
          current.httpHeaders['Origin'] = val
        }
      }
    } else if (trimmed.startsWith('#')) {
      continue
    } else if (current) {
      current.url = trimmed
      // URL path (/series/, /movie/) takes precedence over duration.
      // Duration -1 only forces 'live' when URL has no type signal.
      const urlType = guessType(trimmed)
      current.type = urlType !== 'live' ? urlType
        : current.duration === -1 ? 'live'
        : 'movie'
      current.containerExtension = extractContainerExt(trimmed)
      entries.push(current as M3uEntry)
      current = null
    }
  }

  return { entries, epgUrl }
}
