import fs from 'fs'
import path from 'path'
import { ScraperFactory } from '../scrapers/scraperFactory'
import { mapPool } from '../scrapers/baseScraper'
import { PlexService } from './plexService'
import { Logger } from './logger'
import { appEvents } from '../runtime/events'
import { getUserDataPath } from '../runtime/paths'
import type { MediuxUserSet, UserSetsSnapshot, CreatorCrawlStatus } from '../ipc/types'

/**
 * Owns each creator's set crawl, decoupled from the renderer, with an on-disk
 * cache that survives app relaunches. The main process crawls MediUX in the
 * background, buffers matched sets per creator, and streams batches to the UI
 * over the shared appEvents bus (`library:userSetsChunk`).
 *
 * On relaunch the buffer is seeded from disk, so opening a previously-viewed
 * creator shows instantly with no loading and no full re-scrape. A stale creator
 * is refreshed incrementally in the background - only the newest pages are
 * fetched, stopping as soon as it reaches sets already cached - so unchanged
 * creators cost at most a page or two, not a full crawl.
 */

interface CrawlState {
  username: string
  sets: MediuxUserSet[]
  seen: Set<string>
  status: CreatorCrawlStatus
  capped: boolean
  lastPage: number
  error?: string
  /** When the crawl/refresh settled; drives the freshness gate. */
  fetchedAt: number
  /** Last time a caller touched this creator; drives LRU eviction. */
  touchedAt: number
  /** A background incremental refresh is in flight. */
  refreshing: boolean
  /** The crawl or refresh in flight; settles (never rejects) when it finishes. */
  pending: Promise<void> | null
  signal: { aborted: boolean }
}

const store = new Map<string, CrawlState>()
/** Opening a creator seen within this window does no network at all. */
const FRESH_TTL = 15 * 60 * 1000
/**
 * Keep only the most-recently-used creators buffered/persisted at once. An
 * evicted creator costs a full crawl next time, so this covers a handful of
 * scheduled creator syncs plus the ones being browsed.
 */
const MAX_CREATORS = 8
/** Safety bound on pages walked during an incremental resync. */
const INCREMENTAL_MAX_PAGES = 25
/**
 * Bumped whenever the fields parsed from a set change meaning, so a catalog
 * cached by an older build is crawled again instead of trusted. Version 1
 * named title-card-only sets after their set name.
 */
export const CREATOR_CACHE_VERSION = 2

const cacheFile = () => path.join(getUserDataPath(), 'creator-sets.json')

interface PersistedCreator { username: string; sets: MediuxUserSet[]; capped: boolean; fetchedAt: number }

let loaded = false
let saveTimer: NodeJS.Timeout | null = null

/** Lazily seed the in-memory store from disk on first use. */
function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8')) as { version?: number; creators?: Record<string, PersistedCreator> }
    if (data.version !== CREATOR_CACHE_VERSION) {
      Logger.info('Library', 'Creator cache is from an older version - catalogs will be crawled again')
      return
    }
    for (const [k, c] of Object.entries(data.creators ?? {})) {
      const sets = c.sets ?? []
      store.set(k, {
        username: c.username, sets, seen: new Set(sets.map(s => s.id)),
        status: c.capped ? 'capped' : 'done', capped: !!c.capped, lastPage: 0,
        fetchedAt: c.fetchedAt ?? 0, touchedAt: Date.now(), refreshing: false, pending: null, signal: { aborted: false },
      })
    }
  } catch { /* no cache yet */ }
}

/** Debounced write of the settled creators to disk. */
function persist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const creators: Record<string, PersistedCreator> = {}
    for (const [k, s] of store) {
      if (s.status === 'crawling') continue   // never persist a partial crawl
      creators[k] = { username: s.username, sets: s.sets, capped: s.capped, fetchedAt: s.fetchedAt }
    }
    fs.promises.writeFile(cacheFile(), JSON.stringify({ version: CREATOR_CACHE_VERSION, creators }), 'utf-8')
      .catch(err => Logger.warn('Library', `Failed to persist creator cache: ${err instanceof Error ? err.message : err}`))
  }, 500)
}

function key(username: string): string {
  return username.trim().toLowerCase()
}

function snapshot(state: CrawlState): UserSetsSnapshot {
  return {
    username: state.username,
    sets: state.sets,
    status: state.status,
    capped: state.capped,
    collected: state.sets.length,
    error: state.error,
  }
}

/** Match one creator set against the Plex library, filling matchedKey/Type. */
async function matchOne(s: MediuxUserSet): Promise<MediuxUserSet> {
  if (!s.title) return s
  const match = await PlexService.findInLibrary({ title: s.title, year: s.year, libraries: [], type: s.mediaType })
  return match ? { ...s, matchedKey: match.key, matchedType: match.type as 'movie' | 'show' } : s
}

/** Abort and drop the least-recently-used creators once over the cap. */
function evictLru(): void {
  if (store.size <= MAX_CREATORS) return
  const ordered = [...store.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)
  for (const [k, state] of ordered) {
    if (store.size <= MAX_CREATORS) break
    state.signal.aborted = true
    store.delete(k)
  }
  persist()
}

/** Full background crawl of a cold creator, streaming batches as pages land. */
async function runCrawl(state: CrawlState): Promise<void> {
  try {
    await ScraperFactory.browseMediuxUserAll(state.username, {
      signal: state.signal,
      onBatch: async (newSets, info) => {
        if (state.signal.aborted) return
        // Match only this batch, so library matches stream in with the sets
        // instead of waiting for the whole crawl to finish.
        const matched = info.done ? [] : await mapPool(newSets, 8, matchOne)
        if (state.signal.aborted) return
        for (const m of matched) {
          if (state.seen.has(m.id)) continue
          state.seen.add(m.id)
          state.sets.push(m)
        }
        state.lastPage = info.page
        if (info.done) {
          state.status = info.capped ? 'capped' : 'done'
          state.capped = info.capped
          state.fetchedAt = Date.now()
          persist()
        }
        appEvents.emitEvent('library:userSetsChunk', {
          username: state.username, sets: matched, collected: state.sets.length,
          page: state.lastPage, done: info.done, capped: state.capped, status: state.status,
        })
      },
    })
  } catch (err) {
    if (state.signal.aborted) return
    state.status = 'error'
    state.error = err instanceof Error ? err.message : String(err)
    state.fetchedAt = Date.now()
    Logger.error('Library', `Creator crawl failed for "${state.username}": ${state.error}`)
    appEvents.emitEvent('library:userSetsChunk', {
      username: state.username, sets: [], collected: state.sets.length,
      page: state.lastPage, done: true, capped: state.capped, status: 'error', error: state.error,
    })
  }
}

/**
 * Cheap background resync of a cached creator: walk the newest pages only,
 * collecting sets not already cached or changed since they were cached, and
 * stop as soon as a page yields nothing new (we've reached known territory).
 * Fresh sets are prepended and the UI is sent a single `reset` chunk with the
 * merged list.
 */
async function runIncrementalRefresh(state: CrawlState): Promise<void> {
  if (state.refreshing) return
  state.refreshing = true
  const signal = state.signal = { aborted: false }
  try {
    const known = new Map(state.sets.map(s => [s.id, s.dateUpdated]))
    const fresh: MediuxUserSet[] = []
    for (let page = 1; page <= INCREMENTAL_MAX_PAGES && !signal.aborted; page++) {
      const pageSets = await ScraperFactory.browseMediuxUser(state.username, page)
      if (!pageSets.length) break   // past the end of the catalog
      let pageHadNew = false
      for (const s of pageSets) {
        // An unknown id is a new set; a changed date_updated means the creator
        // added or replaced files in a set that is already cached.
        if (known.has(s.id) && known.get(s.id) === s.dateUpdated) continue
        known.set(s.id, s.dateUpdated)
        fresh.push(s)
        pageHadNew = true
      }
      if (!pageHadNew) break        // caught up to already-cached sets
      await new Promise(r => setTimeout(r, 250))
    }
    if (signal.aborted) return

    if (fresh.length) {
      const matched = await mapPool(fresh, 8, matchOne)
      if (signal.aborted) return
      const freshIds = new Set(matched.map(s => s.id))
      state.sets = [...matched, ...state.sets.filter(s => !freshIds.has(s.id))]
      for (const s of matched) state.seen.add(s.id)
      Logger.scrape('Library', `Creator "${state.username}": ${matched.length} new or updated set(s) on resync`)
    }
    state.fetchedAt = Date.now()
    state.status = state.capped ? 'capped' : 'done'
    persist()
    appEvents.emitEvent('library:userSetsChunk', {
      username: state.username, sets: state.sets, collected: state.sets.length,
      page: state.lastPage, done: true, capped: state.capped, status: state.status, reset: true,
    })
  } catch (err) {
    // A resync failure is non-fatal: keep the cached data on screen.
    Logger.warn('Library', `Creator resync failed for "${state.username}": ${err instanceof Error ? err.message : err}`)
    appEvents.emitEvent('library:userSetsChunk', {
      username: state.username, sets: state.sets, collected: state.sets.length,
      page: state.lastPage, done: true, capped: state.capped, status: state.capped ? 'capped' : 'done', reset: true,
    })
  } finally {
    state.refreshing = false
  }
}

/** Runs background work for a creator and tracks it so callers can await it. */
function track(state: CrawlState, work: () => Promise<void>): void {
  const p = work()
  state.pending = p
  void p.finally(() => { if (state.pending === p) state.pending = null })
}

export const CreatorSetsService = {
  /**
   * Returns whatever is buffered for a creator right now (instant, from memory or
   * disk) and, when needed, kicks off background work: a full crawl for a cold
   * creator, or a cheap incremental resync for a stale one. Never blocks on the
   * network.
   *
   * @param username - Creator to browse.
   * @param maxAgeMs - A cached catalog older than this is resynced.
   */
  start(username: string, maxAgeMs = FRESH_TTL): UserSetsSnapshot {
    ensureLoaded()
    const k = key(username)
    const existing = store.get(k)

    if (existing && existing.status !== 'error') {
      existing.touchedAt = Date.now()
      if (existing.status !== 'crawling' && !existing.refreshing) {
        const fresh = Date.now() - existing.fetchedAt < maxAgeMs
        if (!fresh) track(existing, () => runIncrementalRefresh(existing))
      }
      return snapshot(existing)
    }
    if (existing) { existing.signal.aborted = true; store.delete(k) }

    const state: CrawlState = {
      username, sets: [], seen: new Set(), status: 'crawling', capped: false,
      lastPage: 0, fetchedAt: 0, touchedAt: Date.now(), refreshing: false, pending: null, signal: { aborted: false },
    }
    store.set(k, state)
    evictLru()
    track(state, () => runCrawl(state))
    return snapshot(state)
  },

  /**
   * Returns a creator's whole catalog, waiting for the crawl or resync that
   * {@link start} kicks off to finish. Used by scheduled creator syncs, which
   * need every set rather than whatever happens to be buffered.
   *
   * @param username - Creator to read.
   * @param maxAgeMs - A cached catalog older than this is resynced first.
   * @returns Every cached set and whether the page cap cut the crawl short.
   * @throws Error when the catalog could not be read.
   */
  async catalog(username: string, maxAgeMs = FRESH_TTL): Promise<{ sets: MediuxUserSet[]; capped: boolean }> {
    this.start(username, maxAgeMs)
    const state = store.get(key(username))
    if (!state) throw new Error(`Could not read @${username}'s sets`)
    if (state.pending) await state.pending
    if (state.status === 'error') throw new Error(state.error ?? `Could not read @${username}'s sets`)
    state.touchedAt = Date.now()
    return { sets: state.sets, capped: state.capped }
  },

  /** Aborts any running work for a creator and starts a fresh full crawl. */
  refresh(username: string): UserSetsSnapshot {
    ensureLoaded()
    const k = key(username)
    const existing = store.get(k)
    if (existing) { existing.signal.aborted = true; store.delete(k) }
    return this.start(username)
  },

  /** Aborts and clears every buffered crawl (e.g. on shutdown); the next use re-reads the disk cache. */
  clear(): void {
    for (const state of store.values()) state.signal.aborted = true
    store.clear()
    loaded = false
  },

  /** Drops every cached catalog, in memory and on disk, so each creator is crawled again on next use. */
  clearDisk(): void {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    this.clear()
    try { fs.unlinkSync(cacheFile()) } catch { /* no cache file */ }
    Logger.info('Library', 'Creator catalog cache cleared')
  },
}
