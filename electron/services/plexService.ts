import Fuse from 'fuse.js'
import { Logger } from './logger'
import { ConfigService } from './config'
import { AnimeMappingService } from './animeMappingService'
import type {
  ConnectReq, ConnectRes, Library,
  FindItemReq, PlexItem, UploadReq, UploadRes,
  FindCollectionReq, PlexCollection,
  LabelReq, ResetReq,
  LibrarySection, SectionItemsReq, SectionItemsRes, LibraryItem,
} from '../ipc/types'

interface PlexConnection {
  baseUrl: string
  token: string
  serverName: string
  libraries: Library[]
}

let _conn: PlexConnection | null = null

/**
 * Builds the standard X-Plex-* headers for Plex Media Server requests.
 *
 * @param token - Plex auth token.
 * @returns Header map to spread into fetch options.
 */
function plexHeaders(token: string): Record<string, string> {
  return {
    'X-Plex-Token': token,
    'X-Plex-Client-Identifier': ConfigService.get().clientIdentifier,
    'X-Plex-Product': 'Plex Poster Set Helper 2',
    'Accept': 'application/json',
  }
}

/**
 * Fetches a Plex API path, throwing on non-2xx responses.
 *
 * @param baseUrl - Server base URL.
 * @param token - Plex auth token.
 * @param path - API path beginning with a slash.
 * @param options - Extra fetch options merged over the defaults.
 * @returns Parsed JSON when possible, otherwise the raw text or an empty object.
 */
async function plexFetch(
  baseUrl: string,
  token: string,
  path: string,
  options?: RequestInit,
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      ...plexHeaders(token),
      ...(options?.headers as Record<string, string> ?? {}),
    },
  })
  if (!res.ok) throw new Error(`Plex ${res.status} ${res.statusText} - ${path}`)
  const text = await res.text()
  if (!text.trim()) return {}
  try { return JSON.parse(text) } catch { return text }
}

/**
 * Extracts external IDs (tmdb/tvdb/imdb) from a Plex item's guids. Handles both
 * the modern Guid[] array (plex agent) and legacy single-guid strings such as
 * com.plexapp.agents.themoviedb://1234 or com.plexapp.agents.hama://tvdb-458912.
 *
 * @param m - Raw Plex metadata node.
 * @returns Whichever of tmdbId / tvdbId / imdbId could be parsed.
 */
function extractGuids(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  m: any,
): { tmdbId?: string; tvdbId?: string; imdbId?: string; anidbId?: string } {
  const out: { tmdbId?: string; tvdbId?: string; imdbId?: string; anidbId?: string } = {}

  const assign = (raw: string) => {
    const s = raw.toLowerCase()
    let mm: RegExpMatchArray | null
    if ((mm = s.match(/tmdb:\/\/(\d+)/)) || (mm = s.match(/themoviedb:\/\/(\d+)/))) out.tmdbId ??= mm[1]
    if ((mm = s.match(/tvdb[:-](\d+)/)) || (mm = s.match(/thetvdb:\/\/(\d+)/)))    out.tvdbId ??= mm[1]
    if ((mm = s.match(/imdb:\/\/(tt\d+)/)) || (mm = s.match(/imdb-(tt\d+)/)))       out.imdbId ??= mm[1]
    // HAMA's primary id for most anime (e.g. com.plexapp.agents.hama://anidb-47).
    if ((mm = s.match(/anidb[:-](\d+)/)))                                           out.anidbId ??= mm[1]
  }

  if (typeof m.guid === 'string') assign(m.guid)
  for (const g of (m.Guid ?? []) as Array<{ id?: string }>) if (g.id) assign(g.id)

  return out
}

/**
 * Maps raw Plex metadata into a PlexItem.
 *
 * @param m - Raw Plex metadata node.
 * @param libraryTitle - Title of the owning library.
 * @param libraryType - Library type, which decides the item type.
 * @returns The normalised item.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMetadata(m: any, libraryTitle: string, libraryType: 'movie' | 'show'): PlexItem {
  return {
    key: m.ratingKey as string,
    title: m.title as string,
    year: m.year as number | undefined,
    type: libraryType === 'movie' ? 'movie' : 'show',
    libraryTitle,
    thumb: m.thumb as string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    labels: ((m.Label ?? []) as any[]).map(l => l.tag as string),
    ...extractGuids(m),
  }
}

/**
 * Normalises a title for tolerant comparison: lowercased, diacritics stripped,
 * and all punctuation collapsed to single spaces. Lets "The Librarian: ..." and
 * "The Librarian - ..." compare equal regardless of how Plex stored the title.
 *
 * @param s - Raw title.
 * @returns The normalised form.
 */
function normTitle(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Reduces a title to a broader query for a second-pass library lookup: the part
 * before a subtitle separator (colon, then a spaced dash), or the first few
 * words. Recovers franchise entries Plex's relevance search drops for the full
 * title (e.g. "The Librarian: The Curse of the Judas Chalice").
 *
 * @param title - Full title.
 * @returns A shorter query, or null when no useful reduction exists.
 */
function broadenTitle(title: string): string | null {
  const t = title.trim()
  const colon = t.indexOf(':')
  if (colon > 1) return t.slice(0, colon).trim()
  const dash = t.indexOf(' - ')
  if (dash > 1) return t.slice(0, dash).trim()
  const words = t.split(/\s+/)
  if (words.length > 3) return words.slice(0, 3).join(' ')
  return null
}

/**
 * Deletes an item's currently-selected image when it's a user upload, freeing the
 * bundle data Plex stored for it. Plex only supports deleting the active thumb/art
 * (DELETE /thumb or /art), so this must run while the uploaded image is still the
 * selected one - i.e. before any original poster is re-selected.
 *
 * @param baseUrl - Server base URL.
 * @param token - Plex auth token.
 * @param itemKey - Item ratingKey.
 * @param kind - 'poster' (thumb) or 'art' (background).
 * @returns true when an uploaded image was deleted.
 */
async function deleteUploadedImage(
  baseUrl: string,
  token: string,
  itemKey: string,
  kind: 'poster' | 'art',
): Promise<boolean> {
  const listPath = kind === 'art' ? 'arts' : 'posters'
  const delPath  = kind === 'art' ? 'art'  : 'thumb'
  try {
    const data = await plexFetch(baseUrl, token, `/library/metadata/${itemKey}/${listPath}`) as {
      MediaContainer?: { Metadata?: Array<{ ratingKey?: string; provider?: string; selected?: boolean }> }
    }
    const selected = (data?.MediaContainer?.Metadata ?? []).find(p => p.selected)
    // Only delete our own uploads: Plex tags those with an upload:// ratingKey
    // (or a 'custom' provider). Never delete an agent-selected poster.
    const isUpload = !!selected && (
      (selected.ratingKey ?? '').startsWith('upload://') || selected.provider === 'custom'
    )
    if (!isUpload) return false

    await plexFetch(baseUrl, token, `/library/metadata/${itemKey}/${delPath}`, { method: 'DELETE' })
    return true
  } catch (err) {
    Logger.warn('Plex', `Delete uploaded ${kind} failed - key ${itemKey}: ${err instanceof Error ? err.message : err}`)
    return false
  }
}

/**
 * Polls Plex's /activities feed for a background task matching `match`, resolving
 * once it has appeared and then cleared. Lets callers track real task completion
 * instead of guessing with a fixed timer. Tolerant of tasks that finish too fast
 * to ever surface (resolves after a short grace window) and bounded by a hard cap
 * so it can never hang.
 *
 * @param baseUrl - Server base URL.
 * @param token - Plex auth token.
 * @param match - Tested against each activity's "type title subtitle".
 * @param opts - Poll interval, grace window before assuming a no-show finished, and max wait (ms).
 */
async function waitForActivity(
  baseUrl: string,
  token: string,
  match: RegExp,
  { pollMs = 1000, graceMs = 4000, maxMs = 180_000 }: { pollMs?: number; graceMs?: number; maxMs?: number } = {},
): Promise<void> {
  const start = Date.now()
  let seen = false
  for (;;) {
    let active = false
    try {
      const data = await plexFetch(baseUrl, token, '/activities') as {
        MediaContainer?: { Activity?: Array<{ type?: string; title?: string; subtitle?: string }> }
      }
      active = (data?.MediaContainer?.Activity ?? []).some(a =>
        match.test(`${a.type ?? ''} ${a.title ?? ''} ${a.subtitle ?? ''}`))
    } catch {
      // /activities unavailable on this server - fall back to the grace window
    }
    const elapsed = Date.now() - start
    if (active) seen = true
    else if (seen) return            // it ran and has now cleared
    else if (elapsed >= graceMs) return  // never surfaced - assume it finished quickly
    if (elapsed >= maxMs) return         // safety cap
    await new Promise(r => setTimeout(r, pollMs))
  }
}

/** Talks to the connected Plex Media Server: lookups, poster upload/reset, and stats. */
export const PlexService = {
  /**
   * Returns the active connection.
   *
   * @returns Connection details, or null when not connected.
   */
  getConnection: () => _conn,

  /**
   * Connects to a Plex server, caching its name and library list on success.
   *
   * @param req - Server base URL and token.
   * @returns Success flag with server name and library count, or an error message.
   */
  async connect(req: ConnectReq): Promise<ConnectRes> {
    try {
      const data = await plexFetch(req.baseUrl, req.token, '/') as { MediaContainer?: { friendlyName?: string } }
      const serverName = data?.MediaContainer?.friendlyName ?? 'Plex Server'
      const libraries = await PlexService.fetchLibraries(req.baseUrl, req.token)
      _conn = { baseUrl: req.baseUrl, token: req.token, serverName, libraries }
      Logger.success('Plex', `Connected to "${serverName}" - ${libraries.length} libraries`)
      return { success: true, serverName, libraryCount: libraries.length }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      Logger.error('Plex', `Connection failed: ${error}`)
      _conn = null
      return { success: false, error }
    }
  },

  /**
   * Fetches the server's movie and show libraries.
   *
   * @param baseUrl - Server base URL.
   * @param token - Plex auth token.
   * @returns The filtered library list.
   */
  async fetchLibraries(baseUrl: string, token: string): Promise<Library[]> {
    const data = await plexFetch(baseUrl, token, '/library/sections') as {
      MediaContainer?: { Directory?: Array<{ key: string; title: string; type: string; agent?: string }> }
    }
    return (data?.MediaContainer?.Directory ?? [])
      .filter(d => d.type === 'movie' || d.type === 'show')
      .map(d => ({ key: d.key, title: d.title, type: d.type as 'movie' | 'show', agent: d.agent }))
  },

  /**
   * Returns the item count for a library section without fetching its items.
   *
   * @param key - Section key.
   * @param type - Section media type.
   * @returns The total item count, or 0 when not connected.
   */
  async getLibraryCount(key: string, type: 'movie' | 'show'): Promise<number> {
    if (!_conn) return 0
    const { baseUrl, token } = _conn
    const plexType = type === 'movie' ? 1 : 2
    const data = await plexFetch(
      baseUrl, token,
      `/library/sections/${key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0&type=${plexType}`,
    ) as { MediaContainer?: { totalSize?: number; size?: number } }
    return data?.MediaContainer?.totalSize ?? data?.MediaContainer?.size ?? 0
  },

  /**
   * Finds a library item by title (and optional year), preferring exact
   * matches and falling back to a fuzzy search.
   *
   * @param req - Title, optional year, library include-list, and media type.
   * @returns The best match, or null when nothing qualifies.
   */
  async findInLibrary(req: FindItemReq): Promise<PlexItem | null> {
    if (!_conn) return null
    const { baseUrl, token, libraries: allLibs } = _conn
    const { title, year, libraries: filterNames, type: mediaType, tmdbId } = req

    const excluded = ConfigService.get().excludedLibraries ?? []

    // Libraries eligible for this lookup: an explicit include-list wins, else
    // exclusions apply, and the requested media type is honoured so a TV show set
    // never matches a same-named movie ("Sugar" 2024 show vs "Sugar" 2008 movie).
    const searchLibs = allLibs.filter(lib => {
      if (filterNames.length && !filterNames.includes(lib.title)) return false
      if (!filterNames.length && excluded.includes(lib.title)) return false
      if (mediaType && lib.type !== mediaType) return false
      return true
    })

    // Runs Plex's relevance search for one query across every eligible library.
    const gather = async (query: string): Promise<PlexItem[]> => {
      const found: PlexItem[] = []
      for (const lib of searchLibs) {
        const type = lib.type === 'movie' ? 1 : 2
        try {
          const data = await plexFetch(
            baseUrl, token,
            `/library/sections/${lib.key}/search?query=${encodeURIComponent(query)}&type=${type}&limit=20&includeGuids=1`,
          ) as { MediaContainer?: { Metadata?: unknown[] } }
          for (const m of data?.MediaContainer?.Metadata ?? []) {
            found.push(mapMetadata(m, lib.title, lib.type as 'movie' | 'show'))
          }
        } catch {
          // section may not support the search type - skip silently
        }
      }
      return found
    }

    const candidates = await gather(title)

    // TMDB id is exact and survives Plex renames (e.g. "The Librarian III" vs
    // TMDB's "The Librarian: ..."), so prefer it when the candidates include the
    // right item under a different name.
    if (tmdbId) {
      const byTmdb = candidates.find(c => c.tmdbId === tmdbId)
      if (byTmdb) return byTmdb
    }

    const wanted = normTitle(title)
    const exact = candidates.find(i => normTitle(i.title) === wanted && (!year || i.year === year))
    if (exact) return exact

    if (!year) {
      const exactTitle = candidates.find(i => normTitle(i.title) === wanted)
      if (exactTitle) return exactTitle
    }

    // Fuzzy fallback: when a year is provided, only consider candidates within ±1
    // year so that e.g. "Toy Story (1995)" never fuzzy-matches "Toy Story 2 (1999)".
    const fuzzyMatch = (pool: PlexItem[]): PlexItem | null => {
      const scoped = year ? pool.filter(c => c.year != null && Math.abs(c.year - year) <= 1) : pool
      if (!scoped.length) return null
      const fuse = new Fuse(scoped, { keys: ['title'], threshold: 0.35 })
      return fuse.search(title)[0]?.item ?? null
    }
    const fuzzy = fuzzyMatch(candidates)
    if (fuzzy) return fuzzy

    // Last resort when the TMDB id is known: Plex's relevance search can drop a
    // long, subtitled franchise entry ("The Librarian: The Curse of the Judas
    // Chalice") even though it's in the library, so the candidate never appears
    // to match against. Re-search with just the main title to pull it into the
    // pool, then match strictly by id.
    if (tmdbId) {
      const broad = broadenTitle(title)
      if (broad && normTitle(broad) !== wanted) {
        const byTmdb = (await gather(broad)).find(c => c.tmdbId === tmdbId)
        if (byTmdb) return byTmdb
      }
    }

    return null
  },

  /**
   * Finds a Plex Collection by name (for boxset collection art). MediUX boxsets
   * include "collection sets" (e.g. "Toy Story Collection") whose posters apply
   * to a Plex Collection object, not an individual movie. Plex auto-names these
   * collections after the TMDB collection, so matching is done by title.
   *
   * @param req - The collection name to match.
   * @returns The matched collection, or null.
   */
  async findCollection(req: FindCollectionReq): Promise<PlexCollection | null> {
    if (!_conn) return null
    const { baseUrl, token, libraries: allLibs } = _conn
    const title = req.title.trim()
    if (!title) return null

    // Some users rename Plex collections without the trailing "Collection" word
    // (e.g. "Toy Story" instead of "Toy Story Collection")
    const altTitle = title.replace(/\s+Collection$/i, '').trim()

    const candidates: PlexCollection[] = []
    for (const lib of allLibs) {
      if (lib.type !== 'movie' && lib.type !== 'show') continue
      try {
        const data = await plexFetch(
          baseUrl, token,
          `/library/sections/${lib.key}/collections`,
        ) as { MediaContainer?: { Metadata?: Array<{ ratingKey?: string; title?: string; childCount?: number; thumb?: string }> } }
        for (const c of data?.MediaContainer?.Metadata ?? []) {
          if (!c.ratingKey || !c.title) continue
          candidates.push({
            key: c.ratingKey,
            title: c.title,
            libraryTitle: lib.title,
            childCount: c.childCount,
            thumb: c.thumb,
          })
        }
      } catch {
        // section may not support collections - skip silently
      }
    }
    if (!candidates.length) return null

    const lc = title.toLowerCase()
    const lcAlt = altTitle.toLowerCase()
    const exact = candidates.find(c => c.title.toLowerCase() === lc)
      ?? candidates.find(c => c.title.toLowerCase() === lcAlt)
    if (exact) return exact

    const fuse = new Fuse(candidates, { keys: ['title'], threshold: 0.3 })
    return fuse.search(title)[0]?.item ?? null
  },

  /**
   * Returns browsable movie/show sections, honouring the excluded-libraries
   * setting.
   *
   * @returns Sections available to the library browser.
   */
  async getSections(): Promise<LibrarySection[]> {
    if (!_conn) return []
    const excluded = ConfigService.get().excludedLibraries ?? []
    return _conn.libraries
      .filter(l => (l.type === 'movie' || l.type === 'show') && !excluded.includes(l.title))
      .map(l => ({ key: l.key, title: l.title, type: l.type as 'movie' | 'show' }))
  },

  /**
   * Returns a page of section items with external IDs and thumb URLs.
   *
   * @param req - Section key, offset/limit, and optional title filter.
   * @returns The page of items plus the section's total count.
   */
  async getSectionItems(req: SectionItemsReq): Promise<SectionItemsRes> {
    if (!_conn) return { items: [], total: 0 }
    const { baseUrl, token, libraries } = _conn
    const lib = libraries.find(l => l.key === req.sectionKey)
    if (!lib) return { items: [], total: 0 }

    const type = lib.type === 'movie' ? 1 : 2
    const params = new URLSearchParams({
      type: String(type),
      includeGuids: '1',
      'X-Plex-Container-Start': String(req.offset),
      'X-Plex-Container-Size': String(req.limit),
      sort: 'titleSort',
    })
    if (req.search?.trim()) params.set('title', req.search.trim())

    const data = await plexFetch(
      baseUrl, token,
      `/library/sections/${lib.key}/all?${params.toString()}`,
    ) as { MediaContainer?: { totalSize?: number; size?: number; Metadata?: unknown[] } }

    const mc = data?.MediaContainer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: LibraryItem[] = (mc?.Metadata ?? []).map((m: any) => {
      const guids = extractGuids(m)
      const thumbPath = m.thumb as string | undefined
      const thumb = thumbPath
        ? `${baseUrl.replace(/\/$/, '')}/photo/:/transcode?width=240&height=360&minSize=1&upscale=1&url=${encodeURIComponent(thumbPath)}&X-Plex-Token=${token}`
        : undefined
      return {
        key: m.ratingKey as string,
        title: m.title as string,
        year: m.year as number | undefined,
        type: lib.type as 'movie' | 'show',
        thumb,
        ...guids,
      }
    })

    return { items, total: mc?.totalSize ?? mc?.size ?? items.length }
  },

  /**
   * Resolves an item's TMDB id: direct, or via tvdb/imdb lookup when a TMDB
   * API key is configured.
   *
   * @param item - Library item carrying whatever external IDs Plex exposed.
   * @returns The TMDB id, or null when it can't be resolved.
   */
  async resolveTmdbId(item: LibraryItem): Promise<string | null> {
    if (item.tmdbId) return item.tmdbId

    let { tvdbId, imdbId } = item

    // HAMA anime carry an AniDB id that TMDB's /find can't resolve. Map it via
    // the Fribb dataset: most entries yield a direct TMDB id (no key needed),
    // and the rest backfill a tvdb/imdb id for the /find path below.
    if (item.anidbId) {
      const mapped = await AnimeMappingService.resolve(item.anidbId)
      if (mapped?.tmdbId) return mapped.tmdbId
      tvdbId ??= mapped?.tvdbId
      imdbId ??= mapped?.imdbId
    }

    const key = ConfigService.get().tmdbApiKey?.trim()
    if (!key) return null

    const external = tvdbId
      ? { source: 'tvdb_id', value: tvdbId }
      : imdbId ? { source: 'imdb_id', value: imdbId } : null
    if (!external) return null

    try {
      const url = `https://api.themoviedb.org/3/find/${external.value}?external_source=${external.source}&api_key=${key}`
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return null
      const body = await res.json() as {
        movie_results?: Array<{ id: number }>
        tv_results?: Array<{ id: number }>
      }
      const hit = item.type === 'movie' ? body.movie_results?.[0] : body.tv_results?.[0]
      return hit ? String(hit.id) : null
    } catch (err) {
      Logger.warn('Plex', `TMDB resolve failed: ${err instanceof Error ? err.message : err}`)
      return null
    }
  },

  /**
   * Returns all items tagged with the given label across every library.
   *
   * @param req - The label to filter on.
   * @returns Matching items with display-ready thumb URLs.
   */
  async getLabeledItems(req: LabelReq): Promise<PlexItem[]> {
    if (!_conn) return []
    const { baseUrl, token, libraries: allLibs } = _conn
    const items: PlexItem[] = []

    for (const lib of allLibs) {
      const type = lib.type === 'movie' ? 1 : 2
      try {
        const data = await plexFetch(
          baseUrl, token,
          `/library/sections/${lib.key}/all?type=${type}&label.tag.tag=${encodeURIComponent(req.label)}`,
        ) as { MediaContainer?: { Metadata?: unknown[] } }
        for (const m of data?.MediaContainer?.Metadata ?? []) {
          const item = mapMetadata(m, lib.title, lib.type as 'movie' | 'show')
          // Build a full, token-bearing transcode URL so thumbs load in the UI
          if (item.thumb) {
            item.thumb = `${baseUrl.replace(/\/$/, '')}/photo/:/transcode?width=120&height=180&minSize=1&upscale=1&url=${encodeURIComponent(item.thumb)}&X-Plex-Token=${token}`
          }
          items.push(item)
        }
      } catch {
        // label filter unsupported on this section version - skip
      }
    }
    return items
  },

  /**
   * Resolves the real upload target for a poster. Given the show's ratingKey
   * plus optional season/episode hints, walks the Plex hierarchy to find the
   * ratingKey the poster should actually apply to, and whether it's a poster
   * or a background ("art", for backdrops).
   *
   * @param showKey - The show or movie ratingKey.
   * @param season - Season number, or Cover / Backdrop markers.
   * @param episode - Episode number within the season.
   * @returns The target key and kind, or a skip result when the season/episode
   *   doesn't exist in this library.
   */
  async resolveTarget(
    showKey: string,
    season?: number | 'Cover' | 'Backdrop',
    episode?: number,
  ): Promise<{ key: string; kind: 'poster' | 'art' } | { kind: 'skip'; reason: string }> {
    if (!_conn) return { key: showKey, kind: 'poster' }
    const { baseUrl, token } = _conn

    if (season === 'Backdrop') return { key: showKey, kind: 'art' }
    if (season == null || season === 'Cover') return { key: showKey, kind: 'poster' }

    try {
      const seasonData = await plexFetch(baseUrl, token, `/library/metadata/${showKey}/children`) as {
        MediaContainer?: { Metadata?: Array<{ ratingKey: string; index?: number }> }
      }
      const seasons = seasonData?.MediaContainer?.Metadata ?? []
      const seasonNode = seasons.find(s => s.index === season)
      // Skip rather than clobbering the show poster with a season poster /
      // title card the user can't actually use
      if (!seasonNode) {
        Logger.warn('Plex', `Season ${season} not found under show ${showKey} - skipping`)
        return { kind: 'skip', reason: `Season ${season} not in library` }
      }

      if (episode == null) return { key: seasonNode.ratingKey, kind: 'poster' }

      const epData = await plexFetch(baseUrl, token, `/library/metadata/${seasonNode.ratingKey}/children`) as {
        MediaContainer?: { Metadata?: Array<{ ratingKey: string; index?: number }> }
      }
      const episodes = epData?.MediaContainer?.Metadata ?? []
      const epNode = episodes.find(e => e.index === episode)
      // Skip rather than overwriting the season poster with this episode's
      // title card (the cause of "all cards on the season poster" when a set
      // has more episodes than Plex has)
      if (!epNode) {
        Logger.warn('Plex', `S${season}E${episode} not found - skipping`)
        return { kind: 'skip', reason: `S${season}E${episode} not in library` }
      }
      return { key: epNode.ratingKey, kind: 'poster' }
    } catch (err) {
      Logger.warn('Plex', `Target resolution failed for show ${showKey}: ${err instanceof Error ? err.message : err}`)
      return { key: showKey, kind: 'poster' }
    }
  },

  /**
   * Downloads a poster image and uploads it to the resolved target (show,
   * season, episode, or background art), tagging the item with its source label.
   *
   * @param req - Item key, image URL, source site, and season/episode hints.
   * @returns Success flag, with an error message on failure or skip.
   */
  async uploadPoster(req: UploadReq): Promise<UploadRes> {
    if (!_conn) return { success: false, error: 'Not connected to Plex' }
    const { baseUrl, token } = _conn
    const { itemKey, imageUrl, source, season, episode } = req
    const labelTag = source === 'mediux' ? 'MediUX' : 'ThePosterDB'

    try {
      const target = await PlexService.resolveTarget(itemKey, season, episode)
      // Skip cleanly instead of misapplying the art to a parent (season/show) poster
      if (target.kind === 'skip') {
        Logger.scrape('Plex', `Skipped upload - ${target.reason} (key ${itemKey})`)
        return { success: false, error: target.reason }
      }
      const endpoint = target.kind === 'art' ? 'arts' : 'posters'

      const imgRes = await fetch(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      })
      if (!imgRes.ok) throw new Error(`Image download failed: ${imgRes.status}`)
      const imgBuf = Buffer.from(await imgRes.arrayBuffer())
      const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg'

      await plexFetch(baseUrl, token, `/library/metadata/${target.key}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: imgBuf,
      })

      // Tag the show (itemKey) with the source label for later reset/stats
      await plexFetch(
        baseUrl, token,
        `/library/metadata/${itemKey}?label[].tag.tag=${encodeURIComponent(labelTag)}&label.locked=1`,
        { method: 'PUT' },
      )

      const where = target.key === itemKey
        ? 'show' : `S${season ?? '?'}${episode != null ? `E${episode}` : ''}`
      Logger.success('Plex', `${target.kind} uploaded → ${where} (key ${target.key}) [${source}]`)
      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      Logger.error('Plex', `Upload failed - key ${itemKey}: ${error}`)
      return { success: false, error }
    }
  },

  /**
   * Restores an item's original provider poster, removes source labels, and
   * optionally recurses into children (seasons and episodes).
   *
   * @param req - Item key and whether to reset hierarchically.
   */
  async resetPoster(req: ResetReq): Promise<void> {
    if (!_conn) throw new Error('Not connected to Plex')
    const { baseUrl, token } = _conn
    const { itemKey, hierarchical, deleteUploads } = req

    // Free the uploaded image data first: Plex can only delete the *active* thumb/art,
    // so this must happen before the original poster is re-selected below. Deletion
    // also reverts Plex to a default, making the select-original step a clean fallback.
    if (deleteUploads) {
      await deleteUploadedImage(baseUrl, token, itemKey, 'poster')
      await deleteUploadedImage(baseUrl, token, itemKey, 'art')
    }

    const postersData = await plexFetch(baseUrl, token, `/library/metadata/${itemKey}/posters`) as {
      MediaContainer?: { Metadata?: Array<{ ratingKey?: string; thumb?: string; selected?: boolean; provider?: string }> }
    }
    const posters = postersData?.MediaContainer?.Metadata ?? []

    // Any poster that isn't from the custom upload provider
    const original = posters.find(p => {
      const src = p.provider ?? ''
      return src !== 'custom' && src !== ''
    }) ?? posters.find(p => !p.selected)

    if (original) {
      const posterKey = original.ratingKey ?? original.thumb ?? ''
      if (posterKey) {
        await plexFetch(
          baseUrl, token,
          `/library/metadata/${itemKey}/poster?url=${encodeURIComponent(posterKey)}`,
          { method: 'PUT' },
        )
      }
    }

    for (const label of ['MediUX', 'ThePosterDB']) {
      try {
        await plexFetch(
          baseUrl, token,
          `/library/metadata/${itemKey}?label[].tag.tag=${encodeURIComponent(label)}&label[].tag.locked=0`,
          { method: 'PUT' },
        )
      } catch {
        // label may not exist on this item
      }
    }

    if (hierarchical) {
      try {
        const childData = await plexFetch(baseUrl, token, `/library/metadata/${itemKey}/children`) as {
          MediaContainer?: { Metadata?: Array<{ ratingKey: string }> }
        }
        for (const child of childData?.MediaContainer?.Metadata ?? []) {
          await PlexService.resetPoster({ itemKey: child.ratingKey, hierarchical: true, deleteUploads })
        }
      } catch {
        // no children or server error - skip
      }
    }

    Logger.info('Plex', `Poster reset - key ${itemKey}`)
  },

  /**
   * Triggers Plex's "Clean Bundles" maintenance task to reclaim disk space from
   * deleted/unused poster and art bundles, then waits for it to actually finish
   * (the task runs asynchronously server-side) so the UI reflects real completion
   * rather than a guessed cooldown.
   */
  async cleanBundles(): Promise<void> {
    if (!_conn) throw new Error('Not connected to Plex')
    const { baseUrl, token } = _conn
    // 200 = started, 202 = already running; both are ok and we then wait it out.
    await plexFetch(baseUrl, token, '/butler/CleanOldBundles', { method: 'POST' })
    Logger.info('Plex', 'Triggered Clean Bundles task')
    await waitForActivity(baseUrl, token, /bundle/i)
    Logger.info('Plex', 'Clean Bundles finished')
  },

  /**
   * Counts labeled items per source and media type for the dashboard.
   *
   * @returns Counts keyed by mediux, posterdb, total, movies, and shows.
   */
  async getStats(): Promise<Record<string, number>> {
    const [mediuxItems, posterdbItems] = await Promise.all([
      PlexService.getLabeledItems({ label: 'MediUX' }),
      PlexService.getLabeledItems({ label: 'ThePosterDB' }),
    ])
    const all = [...mediuxItems, ...posterdbItems]
    return {
      mediux:   mediuxItems.length,
      posterdb: posterdbItems.length,
      total:    all.length,
      movies:   all.filter(i => i.type === 'movie').length,
      shows:    all.filter(i => i.type === 'show').length,
    }
  },

  /**
   * Auto-reconnects from saved config; clears the token if the server rejects
   * it (401).
   *
   * @returns Success flag with the server name, or tokenInvalid when re-auth is needed.
   */
  async tryRestoreFromConfig(): Promise<{ success: boolean; serverName?: string; tokenInvalid?: boolean }> {
    const cfg = ConfigService.get()
    if (!cfg.baseUrl || !cfg.token) return { success: false }
    const result = await PlexService.connect({ baseUrl: cfg.baseUrl, token: cfg.token })
    if (!result.success && result.error?.includes('401')) {
      // Token was revoked (e.g. password change) - clear it so the UI prompts re-auth
      ConfigService.set({ token: '', plexAccountName: '', plexAccountEmail: '', plexAccountThumb: '' })
      Logger.warn('Plex', 'Stored token rejected (401) - cleared. Please sign in again.')
      return { success: false, tokenInvalid: true }
    }
    return { success: result.success, serverName: result.serverName }
  },
}
