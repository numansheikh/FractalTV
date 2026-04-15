import { getSqlite, setSetting } from '../../database/connection'
import type {
  IptvOrgPayloads,
  IptvOrgChannel,
  IptvOrgCountry,
  IptvOrgCategory,
  IptvOrgLogo,
  IptvOrgGuide,
  IptvOrgStream,
  IptvOrgBlocklistEntry,
  IptvChannelRow,
} from './types'

const BASE = 'https://iptv-org.github.io/api'

const ENDPOINTS = [
  'channels',
  'countries',
  'categories',
  'logos',
  'guides',
  'streams',
  'blocklist',
] as const

// Minimum row counts per endpoint — guardrails against truncated / broken
// deployments. Numbers are deliberately conservative (well under current
// upstream sizes) so normal fluctuation doesn't trip validation.
const MIN_ROWS: Record<(typeof ENDPOINTS)[number], number> = {
  channels:   10000,
  countries:  100,
  categories: 10,
  logos:      5000,
  guides:     500,
  streams:    500,
  blocklist:  100,
}

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`${BASE}/${name}.json`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${name}.json: HTTP ${res.status}`)
  const data = await res.json() as T
  return data
}

export async function fetchAll(): Promise<IptvOrgPayloads> {
  const [channels, countries, categories, logos, guides, streams, blocklist] = await Promise.all([
    fetchJson<IptvOrgChannel[]>('channels'),
    fetchJson<IptvOrgCountry[]>('countries'),
    fetchJson<IptvOrgCategory[]>('categories'),
    fetchJson<IptvOrgLogo[]>('logos'),
    fetchJson<IptvOrgGuide[]>('guides'),
    fetchJson<IptvOrgStream[]>('streams'),
    fetchJson<IptvOrgBlocklistEntry[]>('blocklist'),
  ])
  return { channels, countries, categories, logos, guides, streams, blocklist }
}

export function validateAll(p: IptvOrgPayloads): void {
  const checks: [keyof IptvOrgPayloads, unknown[], number][] = [
    ['channels',   p.channels,   MIN_ROWS.channels],
    ['countries',  p.countries,  MIN_ROWS.countries],
    ['categories', p.categories, MIN_ROWS.categories],
    ['logos',      p.logos,      MIN_ROWS.logos],
    ['guides',     p.guides,     MIN_ROWS.guides],
    ['streams',    p.streams,    MIN_ROWS.streams],
    ['blocklist',  p.blocklist,  MIN_ROWS.blocklist],
  ]
  for (const [name, arr, min] of checks) {
    if (!Array.isArray(arr)) throw new Error(`${name}: not an array`)
    if (arr.length < min) throw new Error(`${name}: only ${arr.length} rows (min ${min})`)
  }
  // Shape spot-checks on the first element of each.
  const c0 = p.channels[0]
  if (!c0 || typeof c0.id !== 'string' || typeof c0.name !== 'string') {
    throw new Error('channels: unexpected shape')
  }
  const co0 = p.countries[0]
  if (!co0 || typeof co0.code !== 'string' || typeof co0.name !== 'string') {
    throw new Error('countries: unexpected shape')
  }
}

export function buildRows(p: IptvOrgPayloads): IptvChannelRow[] {
  const countryByCode = new Map<string, IptvOrgCountry>()
  for (const c of p.countries) countryByCode.set(c.code, c)

  const catById = new Map<string, IptvOrgCategory>()
  for (const c of p.categories) catById.set(c.id, c)

  // Pick the largest logo per channel (fall back to first seen).
  const logoByChannel = new Map<string, IptvOrgLogo>()
  for (const l of p.logos) {
    if (!l.channel || !l.url) continue
    const prev = logoByChannel.get(l.channel)
    if (!prev) { logoByChannel.set(l.channel, l); continue }
    const prevArea = (prev.width ?? 0) * (prev.height ?? 0)
    const curArea = (l.width ?? 0) * (l.height ?? 0)
    if (curArea > prevArea) logoByChannel.set(l.channel, l)
  }

  type GuideRef = { site: string; site_id: string; site_name?: string; lang?: string; feed?: string | null }
  const guidesByChannel = new Map<string, GuideRef[]>()
  for (const g of p.guides) {
    if (!g.channel || !g.site || !g.site_id) continue
    const list = guidesByChannel.get(g.channel) ?? []
    list.push({
      site: g.site,
      site_id: g.site_id,
      site_name: g.site_name,
      lang: g.lang,
      feed: g.feed ?? null,
    })
    guidesByChannel.set(g.channel, list)
  }

  const streamsByChannel = new Map<string, string[]>()
  for (const s of p.streams) {
    if (!s.channel || !s.url) continue
    const list = streamsByChannel.get(s.channel) ?? []
    list.push(s.url)
    streamsByChannel.set(s.channel, list)
  }

  const blocked = new Set<string>()
  for (const b of p.blocklist) {
    const id = typeof b === 'string' ? b : b?.channel
    if (id) blocked.add(id)
  }

  const rows: IptvChannelRow[] = []
  for (const ch of p.channels) {
    if (!ch || typeof ch.id !== 'string') continue
    const country = ch.country ?? null
    const countryMeta = country ? countryByCode.get(country) : undefined
    const categoryIds = Array.isArray(ch.categories) ? ch.categories : []
    const categoryLabels = categoryIds
      .map((id) => catById.get(id)?.name)
      .filter((n): n is string => typeof n === 'string')

    const logo = logoByChannel.get(ch.id)
    const guideRefs = guidesByChannel.get(ch.id) ?? []
    const streamUrls = streamsByChannel.get(ch.id) ?? []

    rows.push({
      id: ch.id,
      name: ch.name,
      alt_names:   ch.alt_names?.length ? JSON.stringify(ch.alt_names) : null,
      network:     ch.network ?? null,
      owners:      ch.owners?.length ? JSON.stringify(ch.owners) : null,
      country,
      category_ids:    categoryIds.length ? JSON.stringify(categoryIds) : null,
      is_nsfw:         ch.is_nsfw ? 1 : 0,
      launched:    ch.launched ?? null,
      closed:      ch.closed ?? null,
      replaced_by: ch.replaced_by ?? null,
      website:     ch.website ?? null,
      country_name: countryMeta?.name ?? null,
      country_flag: countryMeta?.flag ?? null,
      category_labels: categoryLabels.length ? JSON.stringify(categoryLabels) : null,
      logo_url:    logo?.url ?? null,
      guide_urls:  guideRefs.length ? JSON.stringify(guideRefs) : null,
      stream_urls: streamUrls.length ? JSON.stringify(streamUrls) : null,
      is_blocked:  blocked.has(ch.id) ? 1 : 0,
    })
  }
  return rows
}

export function replaceAll(rows: IptvChannelRow[]): void {
  const db = getSqlite()
  const insert = db.prepare(`
    INSERT INTO iptv_channels (
      id, name, alt_names, network, owners, country, category_ids, is_nsfw,
      launched, closed, replaced_by, website,
      country_name, country_flag, category_labels,
      logo_url, guide_urls, stream_urls, is_blocked
    ) VALUES (
      @id, @name, @alt_names, @network, @owners, @country, @category_ids, @is_nsfw,
      @launched, @closed, @replaced_by, @website,
      @country_name, @country_flag, @category_labels,
      @logo_url, @guide_urls, @stream_urls, @is_blocked
    )
  `)
  const tx = db.transaction((batch: IptvChannelRow[]) => {
    db.prepare('DELETE FROM iptv_channels').run()
    for (const r of batch) insert.run(r)
  })
  tx(rows)
  setSetting('iptvOrg.lastRefreshedAt', String(Math.floor(Date.now() / 1000)))
}

export function getStatus(): { count: number; lastRefreshedAt: number | null } {
  const db = getSqlite()
  const row = db.prepare('SELECT COUNT(*) AS n FROM iptv_channels').get() as { n: number }
  const last = db.prepare(`SELECT value FROM settings WHERE key = 'iptvOrg.lastRefreshedAt'`).get() as
    | { value: string }
    | undefined
  return {
    count: row?.n ?? 0,
    lastRefreshedAt: last ? Number(last.value) : null,
  }
}

export async function pullAll(onProgress?: (phase: 'fetching' | 'validating' | 'writing' | 'done', extra?: { count?: number }) => void): Promise<{ count: number }> {
  onProgress?.('fetching')
  const payloads = await fetchAll()
  onProgress?.('validating')
  validateAll(payloads)
  onProgress?.('writing')
  const rows = buildRows(payloads)
  replaceAll(rows)
  onProgress?.('done', { count: rows.length })
  return { count: rows.length }
}
