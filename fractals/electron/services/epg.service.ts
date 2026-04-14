import { getSqlite } from '../database/connection'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { URL } from 'node:url'

export interface EpgProgram {
  id: string
  channelExternalId: string
  sourceId: string
  title: string
  description: string | null
  startTime: number // unix seconds
  endTime: number   // unix seconds
  category: string | null
}

export interface NowNext {
  now: EpgProgram | null
  next: EpgProgram | null
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = parsed.protocol === 'https:' ? httpsRequest : httpRequest
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'Fractals/1.0' },
      timeout: 30000,
    }
    const r = req(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    })
    r.on('error', reject)
    r.on('timeout', () => { r.destroy(); reject(new Error('EPG fetch timeout')) })
    r.end()
  })
}

// ── XMLTV parser ──────────────────────────────────────────────────────────────
// Minimal parser — no XML library needed. XMLTV is regular enough for regex.

function parseXmltvDate(s: string): number {
  // Format: "20240101120000 +0000" or "20240101120000 +0100"
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/)
  if (!m) return 0
  const [, yr, mo, dy, hr, mn, sc, tz = '+0000'] = m
  const tzH = parseInt(tz.slice(0, 3), 10)
  const tzM = parseInt(tz[0] + tz.slice(3), 10)
  const utc = Date.UTC(+yr, +mo - 1, +dy, +hr - tzH, +mn - tzM, +sc)
  return Math.floor(utc / 1000)
}

function getAttr(tag: string, attr: string): string {
  const m = tag.match(new RegExp(`${attr}="([^"]*)"`, 'i'))
  return m ? m[1] : ''
}

function getTextContent(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'))
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() : ''
}

interface ParsedProgram {
  channelId: string
  start: number
  end: number
  title: string
  description: string | null
  category: string | null
}

export function parseXmltv(xml: string): { channelIds: Set<string>; programs: ParsedProgram[] } {
  const channelIds = new Set<string>()
  const programs: ParsedProgram[] = []

  // Extract channel ids
  const chanRe = /<channel\s[^>]*id="([^"]+)"[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = chanRe.exec(xml)) !== null) {
    channelIds.add(m[1])
  }

  // Extract programmes — split on <programme to avoid loading full XML into memory at once
  const progRe = /<programme([^>]*)>([\s\S]*?)<\/programme>/gi
  while ((m = progRe.exec(xml)) !== null) {
    const attrs = m[1]
    const body = m[2]
    const channelId = getAttr(attrs, 'channel')
    const start = parseXmltvDate(getAttr(attrs, 'start'))
    const end = parseXmltvDate(getAttr(attrs, 'stop'))
    if (!channelId || !start || !end) continue
    programs.push({
      channelId,
      start,
      end,
      title: getTextContent(body, 'title') || 'Unknown',
      description: getTextContent(body, 'desc') || null,
      category: getTextContent(body, 'category') || null,
    })
  }

  return { channelIds, programs }
}

// ── Sync ──────────────────────────────────────────────────────────────────────

export async function syncEpg(
  sourceId: string,
  serverUrl: string,
  username: string,
  password: string,
  onProgress?: (msg: string) => void
): Promise<{ inserted: number; error?: string }> {
  const sqlite = getSqlite()

  const epgUrl = `${serverUrl.replace(/\/$/, '')}/xmltv.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`

  onProgress?.(`Fetching EPG from ${new URL(epgUrl).hostname}…`)

  let xml: string
  try {
    xml = await fetchUrl(epgUrl)
  } catch (err) {
    return { inserted: 0, error: `EPG fetch failed: ${String(err)}` }
  }

  if (!xml.includes('<programme') && !xml.includes('<channel')) {
    return { inserted: 0, error: 'No EPG data returned by provider' }
  }

  onProgress?.('Parsing EPG…')
  const { programs } = parseXmltv(xml)

  if (programs.length === 0) {
    return { inserted: 0, error: 'EPG parsed but contained no programmes' }
  }

  onProgress?.(`Storing ${programs.length} EPG entries…`)

  // Delete old entries for this source, then bulk insert
  sqlite.prepare(`DELETE FROM epg WHERE source_id = ?`).run(sourceId)

  const insert = sqlite.prepare(`
    INSERT OR REPLACE INTO epg (id, channel_external_id, source_id, title, description, start_time, end_time, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const batch = sqlite.transaction((items: ParsedProgram[]) => {
    for (const p of items) {
      const id = `${sourceId}:${p.channelId}:${p.start}`
      insert.run(id, p.channelId, sourceId, p.title, p.description, p.start, p.end, p.category)
    }
  })

  // Process in batches to avoid blocking
  const BATCH = 1000
  for (let i = 0; i < programs.length; i += BATCH) {
    batch(programs.slice(i, i + BATCH))
  }

  return { inserted: programs.length }
}

// ── Query ─────────────────────────────────────────────────────────────────────

export function getNowNext(contentId: string): NowNext {
  const sqlite = getSqlite()
  const now = Math.floor(Date.now() / 1000)

  // Get the channel's epg_channel_id from the channels table (g1c)
  const channel = sqlite.prepare(
    `SELECT epg_channel_id, source_id FROM channels WHERE id = ?`
  ).get(contentId) as { epg_channel_id: string | null; source_id: string } | undefined

  if (!channel?.epg_channel_id) return { now: null, next: null }

  const { epg_channel_id } = channel
  const primary_source_id = channel.source_id

  const rows = sqlite.prepare(`
    SELECT * FROM epg
    WHERE channel_external_id = ? AND source_id = ? AND end_time > ?
    ORDER BY start_time ASC
    LIMIT 2
  `).all(epg_channel_id, primary_source_id, now - 1) as any[]

  const toProgram = (r: any): EpgProgram => ({
    id: r.id,
    channelExternalId: r.channel_external_id,
    sourceId: r.source_id,
    title: r.title,
    description: r.description,
    startTime: r.start_time,
    endTime: r.end_time,
    category: r.category,
  })

  const nowRow = rows.find((r) => r.start_time <= now && r.end_time > now) ?? null
  const nextRow = rows.find((r) => r.start_time > now) ?? null

  return {
    now: nowRow ? toProgram(nowRow) : null,
    next: nextRow ? toProgram(nextRow) : null,
  }
}
