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
 *
 * A full crawl of a large creator takes minutes, so it is checkpointed after
 * every batch of pages. A crawl cut short by quitting the app or by a page that
 * failed to load resumes from its last page instead of starting over.
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
  /** When the current full crawl began, kept across resumes; a finished crawl is as fresh as this. */
  startedAt: number
  /** Last time a caller touched this creator; drives LRU eviction. */
  touchedAt: number
  /** A background incremental refresh is in flight. */
  refreshing: boolean
  /** A full re-read runs beside the cached sets, which stay in use until it finishes. */
  rereading: boolean
  /** Changes whenever `sets` changes, so a caller holding this revision can skip the transfer. */
  rev: number
  /** The crawl or refresh in flight; settles (never rejects) when it finishes. */
  pending: Promise<void> | null
  signal: { aborted: boolean }
}

const store = new Map<string, CrawlState>()
/** Seeded from the clock so a revision held by a client never matches one from an earlier process. */
let revision = Date.now()

function bump(state: CrawlState): void {
  state.rev = ++revision
}

function newState(username: string): CrawlState {
  return {
    username, sets: [], seen: new Set(), status: 'crawling', capped: false, lastPage: 0, fetchedAt: 0,
    startedAt: Date.now(), touchedAt: Date.now(), refreshing: false, rereading: false, rev: ++revision,
    pending: null, signal: { aborted: false },
  }
}
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

interface PersistedCreator {
  username: string
  sets: MediuxUserSet[]
  capped: boolean
  fetchedAt: number
  /** The crawl has not finished; it resumes from `lastPage`. */
  partial?: boolean
  lastPage?: number
  startedAt?: number
}

let loaded = false
let saveTimer: NodeJS.Timeout | null = null
let writing: Promise<void> = Promise.resolve()

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
      // Caches written before sets carried a `source` lack it. Every creator set
      // is a MediUX set, so fill it in rather than bump the version and force a
      // full re-crawl of every creator.
      const sets = (c.sets ?? []).map(s => (s.source ? s : { ...s, source: 'mediux' as const }))
      store.set(k, {
        username: c.username, sets, seen: new Set(sets.map(s => s.id)),
        status: c.partial ? 'crawling' : c.capped ? 'capped' : 'done', capped: !!c.capped,
        lastPage: c.partial ? c.lastPage ?? 0 : 0, fetchedAt: c.partial ? 0 : c.fetchedAt ?? 0,
        startedAt: c.startedAt ?? 0, touchedAt: Date.now(), refreshing: false, rereading: false, rev: ++revision,
        pending: null, signal: { aborted: false },
      })
    }
  } catch { /* no cache yet */ }
}

/** The cache file's contents: finished catalogs, plus unfinished crawls with enough progress to resume. */
function serialize(): string {
  const creators: Record<string, PersistedCreator> = {}
  for (const [k, s] of store) {
    const partial = s.status === 'crawling' || s.status === 'error'
    if (partial && !s.sets.length) continue
    creators[k] = partial
      ? { username: s.username, sets: s.sets, capped: false, fetchedAt: 0, partial: true, lastPage: s.lastPage, startedAt: s.startedAt }
      : { username: s.username, sets: s.sets, capped: s.capped, fetchedAt: s.fetchedAt, startedAt: s.startedAt }
  }
  return JSON.stringify({ version: CREATOR_CACHE_VERSION, creators })
}

/** Debounced write of the cache. Writes go through a temp file, so quitting mid-write never leaves a truncated cache. */
function persist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const json = serialize()
    const file = cacheFile()
    const tmp = `${file}.tmp`
    writing = writing
      .then(() => fs.promises.writeFile(tmp, json, 'utf-8'))
      .then(() => fs.promises.rename(tmp, file))
      .catch(err => Logger.warn('Library', `Failed to persist creator cache: ${err instanceof Error ? err.message : err}`))
  }, 500)
}

function key(username: string): string {
  return username.trim().toLowerCase()
}

/**
 * What a caller sees of a creator right now.
 *
 * @param state - The creator's buffer.
 * @param knownRev - Revision the caller already holds; when current, the sets are left out.
 */
function snapshot(state: CrawlState, knownRev?: number): UserSetsSnapshot {
  const unchanged = knownRev === state.rev
  return {
    username: state.username,
    sets: unchanged ? [] : state.sets,
    status: state.status,
    capped: state.capped,
    collected: state.sets.length,
    error: state.error,
    rev: state.rev,
    fetchedAt: state.fetchedAt,
    ...(unchanged ? { unchanged: true } : {}),
    ...(state.refreshing ? { checking: true } : {}),
    ...(state.rereading ? { rereading: true } : {}),
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

/**
 * Full background crawl of a cold creator, streaming batches as pages land and
 * checkpointing each one. A state with progress resumes from its last page.
 * A quiet crawl (a full re-read running beside the cached sets) streams
 * nothing; its caller swaps the result in when it finishes.
 */
async function runCrawl(state: CrawlState, quiet = false): Promise<void> {
  const resuming = state.lastPage > 0 && state.sets.length > 0
  if (resuming) Logger.info('Library', `Resuming the crawl of "${state.username}" at page ${state.lastPage} with ${state.sets.length} set(s) collected`)
  try {
    await ScraperFactory.browseMediuxUserAll(state.username, {
      signal: state.signal,
      ...(resuming ? { startPage: state.lastPage, seen: new Set(state.seen) } : {}),
      onBatch: async (newSets, info) => {
        if (state.signal.aborted) return
        // Match only this batch, so library matches stream in with the sets
        // instead of waiting for the whole crawl to finish.
        const matched = info.done ? [] : await mapPool(newSets, 8, matchOne)
        if (state.signal.aborted) return
        const added: MediuxUserSet[] = []
        for (const m of matched) {
          if (state.seen.has(m.id)) continue
          state.seen.add(m.id)
          state.sets.push(m)
          added.push(m)
        }
        if (added.length) bump(state)
        state.lastPage = info.page
        if (info.done) {
          state.status = info.capped ? 'capped' : 'done'
          state.capped = info.capped
          state.fetchedAt = state.startedAt || Date.now()
        }
        if (quiet) return
        persist()
        appEvents.emitEvent('library:userSetsChunk', {
          username: state.username, sets: added, collected: state.sets.length,
          page: state.lastPage, done: info.done, capped: state.capped, status: state.status,
          rev: state.rev, fetchedAt: state.fetchedAt,
        })
      },
    })
  } catch (err) {
    if (state.signal.aborted) return
    state.status = 'error'
    state.error = err instanceof Error ? err.message : String(err)
    Logger.error('Library', `Creator crawl failed for "${state.username}": ${state.error}`)
    if (quiet) return
    persist()
    appEvents.emitEvent('library:userSetsChunk', {
      username: state.username, sets: [], collected: state.sets.length,
      page: state.lastPage, done: true, capped: state.capped, status: 'error', error: state.error, rev: state.rev,
    })
  }
}

/**
 * Re-reads a creator's whole catalog beside the cached one, which stays on
 * screen and in use until the new read finishes; then swaps it in with a single
 * `reset` chunk. A failed re-read leaves the cached catalog as it was.
 */
async function runReread(state: CrawlState): Promise<void> {
  state.rereading = true
  const shadow = newState(state.username)
  shadow.signal = state.signal
  try {
    await runCrawl(shadow, true)
    if (state.signal.aborted) return
    if (shadow.status === 'error') {
      Logger.warn('Library', `Re-reading "${state.username}" failed; keeping the cached catalog: ${shadow.error}`)
      appEvents.emitEvent('library:userSetsChunk', {
        username: state.username, sets: [], collected: state.sets.length, page: state.lastPage, done: true,
        capped: state.capped, status: state.status, rev: state.rev, fetchedAt: state.fetchedAt,
        error: `Could not re-read the catalog: ${shadow.error}`,
      })
      return
    }
    state.sets = shadow.sets
    state.seen = shadow.seen
    state.capped = shadow.capped
    state.status = shadow.status
    state.lastPage = 0
    state.error = undefined
    state.fetchedAt = shadow.fetchedAt
    state.startedAt = shadow.startedAt
    bump(state)
    persist()
    Logger.info('Library', `Re-read "${state.username}": ${state.sets.length} set(s)`)
    appEvents.emitEvent('library:userSetsChunk', {
      username: state.username, sets: state.sets, collected: state.sets.length, page: state.lastPage, done: true,
      capped: state.capped, status: state.status, reset: true, rev: state.rev, fetchedAt: state.fetchedAt,
    })
  } finally {
    state.rereading = false
  }
}

/**
 * Cheap background resync of a cached creator: walk the newest pages only,
 * collecting sets not already cached or changed since they were cached, and
 * stop as soon as a page yields nothing new (we've reached known territory).
 * Fresh sets are prepended, and the UI is sent only those sets in one `upsert`
 * chunk rather than the whole catalog again.
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

    let matched: MediuxUserSet[] = []
    if (fresh.length) {
      matched = await mapPool(fresh, 8, matchOne)
      if (signal.aborted) return
      const freshIds = new Set(matched.map(s => s.id))
      state.sets = [...matched, ...state.sets.filter(s => !freshIds.has(s.id))]
      for (const s of matched) state.seen.add(s.id)
      bump(state)
      Logger.scrape('Library', `Creator "${state.username}": ${matched.length} new or updated set(s) on resync`)
    }
    state.fetchedAt = Date.now()
    state.status = state.capped ? 'capped' : 'done'
    persist()
    appEvents.emitEvent('library:userSetsChunk', {
      username: state.username, sets: matched, collected: state.sets.length,
      page: state.lastPage, done: true, capped: state.capped, status: state.status,
      ...(matched.length ? { upsert: true } : {}), rev: state.rev, fetchedAt: state.fetchedAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    Logger.warn('Library', `Creator resync failed for "${state.username}": ${message}`)
    appEvents.emitEvent('library:userSetsChunk', {
      username: state.username, sets: [], collected: state.sets.length,
      page: state.lastPage, done: true, capped: state.capped, status: state.capped ? 'capped' : 'done',
      rev: state.rev, fetchedAt: state.fetchedAt, error: `Could not check for new sets: ${message}`,
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
   * @param knownRev - Revision the caller already holds; an unchanged catalog comes back without its sets.
   */
  start(username: string, maxAgeMs = FRESH_TTL, knownRev?: number): UserSetsSnapshot {
    ensureLoaded()
    const k = key(username)
    const existing = store.get(k)

    if (existing) {
      existing.touchedAt = Date.now()
      if (existing.status === 'crawling' || existing.status === 'error') {
        // An unfinished crawl loaded from disk, or one a failed page stopped,
        // picks up from its checkpoint; a crawl already running is left alone.
        if (!existing.pending) {
          existing.status = 'crawling'
          existing.error = undefined
          existing.signal = { aborted: false }
          track(existing, () => runCrawl(existing))
        }
      } else if (!existing.refreshing && !existing.rereading) {
        const fresh = Date.now() - existing.fetchedAt < maxAgeMs
        if (!fresh) track(existing, () => runIncrementalRefresh(existing))
      }
      return snapshot(existing, knownRev)
    }

    const state = newState(username)
    store.set(k, state)
    evictLru()
    track(state, () => runCrawl(state))
    return snapshot(state, knownRev)
  },

  /**
   * Checks MediUX for sets added or updated since the catalog was cached,
   * whatever its age, keeping the cached sets in use meanwhile. A creator not
   * cached yet starts its first crawl instead.
   *
   * @param username - Creator to check.
   * @param knownRev - Revision the caller already holds.
   */
  check(username: string, knownRev?: number): UserSetsSnapshot {
    ensureLoaded()
    const existing = store.get(key(username))
    if (!existing || existing.status === 'crawling' || existing.status === 'error') return this.start(username, FRESH_TTL, knownRev)
    existing.touchedAt = Date.now()
    if (!existing.refreshing && !existing.rereading) track(existing, () => runIncrementalRefresh(existing))
    return snapshot(existing, knownRev)
  },

  /**
   * Re-reads a creator's whole catalog from the first page, for when the cache
   * looks wrong. The cached sets stay in use until the new read finishes.
   *
   * @param username - Creator to re-read.
   * @param knownRev - Revision the caller already holds.
   */
  reread(username: string, knownRev?: number): UserSetsSnapshot {
    ensureLoaded()
    const existing = store.get(key(username))
    if (!existing || !existing.sets.length) {
      if (existing) { existing.signal.aborted = true; store.delete(key(username)) }
      return this.start(username, FRESH_TTL, knownRev)
    }
    existing.touchedAt = Date.now()
    if (!existing.rereading) {
      existing.signal.aborted = true
      existing.signal = { aborted: false }
      existing.refreshing = false
      track(existing, () => runReread(existing))
    }
    return snapshot(existing, knownRev)
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

  /** Writes a pending cache save at once; called on quit so the latest checkpoint survives. */
  flush(): void {
    if (!saveTimer) return
    clearTimeout(saveTimer)
    saveTimer = null
    const file = cacheFile()
    const tmp = `${file}.flush.tmp`
    try {
      fs.writeFileSync(tmp, serialize(), 'utf-8')
      fs.renameSync(tmp, file)
    } catch (err) {
      Logger.warn('Library', `Failed to persist creator cache: ${err instanceof Error ? err.message : err}`)
    }
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
