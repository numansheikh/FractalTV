#!/usr/bin/env node
/**
 * Re-sync all 3 sources into the DB from the JSON dumps.
 * Uses sqlite3 CLI since better-sqlite3 is compiled for Electron's Node version.
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'

const DB_PATH = join(homedir(), 'Library', 'Application Support', 'fractals', 'data', 'fractals.db')
const DUMP_DIR = join(homedir(), '.fractals', 'sync-analysis')
const TMP_SQL = join(homedir(), '.fractals', 'sync-analysis', '_import.sql')

function sql(query) {
  return execSync(`sqlite3 "${DB_PATH}" "${query.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' }).trim()
}

function sqlFile(path) {
  return execSync(`sqlite3 "${DB_PATH}" < "${path}"`, { encoding: 'utf-8', maxBuffer: 500 * 1024 * 1024 }).trim()
}

// Map source name to dump directory
const nameToDir = { '4K': '4K', '4k Strong': '4k_Strong', 'Opplex': 'Opplex' }

function loadJson(dir, file) {
  try {
    const data = JSON.parse(readFileSync(join(DUMP_DIR, dir, file), 'utf-8'))
    return Array.isArray(data) ? data : []
  } catch (e) {
    console.log(`  ⚠️ Could not load ${dir}/${file}: ${e.message}`)
    return []
  }
}

function esc(s) {
  if (s == null) return 'NULL'
  return "'" + String(s).replace(/'/g, "''") + "'"
}

function syncSource(sourceId, sourceName) {
  const dir = nameToDir[sourceName]
  if (!dir) { console.log(`  ⚠️ No dump for "${sourceName}"`); return }

  console.log(`\n=== Syncing ${sourceName} ===`)

  const liveCats = loadJson(dir, 'live_categories.json')
  const vodCats = loadJson(dir, 'vod_categories.json')
  const seriesCats = loadJson(dir, 'series_categories.json')
  const liveStreams = loadJson(dir, 'live_streams.json')
  const vodStreams = loadJson(dir, 'vod_streams.json')
  const seriesList = loadJson(dir, 'series.json')

  console.log(`  Categories: live=${liveCats.length}, vod=${vodCats.length}, series=${seriesCats.length}`)
  console.log(`  Content: live=${liveStreams.length}, vod=${vodStreams.length}, series=${seriesList.length}`)

  // Build SQL in batches to avoid command-line length limits
  const BATCH = 500
  let totalStatements = 0

  function writeBatch(statements) {
    writeFileSync(TMP_SQL, 'BEGIN;\n' + statements.join('\n') + '\nCOMMIT;\n')
    sqlFile(TMP_SQL)
    totalStatements += statements.length
  }

  // ── Categories ──────────────────────────────────────────────────────
  let stmts = []
  function addCats(cats, type) {
    for (let i = 0; i < cats.length; i++) {
      const cat = cats[i]
      const id = `${sourceId}:${type}:${cat.category_id}`
      stmts.push(`INSERT OR REPLACE INTO categories (id, source_id, external_id, name, type, position, content_synced) VALUES (${esc(id)}, ${esc(sourceId)}, ${esc(cat.category_id)}, ${esc(cat.category_name)}, ${esc(type)}, ${i}, 1);`)
    }
  }
  addCats(liveCats, 'live')
  addCats(vodCats, 'movie')
  addCats(seriesCats, 'series')
  writeBatch(stmts)
  console.log(`  ✓ ${stmts.length} categories`)

  // ── Live streams ────────────────────────────────────────────────────
  stmts = []
  for (const stream of liveStreams) {
    const contentId = `${sourceId}:live:${stream.stream_id}`
    stmts.push(`INSERT OR REPLACE INTO content (id, primary_source_id, external_id, type, title, category_id, poster_url, catchup_supported, catchup_days, updated_at) VALUES (${esc(contentId)}, ${esc(sourceId)}, ${esc(String(stream.stream_id))}, 'live', ${esc(stream.name)}, ${esc(stream.category_id || null)}, ${esc(stream.stream_icon || null)}, ${stream.tv_archive ? 1 : 0}, ${stream.tv_archive_duration || 0}, unixepoch());`)
    stmts.push(`INSERT OR REPLACE INTO content_sources (id, content_id, source_id, external_id, quality) VALUES (${esc(contentId)}, ${esc(contentId)}, ${esc(sourceId)}, ${esc(String(stream.stream_id))}, 'HD');`)
    stmts.push(`INSERT OR REPLACE INTO content_fts (content_id, title) VALUES (${esc(contentId)}, ${esc(stream.name?.toLowerCase())});`)
    if (stream.category_id) {
      stmts.push(`INSERT OR IGNORE INTO content_categories (content_id, category_id) VALUES (${esc(contentId)}, ${esc(`${sourceId}:live:${stream.category_id}`)});`)
    }
    if (stmts.length >= BATCH * 4) {
      writeBatch(stmts)
      stmts = []
    }
  }
  if (stmts.length) writeBatch(stmts)
  console.log(`  ✓ Live: ${liveStreams.length}`)

  // ── VOD streams ─────────────────────────────────────────────────────
  stmts = []
  for (const stream of vodStreams) {
    const contentId = `${sourceId}:movie:${stream.stream_id}`
    const rating = stream.rating_5based ? stream.rating_5based * 2 : null
    stmts.push(`INSERT OR REPLACE INTO content (id, primary_source_id, external_id, type, title, category_id, poster_url, rating_tmdb, container_extension, updated_at) VALUES (${esc(contentId)}, ${esc(sourceId)}, ${esc(String(stream.stream_id))}, 'movie', ${esc(stream.name)}, ${esc(stream.category_id || null)}, ${esc(stream.stream_icon || null)}, ${rating ?? 'NULL'}, ${esc(stream.container_extension || null)}, unixepoch());`)
    stmts.push(`INSERT OR REPLACE INTO content_sources (id, content_id, source_id, external_id) VALUES (${esc(contentId)}, ${esc(contentId)}, ${esc(sourceId)}, ${esc(String(stream.stream_id))});`)
    stmts.push(`INSERT OR REPLACE INTO content_fts (content_id, title) VALUES (${esc(contentId)}, ${esc(stream.name?.toLowerCase())});`)
    if (stream.category_id) {
      stmts.push(`INSERT OR IGNORE INTO content_categories (content_id, category_id) VALUES (${esc(contentId)}, ${esc(`${sourceId}:movie:${stream.category_id}`)});`)
    }
    if (stmts.length >= BATCH * 4) {
      writeBatch(stmts)
      stmts = []
    }
  }
  if (stmts.length) writeBatch(stmts)
  console.log(`  ✓ VOD: ${vodStreams.length}`)

  // ── Series ──────────────────────────────────────────────────────────
  stmts = []
  for (const s of seriesList) {
    const contentId = `${sourceId}:series:${s.series_id}`
    const rating = s.rating_5based ? s.rating_5based * 2 : null
    stmts.push(`INSERT OR REPLACE INTO content (id, primary_source_id, external_id, type, title, category_id, poster_url, plot, director, cast, rating_tmdb, updated_at) VALUES (${esc(contentId)}, ${esc(sourceId)}, ${esc(String(s.series_id))}, 'series', ${esc(s.name)}, ${esc(s.category_id || null)}, ${esc(s.cover || null)}, ${esc(s.plot || null)}, ${esc(s.director || null)}, ${esc(s.cast || null)}, ${rating ?? 'NULL'}, unixepoch());`)
    stmts.push(`INSERT OR REPLACE INTO content_sources (id, content_id, source_id, external_id) VALUES (${esc(contentId)}, ${esc(contentId)}, ${esc(sourceId)}, ${esc(String(s.series_id))});`)
    // FTS with extra columns
    stmts.push(`INSERT OR REPLACE INTO content_fts (content_id, title, plot, cast, director) VALUES (${esc(contentId)}, ${esc(s.name?.toLowerCase())}, ${esc(s.plot?.toLowerCase() || null)}, ${esc(s.cast?.toLowerCase() || null)}, ${esc(s.director?.toLowerCase() || null)});`)
    if (s.category_id) {
      stmts.push(`INSERT OR IGNORE INTO content_categories (content_id, category_id) VALUES (${esc(contentId)}, ${esc(`${sourceId}:series:${s.category_id}`)});`)
    }
    if (stmts.length >= BATCH * 4) {
      writeBatch(stmts)
      stmts = []
    }
  }
  if (stmts.length) writeBatch(stmts)
  console.log(`  ✓ Series: ${seriesList.length}`)

  // Update source
  const total = liveStreams.length + vodStreams.length + seriesList.length
  sql(`UPDATE sources SET item_count = ${total}, status = 'active', last_error = NULL, last_sync = unixepoch() WHERE id = '${sourceId}'`)
  console.log(`  ✓ Total: ${total} — source updated (${totalStatements} SQL statements)`)
}

// Get sources
const sourcesRaw = sql("SELECT id, name FROM sources ORDER BY name")
const sources = sourcesRaw.split('\n').filter(Boolean).map(line => {
  const [id, name] = line.split('|')
  return { id, name }
})

console.log(`Sources: ${sources.map(s => s.name).join(', ')}`)

for (const source of sources) {
  syncSource(source.id, source.name)
}

// Cleanup
try { unlinkSync(TMP_SQL) } catch {}

// Verify
console.log('\n\n========== VERIFICATION ==========\n')
const verify = sql(`
  SELECT s.name, s.item_count,
    (SELECT COUNT(*) FROM content WHERE primary_source_id = s.id) as actual,
    (SELECT COUNT(*) FROM categories WHERE source_id = s.id) as cats
  FROM sources s ORDER BY s.name
`)
for (const line of verify.split('\n')) {
  const [name, expected, actual, cats] = line.split('|')
  const match = expected === actual ? '✓' : `⚠️ expected ${expected}`
  console.log(`${name}: ${actual} items, ${cats} categories ${match}`)
}

const totals = sql("SELECT (SELECT COUNT(*) FROM content), (SELECT COUNT(*) FROM content_fts), (SELECT COUNT(*) FROM content_categories)")
const [tc, tf, tcc] = totals.split('|')
console.log(`\nTotals: ${tc} content, ${tf} FTS, ${tcc} category links`)
console.log('Done.')
