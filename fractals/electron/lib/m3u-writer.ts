export interface M3uEntry {
  title: string
  url: string
  tvgId?: string | null
  tvgLogo?: string | null
  groupTitle?: string | null
  durationSec?: number
}

function sanitize(s: string): string {
  return s.replace(/[\n\r]+/g, ' ').replace(/"/g, "''").trim()
}

function attrs(entry: M3uEntry): string {
  const parts: string[] = []
  if (entry.tvgId) parts.push(`tvg-id="${sanitize(entry.tvgId)}"`)
  if (entry.tvgLogo) parts.push(`tvg-logo="${sanitize(entry.tvgLogo)}"`)
  if (entry.groupTitle) parts.push(`group-title="${sanitize(entry.groupTitle)}"`)
  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

export function generateM3u(entries: M3uEntry[], opts?: { epgUrl?: string }): string {
  const lines: string[] = []
  const header = opts?.epgUrl ? `#EXTM3U url-tvg="${sanitize(opts.epgUrl)}"` : '#EXTM3U'
  lines.push(header)
  for (const e of entries) {
    const dur = typeof e.durationSec === 'number' ? e.durationSec : -1
    lines.push(`#EXTINF:${dur}${attrs(e)},${sanitize(e.title)}`)
    lines.push(e.url)
  }
  return lines.join('\n') + '\n'
}
