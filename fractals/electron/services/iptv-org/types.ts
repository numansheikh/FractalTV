// Payload shapes for the 7 iptv-org JSON endpoints we consume.
// Only the fields we read are typed; the upstream objects carry more.

export interface IptvOrgChannel {
  id: string
  name: string
  alt_names?: string[]
  network?: string | null
  owners?: string[]
  country?: string | null
  categories?: string[]
  is_nsfw?: boolean
  launched?: string | null
  closed?: string | null
  replaced_by?: string | null
  website?: string | null
}

export interface IptvOrgCountry {
  code: string
  name: string
  flag?: string
}

export interface IptvOrgCategory {
  id: string
  name: string
}

export interface IptvOrgLogo {
  channel: string
  feed?: string | null
  url: string
  width?: number
  height?: number
}

export interface IptvOrgGuide {
  channel: string | null
  feed?: string | null
  site: string
  site_id: string
  site_name?: string
  lang?: string
}

export interface IptvOrgStream {
  channel: string | null
  feed?: string | null
  url: string
  referrer?: string | null
  user_agent?: string | null
  quality?: string | null
}

export type IptvOrgBlocklistEntry = { channel: string } | string

export interface IptvOrgPayloads {
  channels: IptvOrgChannel[]
  countries: IptvOrgCountry[]
  categories: IptvOrgCategory[]
  logos: IptvOrgLogo[]
  guides: IptvOrgGuide[]
  streams: IptvOrgStream[]
  blocklist: IptvOrgBlocklistEntry[]
}

export interface IptvChannelRow {
  id: string
  name: string
  alt_names: string | null
  network: string | null
  owners: string | null
  country: string | null
  category_ids: string | null
  is_nsfw: number
  launched: string | null
  closed: string | null
  replaced_by: string | null
  website: string | null
  country_name: string | null
  country_flag: string | null
  category_labels: string | null
  logo_url: string | null
  guide_urls: string | null
  stream_urls: string | null
  is_blocked: number
}

export type PullPhase = 'fetching' | 'validating' | 'writing' | 'done' | 'error'

export interface PullProgress {
  phase: PullPhase
  message?: string
  count?: number
  error?: string
}
