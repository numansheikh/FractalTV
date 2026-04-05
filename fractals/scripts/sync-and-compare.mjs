#!/usr/bin/env node
/**
 * Standalone sync + compare script.
 * Fetches all 3 sources sequentially, saves JSON dumps, compares 4K vs 4k Strong.
 * Does NOT touch the DB — just fetches and analyzes API responses.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DUMP_DIR = join(homedir(), '.fractals', 'sync-analysis')
mkdirSync(DUMP_DIR, { recursive: true })

const sources = [
  { id: '0ceb0fb7', name: '4K',        server: 'http://cf.business-cdn-8k.su', user: 'fractal473',   pass: '686aa7b8ba' },
  { id: '265de7f3', name: '4k_Strong',  server: 'http://cf.business-cdn-8k.su', user: 'Suleman1947',  pass: '5bade4ed8e' },
  { id: '18510755', name: 'Opplex',     server: 'http://otv.to',               user: 'Danish1981',    pass: '1981danish' },
]

async function fetchJson(url, label) {
  console.log(`  Fetching ${label}...`)
  const start = Date.now()
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(180_000) })
    if (!resp.ok) {
      console.log(`  ❌ ${label}: HTTP ${resp.status}`)
      return null
    }
    const data = await resp.json()
    const count = Array.isArray(data) ? data.length : 'object'
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`  ✓ ${label}: ${count} items (${elapsed}s)`)
    return data
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`  ❌ ${label}: ${err.message} (${elapsed}s)`)
    return null
  }
}

async function fetchSource(src) {
  const base = `${src.server}/player_api.php?username=${encodeURIComponent(src.user)}&password=${encodeURIComponent(src.pass)}`
  const dir = join(DUMP_DIR, src.name)
  mkdirSync(dir, { recursive: true })

  console.log(`\n=== ${src.name} (${src.server}) ===`)

  // Account info
  const info = await fetchJson(`${base}`, `${src.name}/account`)
  if (info) writeFileSync(join(dir, 'account.json'), JSON.stringify(info, null, 2))

  // Categories
  const liveCats = await fetchJson(`${base}&action=get_live_categories`, `${src.name}/live_categories`)
  const vodCats = await fetchJson(`${base}&action=get_vod_categories`, `${src.name}/vod_categories`)
  const seriesCats = await fetchJson(`${base}&action=get_series_categories`, `${src.name}/series_categories`)

  if (liveCats) writeFileSync(join(dir, 'live_categories.json'), JSON.stringify(liveCats, null, 2))
  if (vodCats) writeFileSync(join(dir, 'vod_categories.json'), JSON.stringify(vodCats, null, 2))
  if (seriesCats) writeFileSync(join(dir, 'series_categories.json'), JSON.stringify(seriesCats, null, 2))

  // Content streams
  const liveStreams = await fetchJson(`${base}&action=get_live_streams`, `${src.name}/live_streams`)
  const vodStreams = await fetchJson(`${base}&action=get_vod_streams`, `${src.name}/vod_streams`)
  const series = await fetchJson(`${base}&action=get_series`, `${src.name}/series`)

  if (liveStreams) writeFileSync(join(dir, 'live_streams.json'), JSON.stringify(liveStreams))
  if (vodStreams) writeFileSync(join(dir, 'vod_streams.json'), JSON.stringify(vodStreams))
  if (series) writeFileSync(join(dir, 'series.json'), JSON.stringify(series))

  return {
    name: src.name,
    liveCats: liveCats?.length ?? 0,
    vodCats: vodCats?.length ?? 0,
    seriesCats: seriesCats?.length ?? 0,
    live: liveStreams?.length ?? 0,
    vod: vodStreams?.length ?? 0,
    series: series?.length ?? 0,
    total: (liveStreams?.length ?? 0) + (vodStreams?.length ?? 0) + (series?.length ?? 0),
    // For comparison: sets of IDs
    _liveCatIds: new Set((liveCats ?? []).map(c => c.category_id)),
    _vodCatIds: new Set((vodCats ?? []).map(c => c.category_id)),
    _seriesCatIds: new Set((seriesCats ?? []).map(c => c.category_id)),
    _liveIds: new Set((liveStreams ?? []).map(s => String(s.stream_id))),
    _vodIds: new Set((vodStreams ?? []).map(s => String(s.stream_id))),
    _seriesIds: new Set((series ?? []).map(s => String(s.series_id))),
    _liveCatNames: new Map((liveCats ?? []).map(c => [c.category_id, c.category_name])),
    _vodCatNames: new Map((vodCats ?? []).map(c => [c.category_id, c.category_name])),
    _seriesCatNames: new Map((seriesCats ?? []).map(c => [c.category_id, c.category_name])),
  }
}

function compareSets(label, setA, nameA, setB, nameB, nameMap) {
  const onlyA = [...setA].filter(x => !setB.has(x))
  const onlyB = [...setB].filter(x => !setA.has(x))
  const shared = [...setA].filter(x => setB.has(x))

  console.log(`\n  ${label}:`)
  console.log(`    Shared: ${shared.length}`)
  console.log(`    Only in ${nameA}: ${onlyA.length}`)
  console.log(`    Only in ${nameB}: ${onlyB.length}`)

  if (onlyA.length > 0 && onlyA.length <= 30) {
    console.log(`    ${nameA}-only:`)
    for (const id of onlyA) {
      const name = nameMap?.get(id) ?? id
      console.log(`      - ${name} (${id})`)
    }
  }
  if (onlyB.length > 0 && onlyB.length <= 30) {
    console.log(`    ${nameB}-only:`)
    for (const id of onlyB) {
      const name = nameMap?.get(id) ?? id
      console.log(`      - ${name} (${id})`)
    }
  }

  return { shared: shared.length, onlyA: onlyA.length, onlyB: onlyB.length }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('Starting sequential fetch of all sources...')
console.log(`Dumps will be saved to: ${DUMP_DIR}`)

const results = []
for (const src of sources) {
  results.push(await fetchSource(src))
}

// Summary table
console.log('\n\n========== SUMMARY ==========\n')
console.log('Source       | Live Cats | VOD Cats | Series Cats | Live    | VOD     | Series  | Total')
console.log('-------------|-----------|----------|-------------|---------|---------|---------|--------')
for (const r of results) {
  console.log(
    `${r.name.padEnd(13)}| ${String(r.liveCats).padEnd(10)}| ${String(r.vodCats).padEnd(9)}| ${String(r.seriesCats).padEnd(12)}| ${String(r.live).padEnd(8)}| ${String(r.vod).padEnd(8)}| ${String(r.series).padEnd(8)}| ${r.total}`
  )
}

// Compare 4K vs 4k Strong (same server)
const fourK = results.find(r => r.name === '4K')
const fourKS = results.find(r => r.name === '4k_Strong')

if (fourK && fourKS) {
  console.log('\n\n========== 4K vs 4k Strong COMPARISON ==========')

  // Merge both name maps for display
  const allLiveCatNames = new Map([...fourK._liveCatNames, ...fourKS._liveCatNames])
  const allVodCatNames = new Map([...fourK._vodCatNames, ...fourKS._vodCatNames])
  const allSeriesCatNames = new Map([...fourK._seriesCatNames, ...fourKS._seriesCatNames])

  compareSets('Live categories', fourK._liveCatIds, '4K', fourKS._liveCatIds, '4k Strong', allLiveCatNames)
  compareSets('VOD categories', fourK._vodCatIds, '4K', fourKS._vodCatIds, '4k Strong', allVodCatNames)
  compareSets('Series categories', fourK._seriesCatIds, '4K', fourKS._seriesCatIds, '4k Strong', allSeriesCatNames)
  compareSets('Live streams', fourK._liveIds, '4K', fourKS._liveIds, '4k Strong', null)
  compareSets('VOD streams', fourK._vodIds, '4K', fourKS._vodIds, '4k Strong', null)
  compareSets('Series', fourK._seriesIds, '4K', fourKS._seriesIds, '4k Strong', null)

  console.log(`\n  Content difference: ${fourKS.total - fourK.total} more items in 4k Strong`)
}

// Compare Opplex
const opplex = results.find(r => r.name === 'Opplex')
if (opplex) {
  console.log('\n\n========== OPPLEX ==========')
  console.log(`  Live: ${opplex.live}, VOD: ${opplex.vod}, Series: ${opplex.series}, Total: ${opplex.total}`)
  if (opplex.total === 0) {
    console.log('  ⚠️  Opplex returned 0 items — API may be down or credentials invalid')
  }
}

console.log(`\n\nFull JSON dumps saved to: ${DUMP_DIR}`)
console.log('Done.')
