import fs from 'fs'
import path from 'path'
import pLimit from 'p-limit'
import { ConfigService } from './config'
import { Logger } from './logger'
import { getUserDataPath } from '../runtime/paths'

/** Whether a series is still going (running, renewed, or in production) or finished. */
export type ShowStatus = 'continuing' | 'ended'

/** What the service needs to know about a show to look it up. */
export interface ShowRef
{
  key: string
  title: string
  tmdbId?: string
  tvdbId?: string
  imdbId?: string
  anidbId?: string
}

export interface ResolveOptions
{
  /** Finds a show's TMDB id from its other ids; null when unknown. */
  resolveTmdbId: (show: ShowRef) => Promise<string | null>
  /** Verdict for shows TMDB cannot identify, or when no TMDB key is set. */
  fallback: (key: string) => ShowStatus
}

interface Entry
{
  status: ShowStatus
  checkedAt: number
}

const DAY = 86_400_000
/** A continuing show can end at any time; an ended one rarely comes back. */
const TTL: Record<ShowStatus, number> = { continuing: 7 * DAY, ended: 90 * DAY }
const CONCURRENCY = 6

let cache: Map<string, Entry> | null = null

function cacheFile(): string
{
  return path.join(getUserDataPath(), 'show-status.json')
}

function load(): Map<string, Entry>
{
  if (cache) return cache
  cache = new Map()
  try
  {
    const data = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8')) as { shows?: Record<string, Entry> }
    for (const [key, entry] of Object.entries(data.shows ?? {}))
    {
      if (entry && (entry.status === 'continuing' || entry.status === 'ended')) cache.set(key, entry)
    }
  }
  catch
  {
    // No cache yet.
  }
  return cache
}

function persist(entries: Map<string, Entry>): void
{
  fs.promises.writeFile(cacheFile(), JSON.stringify({ version: 1, shows: Object.fromEntries(entries) }), 'utf-8')
    .catch(err => Logger.warn('ShowStatus', `Could not save the status cache: ${err instanceof Error ? err.message : err}`))
}

/**
 * Maps TMDB's status strings to a verdict. Anything that is not finished
 * (Returning Series, In Production, Planned, Pilot) counts as continuing.
 *
 * @param status - TMDB's `status` field.
 * @returns The verdict.
 */
export function statusFromTmdb(status: string | undefined): ShowStatus
{
  return status === 'Ended' || status === 'Canceled' ? 'ended' : 'continuing'
}

async function lookup(show: ShowRef, apiKey: string, resolveTmdbId: ResolveOptions['resolveTmdbId']): Promise<ShowStatus | null>
{
  try
  {
    const id = await resolveTmdbId(show)
    if (!id) return null
    const res = await fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${apiKey}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const body = await res.json() as { status?: string }
    return statusFromTmdb(body.status)
  }
  catch (err)
  {
    Logger.warn('ShowStatus', `TMDB status lookup failed for "${show.title}": ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/** Tells whether series are still going, from TMDB when a key is set, cached on disk. */
export const ShowStatusService = {
  /**
   * Resolves the status of each show. TMDB verdicts are cached per show and
   * re-checked after their TTL; fallback verdicts are never cached, so adding
   * a TMDB key later upgrades them on the next call.
   *
   * @param shows - Shows to classify.
   * @param opts - Id resolution and the fallback rule.
   * @returns Show key to status.
   */
  async resolve(shows: ShowRef[], opts: ResolveOptions): Promise<Map<string, ShowStatus>>
  {
    const entries = load()
    const apiKey = ConfigService.get().tmdbApiKey?.trim()
    const out = new Map<string, ShowStatus>()
    const pending: ShowRef[] = []
    const now = Date.now()
    for (const show of shows)
    {
      const hit = entries.get(show.key)
      if (hit && now - hit.checkedAt < TTL[hit.status])
      {
        out.set(show.key, hit.status)
        continue
      }
      pending.push(show)
    }

    if (apiKey && pending.length)
    {
      Logger.info('ShowStatus', `Checking TMDB for ${pending.length} show(s)`)
      const limit = pLimit(CONCURRENCY)
      let changed = false
      await Promise.all(pending.map(show => limit(async () =>
      {
        const status = await lookup(show, apiKey, opts.resolveTmdbId)
        if (!status) return
        entries.set(show.key, { status, checkedAt: Date.now() })
        out.set(show.key, status)
        changed = true
      })))
      if (changed) persist(entries)
    }

    for (const show of pending)
    {
      if (!out.has(show.key)) out.set(show.key, opts.fallback(show.key))
    }
    return out
  },

  /** Drops the in-memory cache, for tests. */
  reset(): void
  {
    cache = null
  },

  /** Drops every cached verdict, in memory and on disk, so each show is looked up again. */
  clearDisk(): void
  {
    cache = null
    try { fs.unlinkSync(cacheFile()) } catch { /* no cache file */ }
    Logger.info('ShowStatus', 'Series status cache cleared')
  },
}
