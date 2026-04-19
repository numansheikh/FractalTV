import { describe, it, expect } from 'vitest'
import { parseM3u, guessType, extractContainerExt } from '../electron/lib/m3u-parser'

// ─── guessType ────────────────────────────────────────────────────────────────

describe('guessType', () => {
  it('returns series for /series/ path', () => {
    expect(guessType('http://server/series/user/pass/123.mkv')).toBe('series')
  })

  it('returns movie for /movie/ path', () => {
    expect(guessType('http://server/movie/user/pass/456.mp4')).toBe('movie')
  })

  it('returns movie for .mp4 extension', () => {
    expect(guessType('http://cdn.example.com/film.mp4')).toBe('movie')
  })

  it('returns movie for .mkv extension', () => {
    expect(guessType('http://cdn.example.com/film.mkv')).toBe('movie')
  })

  it('returns live for plain stream URL', () => {
    expect(guessType('http://server:8080/live/user/pass/1234')).toBe('live')
  })

  it('/series/ path takes precedence over extension', () => {
    expect(guessType('http://server/series/user/pass/123.mp4')).toBe('series')
  })
})

// ─── extractContainerExt ──────────────────────────────────────────────────────

describe('extractContainerExt', () => {
  it('extracts mp4', () => {
    expect(extractContainerExt('http://cdn.example.com/film.mp4')).toBe('mp4')
  })

  it('extracts mkv', () => {
    expect(extractContainerExt('http://cdn.example.com/film.mkv')).toBe('mkv')
  })

  it('extracts ts', () => {
    expect(extractContainerExt('http://server/stream.ts')).toBe('ts')
  })

  it('extracts extension before query string', () => {
    expect(extractContainerExt('http://cdn.example.com/film.mp4?token=abc')).toBe('mp4')
  })

  it('returns undefined for live stream with no extension', () => {
    expect(extractContainerExt('http://server:8080/live/user/pass/1234')).toBeUndefined()
  })

  it('lowercases the result', () => {
    expect(extractContainerExt('http://cdn.example.com/film.MKV')).toBe('mkv')
  })
})

// ─── parseM3u ─────────────────────────────────────────────────────────────────

const MINIMAL_M3U = `#EXTM3U
#EXTINF:-1 tvg-id="cnn" tvg-name="CNN" group-title="News",CNN
http://example.com/live/user/pass/1
`

const MOVIE_M3U = `#EXTM3U
#EXTINF:7200 group-title="Movies",The Godfather (1972)
http://example.com/movie/user/pass/456.mp4
`

const EPG_HEADER_M3U = `#EXTM3U url-tvg="http://epg.example.com/guide.xml"
#EXTINF:-1 group-title="News",BBC News
http://example.com/live/user/pass/2
`

const EXTVLCOPT_M3U = `#EXTM3U
#EXTINF:-1 group-title="Sports",ESPN
#EXTVLCOPT:http-user-agent=Mozilla/5.0 (compatible)
#EXTVLCOPT:http-referrer=https://example.com/
http://example.com/live/user/pass/3
`

const MULTI_ENTRY_M3U = `#EXTM3U
#EXTINF:-1 group-title="News",CNN
http://example.com/live/user/pass/1
#EXTINF:-1 group-title="Movies",Inception (2010)
http://example.com/movie/user/pass/2.mkv
#EXTINF:-1 tvg-id="s1" group-title="Series",Breaking Bad S01E01
http://example.com/series/user/pass/3.mkv
`

describe('parseM3u — basic parsing', () => {
  it('parses a single live entry', () => {
    const { entries, epgUrl } = parseM3u(MINIMAL_M3U)
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe('CNN')
    expect(entries[0].groupTitle).toBe('News')
    expect(entries[0].tvgId).toBe('cnn')
    expect(entries[0].tvgName).toBe('CNN')
    expect(entries[0].url).toBe('http://example.com/live/user/pass/1')
    expect(entries[0].type).toBe('live')
    expect(entries[0].duration).toBe(-1)
    expect(epgUrl).toBeNull()
  })

  it('parses a movie entry by URL path', () => {
    const { entries } = parseM3u(MOVIE_M3U)
    expect(entries[0].type).toBe('movie')
    expect(entries[0].title).toBe('The Godfather (1972)')
    expect(entries[0].containerExtension).toBe('mp4')
    expect(entries[0].duration).toBe(7200)
  })

  it('parses EPG URL from #EXTM3U header (url-tvg)', () => {
    const { epgUrl } = parseM3u(EPG_HEADER_M3U)
    expect(epgUrl).toBe('http://epg.example.com/guide.xml')
  })

  it('returns null epgUrl when header has none', () => {
    const { epgUrl } = parseM3u(MINIMAL_M3U)
    expect(epgUrl).toBeNull()
  })
})

describe('parseM3u — #EXTVLCOPT headers', () => {
  it('extracts User-Agent from http-user-agent', () => {
    const { entries } = parseM3u(EXTVLCOPT_M3U)
    expect(entries[0].httpHeaders?.['User-Agent']).toBe('Mozilla/5.0 (compatible)')
  })

  it('extracts Referer from http-referrer', () => {
    const { entries } = parseM3u(EXTVLCOPT_M3U)
    expect(entries[0].httpHeaders?.['Referer']).toBe('https://example.com/')
  })
})

describe('parseM3u — type detection', () => {
  it('detects series type from /series/ URL path', () => {
    const { entries } = parseM3u(MULTI_ENTRY_M3U)
    const series = entries.find(e => e.title.includes('Breaking Bad'))
    expect(series?.type).toBe('series')
  })

  it('detects movie type from /movie/ URL path', () => {
    const { entries } = parseM3u(MULTI_ENTRY_M3U)
    const movie = entries.find(e => e.title.includes('Inception'))
    expect(movie?.type).toBe('movie')
  })

  it('treats duration > 0 + no path signal as movie', () => {
    const m3u = `#EXTM3U
#EXTINF:3600 group-title="VoD",Some Film
http://example.com/files/film.mp4
`
    const { entries } = parseM3u(m3u)
    expect(entries[0].type).toBe('movie')
  })
})

describe('parseM3u — multi-entry', () => {
  it('parses all three entries', () => {
    const { entries } = parseM3u(MULTI_ENTRY_M3U)
    expect(entries).toHaveLength(3)
  })

  it('assigns Uncategorized when group-title is missing', () => {
    const m3u = `#EXTM3U
#EXTINF:-1,No Group
http://example.com/stream
`
    const { entries } = parseM3u(m3u)
    expect(entries[0].groupTitle).toBe('Uncategorized')
  })
})

describe('parseM3u — edge cases', () => {
  it('skips unknown # directives without crashing', () => {
    const m3u = `#EXTM3U
#SOME-UNKNOWN-DIRECTIVE
#EXTINF:-1 group-title="News",CNN
http://example.com/live/user/pass/1
`
    const { entries } = parseM3u(m3u)
    expect(entries).toHaveLength(1)
  })

  it('handles CRLF line endings', () => {
    const m3u = '#EXTM3U\r\n#EXTINF:-1 group-title="News",CNN\r\nhttp://example.com/live\r\n'
    const { entries } = parseM3u(m3u)
    expect(entries).toHaveLength(1)
  })

  it('returns empty entries for empty input', () => {
    const { entries, epgUrl } = parseM3u('')
    expect(entries).toHaveLength(0)
    expect(epgUrl).toBeNull()
  })

  it('parses x-tvg-url variant in header', () => {
    const m3u = '#EXTM3U x-tvg-url="http://epg.example.com/guide.xml"\n#EXTINF:-1,CNN\nhttp://example.com\n'
    const { epgUrl } = parseM3u(m3u)
    expect(epgUrl).toBe('http://epg.example.com/guide.xml')
  })
})
