import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { Logger } from './logger'

/**
 * Maps HAMA's AniDB ids to TMDB/TVDB/IMDb ids using the community-maintained
 * Fribb/anime-lists dataset. HAMA tags most anime with an AniDB id, which TMDB's
 * /find endpoint can't resolve - this mapping bridges that gap (and yields a
 * direct TMDB id for most entries, so no TMDB key is needed for those).
 */

const SOURCE_URL =
  'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json'
// The list changes rarely; refresh weekly, falling back to a stale copy on error.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface AnimeEntry {
  anidb_id?: number
  themoviedb_id?: number | string | number[]
  thetvdb_id?: number | string
  imdb_id?: string | string[]
}

let _index: Map<string, AnimeEntry> | null = null
let _loading: Promise<Map<string, AnimeEntry> | null> | null = null

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'anime-list-full.json')
}

/** Picks the first usable numeric id from a number | numeric-string | array. */
function firstNum(v: number | string | number[] | undefined): string | undefined {
  if (v == null) return undefined
  const candidate = Array.isArray(v) ? v[0] : v
  if (candidate == null) return undefined
  const n = String(candidate).trim()
  return /^\d+$/.test(n) ? n : undefined
}

/** Builds the anidb_id -> entry lookup from the raw JSON array. */
function indexEntries(entries: AnimeEntry[]): Map<string, AnimeEntry> {
  const map = new Map<string, AnimeEntry>()
  for (const e of entries) {
    if (e.anidb_id != null) map.set(String(e.anidb_id), e)
  }
  return map
}

/** Reads the cached list from disk, or null if missing/unparseable. */
function readCache(): AnimeEntry[] | null {
  try {
    const raw = fs.readFileSync(cacheFile(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as AnimeEntry[] : null
  } catch {
    return null
  }
}

function cacheAgeMs(): number {
  try {
    return Date.now() - fs.statSync(cacheFile()).mtimeMs
  } catch {
    return Infinity
  }
}

/** Downloads the list and writes it to the cache. */
async function fetchList(): Promise<AnimeEntry[] | null> {
  try {
    const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const parsed = await res.json()
    if (!Array.isArray(parsed)) throw new Error('unexpected payload shape')
    try {
      fs.writeFileSync(cacheFile(), JSON.stringify(parsed), 'utf8')
    } catch (err) {
      Logger.warn('AnimeMap', `Could not cache list: ${err instanceof Error ? err.message : err}`)
    }
    Logger.scrape('AnimeMap', `Fetched ${parsed.length} anime mappings`)
    return parsed as AnimeEntry[]
  } catch (err) {
    Logger.warn('AnimeMap', `Fetch failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/** Loads the index once, preferring a fresh cache and refreshing when stale. */
function load(): Promise<Map<string, AnimeEntry> | null> {
  if (_index) return Promise.resolve(_index)
  if (_loading) return _loading

  _loading = (async () => {
    const cached = readCache()
    if (cached && cacheAgeMs() < MAX_AGE_MS) {
      _index = indexEntries(cached)
      return _index
    }

    const fetched = await fetchList()
    // Fall back to a stale cache when the fetch fails, rather than nothing.
    const entries = fetched ?? cached
    _index = entries ? indexEntries(entries) : null
    return _index
  })()

  // Clear the in-flight promise once settled so a failed load can be retried.
  _loading.finally(() => { _loading = null })
  return _loading
}

export const AnimeMappingService = {
  /**
   * Resolves a HAMA AniDB id to whichever external ids the dataset has for it.
   *
   * @param anidbId - The AniDB id from a HAMA guid (e.g. "47").
   * @returns Mapped tmdb/tvdb/imdb ids, or null when unknown.
   */
  async resolve(
    anidbId: string,
  ): Promise<{ tmdbId?: string; tvdbId?: string; imdbId?: string } | null> {
    const index = await load()
    if (!index) return null
    const entry = index.get(anidbId)
    if (!entry) return null

    const out: { tmdbId?: string; tvdbId?: string; imdbId?: string } = {}
    const tmdb = firstNum(entry.themoviedb_id)
    if (tmdb) out.tmdbId = tmdb
    const tvdb = firstNum(entry.thetvdb_id)
    if (tvdb) out.tvdbId = tvdb
    // imdb_id may be a string ("tt123" or "tt123,tt456"), an array, or absent.
    const imdbRaw = Array.isArray(entry.imdb_id) ? entry.imdb_id[0] : entry.imdb_id
    const imdb = typeof imdbRaw === 'string' ? imdbRaw.split(',')[0]?.trim() : undefined
    if (imdb) out.imdbId = imdb
    return out
  },
}
