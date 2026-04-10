/**
 * iptv-org bulk dataset cache — L10 of the V3 data-search plan.
 *
 * Responsible for fetching and persisting the iptv-org bulk JSON datasets
 * (channels, categories, languages, countries, blocklist) to userData, and
 * exposing them to the iptv-org metadata provider.
 *
 * Network policy:
 *   - On first call to any getter, we load whatever is on disk. If there is
 *     no cache at all and the caller needs data, `refresh()` is awaited.
 *   - If data exists but is older than CACHE_TTL_MS, we return it immediately
 *     and kick off a background refresh (`setImmediate`).
 *   - If a refresh fails but a stale cache exists, we log a warning and keep
 *     the stale copy. If no cache exists AND the network fails, the error
 *     propagates — the caller (sync worker / scheduler) decides what to do.
 *
 * Designed for Node 20+ runtime (uses the built-in `fetch` global and
 * `node:fs/promises`). Not usable in the renderer process.
 */

import { app } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile, stat } from 'fs/promises'

const API_BASE = 'https://iptv-org.github.io/api'
const CACHE_DIR_NAME = 'iptv-org-cache'
const LAST_FETCHED_FILE = 'last-fetched.json'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Shape observed from `https://iptv-org.github.io/api/channels.json` on
 * 2026-04-10. Fields documented but absent in the actual response
 * (`languages`, `broadcast_area`, `subdivision`, `city`, `logo`,
 * `wikidata_id`) are typed as optional so the provider can handle future
 * API additions without recompilation.
 */
export interface IptvOrgChannel {
  id: string
  name: string
  alt_names: string[]
  network: string | null
  owners: string[]
  country: string
  categories: string[]
  is_nsfw: boolean
  launched: string | null
  closed: string | null
  replaced_by: string | null
  website: string | null
  // Optional fields — present on some records or future API additions
  subdivision?: string | null
  city?: string | null
  broadcast_area?: string[]
  languages?: string[]
  logo?: string | null
  wikidata_id?: string | null
}

export interface IptvOrgCategory {
  id: string
  name: string
  description?: string
}

export interface IptvOrgLanguage {
  code: string
  name: string
}

export interface IptvOrgCountry {
  code: string
  name: string
  languages?: string[]
  flag?: string
}

export interface IptvOrgBlocklistEntry {
  channel: string
  ref?: string
  reason?: string
}

interface LastFetchedFile {
  iso: string
  epochMs: number
}

interface DatasetDescriptor<T> {
  key: string
  file: string
  url: string
  _cached?: T[]
}

const DATASETS = {
  channels: {
    key: 'channels',
    file: 'channels.json',
    url: `${API_BASE}/channels.json`,
  } as DatasetDescriptor<IptvOrgChannel>,
  categories: {
    key: 'categories',
    file: 'categories.json',
    url: `${API_BASE}/categories.json`,
  } as DatasetDescriptor<IptvOrgCategory>,
  languages: {
    key: 'languages',
    file: 'languages.json',
    url: `${API_BASE}/languages.json`,
  } as DatasetDescriptor<IptvOrgLanguage>,
  countries: {
    key: 'countries',
    file: 'countries.json',
    url: `${API_BASE}/countries.json`,
  } as DatasetDescriptor<IptvOrgCountry>,
  blocklist: {
    key: 'blocklist',
    file: 'blocklist.json',
    url: `${API_BASE}/blocklist.json`,
  } as DatasetDescriptor<IptvOrgBlocklistEntry>,
} as const

export interface IptvOrgCache {
  initCache(): Promise<void>
  getChannels(): Promise<IptvOrgChannel[]>
  getCategories(): Promise<IptvOrgCategory[]>
  getLanguages(): Promise<IptvOrgLanguage[]>
  getCountries(): Promise<IptvOrgCountry[]>
  getBlocklist(): Promise<IptvOrgBlocklistEntry[]>
  refresh(force?: boolean): Promise<void>
  getCacheAge(): number | null
  getCacheDir(): string
}

function getCacheDir(override?: string): string {
  if (override) return join(override, CACHE_DIR_NAME)
  return join(app.getPath('userData'), CACHE_DIR_NAME)
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return null
    throw err
  }
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data), 'utf-8')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`iptv-org fetch failed: ${url} → ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

/**
 * Factory for the iptv-org cache. Returns an object whose methods close over
 * the resolved cache directory and in-memory state. Not a class per project
 * convention (functional style, no classes when avoidable).
 */
export function createIptvOrgCache(userDataPath?: string): IptvOrgCache {
  const dir = getCacheDir(userDataPath)

  // In-memory copies of each dataset, lazy-loaded from disk on first access.
  const mem: {
    channels?: IptvOrgChannel[]
    categories?: IptvOrgCategory[]
    languages?: IptvOrgLanguage[]
    countries?: IptvOrgCountry[]
    blocklist?: IptvOrgBlocklistEntry[]
  } = {}

  // Cached timestamp of the last successful refresh (epoch ms).
  let lastFetchedMs: number | null = null
  let lastFetchedLoaded = false
  let refreshInFlight: Promise<void> | null = null

  async function loadLastFetched(): Promise<void> {
    if (lastFetchedLoaded) return
    const meta = await readJsonFile<LastFetchedFile>(join(dir, LAST_FETCHED_FILE))
    lastFetchedMs = meta?.epochMs ?? null
    lastFetchedLoaded = true
  }

  async function writeLastFetched(epochMs: number): Promise<void> {
    const payload: LastFetchedFile = {
      iso: new Date(epochMs).toISOString(),
      epochMs,
    }
    await writeJsonFile(join(dir, LAST_FETCHED_FILE), payload)
    lastFetchedMs = epochMs
    lastFetchedLoaded = true
  }

  async function initCache(): Promise<void> {
    await ensureDir(dir)
    await loadLastFetched()
  }

  function isStale(): boolean {
    if (lastFetchedMs == null) return true
    return Date.now() - lastFetchedMs > CACHE_TTL_MS
  }

  function scheduleBackgroundRefresh(): void {
    if (refreshInFlight) return
    setImmediate(() => {
      refreshInFlight = refresh(true).catch((err) => {
        console.warn('[iptv-org] background refresh failed:', err)
      }).finally(() => {
        refreshInFlight = null
      }) as Promise<void>
    })
  }

  async function loadDataset<T>(
    descriptor: DatasetDescriptor<T>,
    memKey: keyof typeof mem
  ): Promise<T[]> {
    await initCache()

    // In-memory hit
    const cached = mem[memKey] as T[] | undefined
    if (cached) {
      if (isStale()) scheduleBackgroundRefresh()
      return cached
    }

    // Disk hit
    const path = join(dir, descriptor.file)
    const fromDisk = await readJsonFile<T[]>(path)
    if (fromDisk) {
      ;(mem[memKey] as unknown) = fromDisk
      if (isStale()) scheduleBackgroundRefresh()
      return fromDisk
    }

    // No cache at all — must fetch synchronously (blocks caller).
    // If the network fails here, the error propagates; the plan (L10)
    // specifies the caller decides how to handle.
    await refresh(true)
    const reloaded = await readJsonFile<T[]>(path)
    if (!reloaded) {
      throw new Error(`[iptv-org] dataset '${descriptor.key}' missing after refresh`)
    }
    ;(mem[memKey] as unknown) = reloaded
    return reloaded
  }

  async function refresh(force = false): Promise<void> {
    await initCache()

    if (!force && !isStale()) {
      return
    }

    // Collapse concurrent refresh calls into a single in-flight promise.
    if (refreshInFlight) {
      return refreshInFlight
    }

    const task = (async () => {
      console.log('[iptv-org] refresh: start')
      const started = Date.now()

      // Fetch all datasets in parallel. Tolerate individual failures for
      // optional datasets (blocklist) — critical ones (channels) must succeed.
      const results = await Promise.allSettled([
        fetchJson<IptvOrgChannel[]>(DATASETS.channels.url),
        fetchJson<IptvOrgCategory[]>(DATASETS.categories.url),
        fetchJson<IptvOrgLanguage[]>(DATASETS.languages.url),
        fetchJson<IptvOrgCountry[]>(DATASETS.countries.url),
        fetchJson<IptvOrgBlocklistEntry[]>(DATASETS.blocklist.url),
      ])

      const [channelsRes, categoriesRes, languagesRes, countriesRes, blocklistRes] = results

      // Channels is required. If it fails AND we have no cached copy, throw.
      if (channelsRes.status === 'rejected') {
        const hasCached = await fileExists(join(dir, DATASETS.channels.file))
        if (!hasCached) {
          throw channelsRes.reason
        }
        console.warn('[iptv-org] channels refresh failed, keeping stale cache:', channelsRes.reason)
      } else {
        await writeJsonFile(join(dir, DATASETS.channels.file), channelsRes.value)
        mem.channels = channelsRes.value
      }

      if (categoriesRes.status === 'fulfilled') {
        await writeJsonFile(join(dir, DATASETS.categories.file), categoriesRes.value)
        mem.categories = categoriesRes.value
      } else {
        console.warn('[iptv-org] categories refresh failed:', categoriesRes.reason)
      }

      if (languagesRes.status === 'fulfilled') {
        await writeJsonFile(join(dir, DATASETS.languages.file), languagesRes.value)
        mem.languages = languagesRes.value
      } else {
        console.warn('[iptv-org] languages refresh failed:', languagesRes.reason)
      }

      if (countriesRes.status === 'fulfilled') {
        await writeJsonFile(join(dir, DATASETS.countries.file), countriesRes.value)
        mem.countries = countriesRes.value
      } else {
        console.warn('[iptv-org] countries refresh failed:', countriesRes.reason)
      }

      if (blocklistRes.status === 'fulfilled') {
        await writeJsonFile(join(dir, DATASETS.blocklist.file), blocklistRes.value)
        mem.blocklist = blocklistRes.value
      } else {
        console.warn('[iptv-org] blocklist refresh failed (non-fatal):', blocklistRes.reason)
      }

      // Only update the timestamp if channels (the critical dataset) wrote.
      if (channelsRes.status === 'fulfilled') {
        await writeLastFetched(Date.now())
      }

      console.log(`[iptv-org] refresh: done in ${Date.now() - started}ms`)
    })()

    refreshInFlight = task
    try {
      await task
    } finally {
      refreshInFlight = null
    }
  }

  function getCacheAge(): number | null {
    if (lastFetchedMs == null) return null
    return Date.now() - lastFetchedMs
  }

  return {
    initCache,
    getChannels: () => loadDataset(DATASETS.channels, 'channels'),
    getCategories: () => loadDataset(DATASETS.categories, 'categories'),
    getLanguages: () => loadDataset(DATASETS.languages, 'languages'),
    getCountries: () => loadDataset(DATASETS.countries, 'countries'),
    getBlocklist: () => loadDataset(DATASETS.blocklist, 'blocklist'),
    refresh,
    getCacheAge,
    getCacheDir: () => dir,
  }
}
