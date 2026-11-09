import * as fs from 'fs'
import * as path from 'path'
import { Logger } from './logger'
import { ConfigService } from './config'
import { getUserDataPath } from '../runtime/paths'
import type { AnimeListStatus } from '../ipc/types'

const SOURCE_URL =
  'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json'
const HOUR_MS = 60 * 60 * 1000
/** Fribb publishes a new list once a week. */
export const REFRESH_AFTER_MS = 7 * 24 * HOUR_MS
/** How long a failed download waits before the next automatic attempt. */
export const RETRY_AFTER_MS = 6 * HOUR_MS
const CHECK_EVERY_MS = HOUR_MS
const FIRST_CHECK_MS = 60_000

interface AnimeEntry
{
  anidb_id?: number
  themoviedb_id?: number | string | number[]
  thetvdb_id?: number | string
  imdb_id?: string | string[]
}

let _index: Map<string, AnimeEntry> | null = null
/** When the data in `_index` was fetched: the cache file's mtime, or the download time if it could not be saved. */
let _indexTime = 0
let _loading: Promise<Map<string, AnimeEntry> | null> | null = null
let _refreshing: Promise<AnimeListStatus> | null = null
let _lastError: string | undefined
let _lastFailureAt = 0
let _firstCheck: ReturnType<typeof setTimeout> | null = null
let _timer: ReturnType<typeof setInterval> | null = null

function cacheFile(): string
{
  return path.join(getUserDataPath(), 'anime-list-full.json')
}

function fileTime(): number
{
  try
  {
    return fs.statSync(cacheFile()).mtimeMs
  }
  catch
  {
    return 0
  }
}

function dataTime(): number
{
  return Math.max(fileTime(), _indexTime)
}

function autoUpdate(): boolean
{
  return ConfigService.get().animeListAutoUpdate !== false
}

function errorText(err: unknown): string
{
  return err instanceof Error ? err.message : String(err)
}

function firstNum(v: number | string | number[] | undefined): string | undefined
{
  if (v == null) return undefined
  const candidate = Array.isArray(v) ? v[0] : v
  if (candidate == null) return undefined
  const n = String(candidate).trim()
  return /^\d+$/.test(n) ? n : undefined
}

function indexEntries(entries: AnimeEntry[]): Map<string, AnimeEntry>
{
  const map = new Map<string, AnimeEntry>()
  for (const e of entries)
  {
    if (e.anidb_id != null) map.set(String(e.anidb_id), e)
  }
  return map
}

function readCache(): AnimeEntry[] | null
{
  try
  {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))
    return Array.isArray(parsed) ? parsed as AnimeEntry[] : null
  }
  catch
  {
    return null
  }
}

/**
 * Tells whether the downloaded list is old enough for an automatic update.
 * Only a list that was downloaded before is kept current; the first download
 * happens when a HAMA title first needs it.
 *
 * @param fetchedAt - When the current list was fetched, in epoch ms; 0 when there is none.
 * @param now - Current time in epoch ms.
 * @param enabled - Whether automatic updates are on.
 * @param lastFailureAt - When the last download failed, in epoch ms; 0 when none has.
 * @returns True when an update should start.
 */
export function animeListUpdateDue(fetchedAt: number, now: number, enabled: boolean, lastFailureAt: number): boolean
{
  if (!enabled || fetchedAt <= 0) return false
  if (now - fetchedAt < REFRESH_AFTER_MS) return false
  return now - lastFailureAt >= RETRY_AFTER_MS
}

/**
 * Downloads the list and swaps it in. The file is written beside the cache and
 * renamed over it, so a reader never sees a partial file.
 */
async function download(): Promise<AnimeEntry[]>
{
  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const parsed = await res.json()
  if (!Array.isArray(parsed)) throw new Error('unexpected payload shape')

  const entries = parsed as AnimeEntry[]
  const index = indexEntries(entries)
  if (!index.size) throw new Error('the list has no AniDB entries')

  let saved = false
  try
  {
    const temp = `${cacheFile()}.tmp`
    fs.writeFileSync(temp, JSON.stringify(entries), 'utf8')
    fs.renameSync(temp, cacheFile())
    saved = true
  }
  catch (err)
  {
    Logger.warn('AnimeMap', `Could not save the anime list: ${errorText(err)}`)
  }

  _index = index
  _indexTime = saved ? fileTime() : Date.now()
  Logger.scrape('AnimeMap', `Fetched ${entries.length} anime mappings (${index.size} with AniDB IDs)`)
  return entries
}

function status(): AnimeListStatus
{
  const fetchedAt = dataTime()
  return {
    downloaded: fetchedAt > 0,
    updatedAt: fetchedAt > 0 ? new Date(fetchedAt).toISOString() : undefined,
    titles: _index?.size,
    updating: !!_refreshing,
    error: _lastError,
  }
}

function refresh(): Promise<AnimeListStatus>
{
  if (_refreshing) return _refreshing
  _refreshing = (async () =>
  {
    try
    {
      await download()
      _lastError = undefined
      _lastFailureAt = 0
    }
    catch (err)
    {
      _lastError = errorText(err)
      _lastFailureAt = Date.now()
      Logger.warn('AnimeMap', `Anime list download failed: ${_lastError}`)
    }
    finally
    {
      _refreshing = null
    }
    return status()
  })()
  return _refreshing
}

function updateIfDue(): void
{
  if (_refreshing) return
  if (animeListUpdateDue(dataTime(), Date.now(), autoUpdate(), _lastFailureAt)) void refresh()
}

/**
 * Returns the AniDB index. A newer file on disk, such as one another process
 * on the same config folder saved, replaces the copy in memory.
 */
function load(): Promise<Map<string, AnimeEntry> | null>
{
  if (_index && fileTime() <= _indexTime) return Promise.resolve(_index)
  if (_loading) return _loading

  _loading = (async () =>
  {
    const cached = readCache()
    if (cached)
    {
      _index = indexEntries(cached)
      _indexTime = fileTime()
      updateIfDue()
      return _index
    }
    if (_index) return _index
    await refresh()
    return _index
  })()

  void _loading.finally(() => { _loading = null })
  return _loading
}

/** Maps AniDB IDs from HAMA libraries to TMDB, TVDB, and IMDb through the Fribb anime-lists dataset. */
export const AnimeMappingService = {
  async resolve(
    anidbId: string,
  ): Promise<{ tmdbId?: string; tvdbId?: string; imdbId?: string } | null>
  {
    const index = await load()
    if (!index) return null
    const entry = index.get(anidbId)
    if (!entry) return null

    const out: { tmdbId?: string; tvdbId?: string; imdbId?: string } = {}
    const tmdb = firstNum(entry.themoviedb_id)
    if (tmdb) out.tmdbId = tmdb
    const tvdb = firstNum(entry.thetvdb_id)
    if (tvdb) out.tvdbId = tvdb
    const imdbRaw = Array.isArray(entry.imdb_id) ? entry.imdb_id[0] : entry.imdb_id
    const imdb = typeof imdbRaw === 'string' ? imdbRaw.split(',')[0]?.trim() : undefined
    if (imdb) out.imdbId = imdb
    return out
  },

  /** When the list was fetched, how many titles it maps, and whether an update is running. */
  async status(): Promise<AnimeListStatus>
  {
    if (!_refreshing && fileTime() > 0) await load()
    return status()
  },

  /** Downloads the newest list now, whatever its age, or joins a download already running. */
  async update(): Promise<AnimeListStatus>
  {
    await refresh()
    return AnimeMappingService.status()
  },

  /** Checks hourly, and once shortly after start, whether the downloaded list is due for its weekly update. */
  startAutoUpdate(): void
  {
    if (_timer) return
    _firstCheck = setTimeout(updateIfDue, FIRST_CHECK_MS)
    _timer = setInterval(updateIfDue, CHECK_EVERY_MS)
    _firstCheck.unref?.()
    _timer.unref?.()
  },

  /** Clears in-memory state and timers. Used by tests. */
  reset(): void
  {
    if (_firstCheck) clearTimeout(_firstCheck)
    if (_timer) clearInterval(_timer)
    _firstCheck = null
    _timer = null
    _index = null
    _indexTime = 0
    _loading = null
    _refreshing = null
    _lastError = undefined
    _lastFailureAt = 0
  },
}
