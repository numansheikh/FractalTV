import type {
  WikidataSparqlResponse,
  WikidataSearchResult,
  WikidataEntityDetails,
} from '../types'

const SPARQL = 'https://query.wikidata.org/sparql'
const UA = 'FractalTV/2.0 (vod-enrichment; contact: github.com/numansheikh/FractalTV)'

// Q values that represent film-like types (instance of)
const FILM_TYPES = [
  'wd:Q11424',   // film
  'wd:Q24862',   // short film
  'wd:Q506240',  // television film
  'wd:Q202866',  // animated film
  'wd:Q229390',  // animated short film
].join(' ')

async function sparql(query: string): Promise<WikidataSparqlResponse> {
  const url = `${SPARQL}?format=json&query=${encodeURIComponent(query)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
    })
    if (!res.ok) throw new Error(`Wikidata SPARQL HTTP ${res.status}`)
    return res.json() as Promise<WikidataSparqlResponse>
  } finally {
    clearTimeout(timer)
  }
}

function val(b: Record<string, { value: string } | undefined>, key: string): string | null {
  return b[key]?.value ?? null
}

function splitPipe(s: string | null): string[] {
  if (!s) return []
  return s.split('|').map((x) => x.trim()).filter(Boolean)
}

/**
 * Search Wikidata for films whose English label exactly matches `title`.
 * Returns up to 8 candidates, sorted by year proximity if `year` is given.
 * Does NOT return detailed facts — call `fetchEntityDetails` for those.
 */
export async function searchFilmsByTitle(
  title: string,
  year?: number | null,
): Promise<WikidataSearchResult[]> {
  const esc = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const query = `
    SELECT DISTINCT ?item ?itemLabel ?year ?imdb ?tmdb ?wikiUrl WHERE {
      ?item wdt:P31 ?ft .
      VALUES ?ft { ${FILM_TYPES} }
      ?item rdfs:label ?lbl .
      FILTER(LANG(?lbl) = "en")
      FILTER(LCASE(?lbl) = LCASE("${esc}"))
      OPTIONAL { ?item wdt:P577 ?pd . BIND(YEAR(?pd) AS ?year) }
      OPTIONAL { ?item wdt:P345 ?imdb }
      OPTIONAL { ?item wdt:P4947 ?tmdb }
      OPTIONAL {
        ?wikiUrl schema:about ?item .
        FILTER(STRSTARTS(STR(?wikiUrl), "https://en.wikipedia.org/"))
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
    LIMIT 8
  `
  const json = await sparql(query)
  const results: WikidataSearchResult[] = json.results.bindings.map((b) => ({
    qid: val(b, 'item')?.split('/').pop() ?? '',
    title: val(b, 'itemLabel') ?? '',
    year: b.year?.value ? Number(b.year.value) : null,
    imdb_id: val(b, 'imdb'),
    tmdb_id: val(b, 'tmdb'),
    wiki_url: val(b, 'wikiUrl'),
  })).filter((r) => r.qid.startsWith('Q'))

  // Sort by year proximity
  if (year && results.length > 1) {
    results.sort((a, b) => {
      const aD = a.year != null ? Math.abs(a.year - year) : 9999
      const bD = b.year != null ? Math.abs(b.year - year) : 9999
      return aD - bD
    })
  }
  return results
}

/**
 * Direct lookup by IMDb ID — returns a single search result (fast, unambiguous).
 */
export async function findByImdbId(imdbId: string): Promise<WikidataSearchResult | null> {
  const query = `
    SELECT ?item ?itemLabel ?year ?tmdb ?wikiUrl WHERE {
      ?item wdt:P345 "${imdbId}" .
      OPTIONAL { ?item wdt:P577 ?pd . BIND(YEAR(?pd) AS ?year) }
      OPTIONAL { ?item wdt:P4947 ?tmdb }
      OPTIONAL {
        ?wikiUrl schema:about ?item .
        FILTER(STRSTARTS(STR(?wikiUrl), "https://en.wikipedia.org/"))
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
    LIMIT 1
  `
  const json = await sparql(query)
  const b = json.results.bindings[0]
  if (!b) return null
  const qid = val(b, 'item')?.split('/').pop() ?? ''
  if (!qid.startsWith('Q')) return null
  return {
    qid,
    title: val(b, 'itemLabel') ?? '',
    year: b.year?.value ? Number(b.year.value) : null,
    imdb_id: imdbId,
    tmdb_id: val(b, 'tmdb'),
    wiki_url: val(b, 'wikiUrl'),
  }
}

/**
 * Fetch full structured facts for a known Wikidata QID.
 * One SPARQL call with GROUP_CONCAT — returns labels for all relational fields.
 */
export async function fetchEntityDetails(qid: string): Promise<WikidataEntityDetails> {
  const empty: WikidataEntityDetails = {
    qid, imdb_id: null, tmdb_id: null, year: null, duration_min: null,
    directors: [], writers: [], cast: [], genres: [], countries: [],
    languages: [], production_companies: [], awards: [], image_url: null,
  }

  const query = `
    SELECT
      (MIN(?imdbVal)   AS ?imdb)
      (MIN(?tmdbVal)   AS ?tmdb)
      (MIN(?yearVal)   AS ?year)
      (MIN(?durVal)    AS ?duration)
      (MIN(?imgVal)    AS ?image)
      (GROUP_CONCAT(DISTINCT ?dirLabel;    separator="|") AS ?directors)
      (GROUP_CONCAT(DISTINCT ?writerLabel; separator="|") AS ?writers)
      (GROUP_CONCAT(DISTINCT ?castLabel;   separator="|") AS ?cast)
      (GROUP_CONCAT(DISTINCT ?genreLabel;  separator="|") AS ?genres)
      (GROUP_CONCAT(DISTINCT ?cntryLabel;  separator="|") AS ?countries)
      (GROUP_CONCAT(DISTINCT ?langLabel;   separator="|") AS ?languages)
      (GROUP_CONCAT(DISTINCT ?prodLabel;   separator="|") AS ?companies)
      (GROUP_CONCAT(DISTINCT ?awardLabel;  separator="|") AS ?awards)
    WHERE {
      BIND(wd:${qid} AS ?item)
      OPTIONAL { ?item wdt:P345 ?imdbVal }
      OPTIONAL { ?item wdt:P4947 ?tmdbVal }
      OPTIONAL { ?item wdt:P577 ?pd . BIND(YEAR(?pd) AS ?yearVal) }
      OPTIONAL { ?item wdt:P2047 ?durVal }
      OPTIONAL { ?item wdt:P18   ?imgRaw .
        BIND(IRI(CONCAT("https://commons.wikimedia.org/wiki/Special:FilePath/", ENCODE_FOR_URI(STRAFTER(STR(?imgRaw), "Special:FilePath/")))) AS ?imgVal)
      }
      OPTIONAL { ?item wdt:P57  ?dir    . ?dir    rdfs:label ?dirLabel    . FILTER(LANG(?dirLabel)    = "en") }
      OPTIONAL { ?item wdt:P58  ?writer . ?writer rdfs:label ?writerLabel . FILTER(LANG(?writerLabel) = "en") }
      OPTIONAL { ?item wdt:P161 ?actor  . ?actor  rdfs:label ?castLabel   . FILTER(LANG(?castLabel)   = "en") }
      OPTIONAL { ?item wdt:P136 ?genre  . ?genre  rdfs:label ?genreLabel  . FILTER(LANG(?genreLabel)  = "en") }
      OPTIONAL { ?item wdt:P495 ?cntry  . ?cntry  rdfs:label ?cntryLabel  . FILTER(LANG(?cntryLabel)  = "en") }
      OPTIONAL { ?item wdt:P364 ?lang   . ?lang   rdfs:label ?langLabel   . FILTER(LANG(?langLabel)   = "en") }
      OPTIONAL { ?item wdt:P272 ?prod   . ?prod   rdfs:label ?prodLabel   . FILTER(LANG(?prodLabel)   = "en") }
      OPTIONAL { ?item wdt:P166 ?award  . ?award  rdfs:label ?awardLabel  . FILTER(LANG(?awardLabel)  = "en") }
    }
  `
  try {
    const json = await sparql(query)
    const b = json.results.bindings[0]
    if (!b) return empty

    // Parse image: Wikidata P18 stores filenames. We build the Wikimedia URL.
    // The BIND above may produce an IRI; fall back to constructing it manually.
    let imageUrl: string | null = val(b, 'image')
    if (!imageUrl && b.image?.value) {
      const filename = b.image.value
      if (filename.includes('commons.wikimedia.org')) {
        imageUrl = filename
      } else {
        imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`
      }
    }

    return {
      qid,
      imdb_id: val(b, 'imdb'),
      tmdb_id: val(b, 'tmdb'),
      year: b.year?.value ? Number(b.year.value) : null,
      duration_min: b.duration?.value ? Math.round(Number(b.duration.value)) : null,
      directors: splitPipe(val(b, 'directors')),
      writers: splitPipe(val(b, 'writers')),
      cast: splitPipe(val(b, 'cast')).slice(0, 10),
      genres: splitPipe(val(b, 'genres')),
      countries: splitPipe(val(b, 'countries')),
      languages: splitPipe(val(b, 'languages')),
      production_companies: splitPipe(val(b, 'companies')),
      awards: splitPipe(val(b, 'awards')).slice(0, 5),
      image_url: imageUrl,
    }
  } catch {
    return empty
  }
}
