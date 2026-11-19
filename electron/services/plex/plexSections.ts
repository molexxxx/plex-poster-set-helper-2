import { ConfigService } from '../config'
import { appliedByItem } from '../schedule/appliedArt'
import { scheduleCoverage } from '../schedule/coverage'
import { applyGridQuery, historyKeysFor, needsHistoryOnly, toLightItem, type LightItem } from '../libraryGrid'
import { ShowStatusService, type ShowStatus } from '../showStatusService'
import type { SectionItemsReq, SectionItemsRes, LibraryItem, LibrarySort, SortDir } from '../../ipc/types'
import { plexConnection } from './plexConnection'
import { plexIds } from './plexIds'
import { plexFetch } from './plexHttp'
import { extractGuids, thumbUrl } from './plexMetadata'

/** Plex `sort` field for each Library Browser sort option. */
const PLEX_SORT_FIELD: Record<LibrarySort, string> = {
  recentlyAdded: 'addedAt',
  title: 'titleSort',
  year: 'year',
  lastPlayed: 'lastViewedAt',
}

/** Builds a Plex `sort=field:dir` param from the Library Browser sort choice. */
function plexSortParam(sort?: LibrarySort, dir?: SortDir): string {
  const field = PLEX_SORT_FIELD[sort ?? 'title'] ?? 'titleSort'
  return `${field}:${dir ?? 'asc'}`
}

/**
 * Query string that strips everything a grid filter does not need (cast,
 * genres, images, guids, summaries), which cuts a section read to a fraction
 * of its full size.
 */
const LIGHT_QUERY = 'excludeElements=Media,Genre,Country,Role,Director,Writer,Producer,Collection,Label,Field,Image,UltraBlurColors,Location,Extras,Chapter,Marker&excludeFields=summary,tagline,theme,art,banner'
/** Light section reads and recent-episode scans, keyed by section. */
const _lightSections = new Map<string, { at: number; items: LightItem[] }>()
const _recentShows = new Map<string, { at: number; keys: Set<string> }>()
const FILTER_CACHE_MS = 5 * 60_000
/** A show counts as still airing when an episode aired within this window. */
const AIRING_WINDOW_DAYS = 365
/** Items fetched per /library/metadata call. */
const KEY_BATCH = 100
/** Episodes read per page when scanning air dates. */
const EPISODE_PAGE = 500
const EPISODE_PAGE_CAP = 40

/**
 * Reads every item in a section in light form, cached per section.
 *
 * @param baseUrl - Server base URL.
 * @param token - Plex auth token.
 * @param sectionKey - Library section key.
 * @param libType - Section type.
 * @param fresh - Bypass the cache.
 * @returns Light items for the whole section.
 */
async function readSectionLight(baseUrl: string, token: string, sectionKey: string, libType: 'movie' | 'show', fresh?: boolean): Promise<LightItem[]> {
  const cached = _lightSections.get(sectionKey)
  if (!fresh && cached && Date.now() - cached.at < FILTER_CACHE_MS) return cached.items
  const type = libType === 'movie' ? 1 : 2
  const data = await plexFetch(baseUrl, token, `/library/sections/${sectionKey}/all?type=${type}&${LIGHT_QUERY}`) as { MediaContainer?: { Metadata?: unknown[] } }
  const items = (data?.MediaContainer?.Metadata ?? []).map(m => ({ ...toLightItem(m), ...extractGuids(m) }))
  _lightSections.set(sectionKey, { at: Date.now(), items })
  return items
}

/**
 * Reads specific items in light form, keeping only those in one section.
 * Items that no longer exist are skipped.
 *
 * @param baseUrl - Server base URL.
 * @param token - Plex auth token.
 * @param keys - Rating keys to read.
 * @param sectionKey - Library section the items must belong to.
 * @returns Light items in no particular order.
 */
async function readItemsLight(baseUrl: string, token: string, keys: string[], sectionKey: string): Promise<LightItem[]> {
  const out: LightItem[] = []
  const read = async (batch: string[]): Promise<unknown[]> => {
    const data = await plexFetch(baseUrl, token, `/library/metadata/${batch.join(',')}?${LIGHT_QUERY}`) as { MediaContainer?: { Metadata?: unknown[] } }
    return data?.MediaContainer?.Metadata ?? []
  }
  for (let i = 0; i < keys.length; i += KEY_BATCH) {
    const batch = keys.slice(i, i + KEY_BATCH)
    let nodes: unknown[]
    try {
      nodes = await read(batch)
    } catch {
      // A key Plex has since deleted can fail the whole batch; read the rest singly.
      nodes = []
      for (const key of batch) {
        try { nodes.push(...await read([key])) } catch { /* gone */ }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const m of nodes as any[]) if (String(m.librarySectionID) === sectionKey) out.push({ ...toLightItem(m), ...extractGuids(m) })
  }
  return out
}

/**
 * Finds the shows in a section with an episode that aired inside the airing
 * window, by reading episodes newest-first until the window is passed.
 *
 * @param baseUrl - Server base URL.
 * @param token - Plex auth token.
 * @param sectionKey - TV library section key.
 * @param fresh - Bypass the cache.
 * @returns Rating keys of shows still airing.
 */
async function readRecentShowKeys(baseUrl: string, token: string, sectionKey: string, fresh?: boolean): Promise<Set<string>> {
  const cached = _recentShows.get(sectionKey)
  if (!fresh && cached && Date.now() - cached.at < FILTER_CACHE_MS) return cached.keys
  const since = new Date(Date.now() - AIRING_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  const keys = new Set<string>()
  for (let page = 0; page < EPISODE_PAGE_CAP; page++) {
    const data = await plexFetch(
      baseUrl, token,
      `/library/sections/${sectionKey}/all?type=4&sort=originallyAvailableAt:desc&X-Plex-Container-Start=${page * EPISODE_PAGE}&X-Plex-Container-Size=${EPISODE_PAGE}&${LIGHT_QUERY}`,
    ) as { MediaContainer?: { Metadata?: Array<{ grandparentRatingKey?: string | number; originallyAvailableAt?: string }> } }
    const episodes = data?.MediaContainer?.Metadata ?? []
    let passedWindow = false
    for (const ep of episodes) {
      if (!ep.originallyAvailableAt) continue
      if (ep.originallyAvailableAt < since) { passedWindow = true; break }
      if (ep.grandparentRatingKey != null) keys.add(String(ep.grandparentRatingKey))
    }
    if (passedWindow || episodes.length < EPISODE_PAGE) break
  }
  _recentShows.set(sectionKey, { at: Date.now(), keys })
  return keys
}

/**
 * Reads full metadata (guids included) for one page of light items, keeping
 * the page order. Falls back to the light data when the read fails.
 *
 * @param baseUrl - Server base URL.
 * @param token - Plex auth token.
 * @param page - Light items for the page on screen.
 * @param mapItems - Converts raw metadata to library items.
 * @returns Library items in page order.
 */
async function hydrateItems(baseUrl: string, token: string, page: LightItem[], mapItems: (metadata: unknown[]) => LibraryItem[]): Promise<LibraryItem[]> {
  if (!page.length) return []
  const fallback = (it: LightItem): LibraryItem => ({ key: it.key, title: it.title, year: it.year, type: 'show', thumb: thumbUrl(baseUrl, token, it.thumb) })
  try {
    const data = await plexFetch(baseUrl, token, `/library/metadata/${page.map(it => it.key).join(',')}?includeGuids=1`) as { MediaContainer?: { Metadata?: unknown[] } }
    const full = new Map(mapItems(data?.MediaContainer?.Metadata ?? []).map(it => [it.key, it]))
    return page.map(it => full.get(it.key) ?? fallback(it))
  } catch {
    return page.map(fallback)
  }
}

/** The Library Browser grid: reading a section with its filters, and the caches behind it. */
export const plexSections = {
  /** Drops the cached light section reads and recent-episode scans used by grid filters. */
  clearGridCaches(): void {
    _lightSections.clear()
    _recentShows.clear()
  },

  /**
   * Returns a page of section items with external IDs and thumb URLs.
   *
   * @param req - Section key, offset/limit, and optional title filter.
   * @returns The page of items plus the section's total count.
   */
  async getSectionItems(req: SectionItemsReq): Promise<SectionItemsRes> {
    const conn = plexConnection.getConnection()
    if (!conn) return { items: [], total: 0 }
    const { baseUrl, token, libraries } = conn
    const lib = libraries.find(l => l.key === req.sectionKey)
    if (!lib) return { items: [], total: 0 }

    const libType = lib.type as 'movie' | 'show'
    const mapItems = (metadata: unknown[]): LibraryItem[] =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata.map((m: any) => {
        const guids = extractGuids(m)
        const thumbPath = m.thumb as string | undefined
        const thumb = thumbUrl(baseUrl, token, thumbPath)
        return {
          key: m.ratingKey as string,
          title: m.title as string,
          year: m.year as number | undefined,
          type: libType,
          thumb,
          ...guids,
        }
      })

    const status = libType === 'show' ? req.status : undefined
    if (req.artFilter || status) {
      // Plex knows nothing about applied history or series status, so the
      // candidates are read in a light form, filtered and sorted here, and only
      // the page on screen is read in full.
      const cfg = ConfigService.get()
      const byItem = appliedByItem(cfg.appliedPosters ?? [])
      const coverage = scheduleCoverage(cfg.scheduledJobs ?? [])
      const pool = needsHistoryOnly(req.artFilter)
        ? await readItemsLight(baseUrl, token, historyKeysFor(req.artFilter, byItem, coverage), lib.key)
        : await readSectionLight(baseUrl, token, lib.key, libType, req.fresh)
      let showStatus: Map<string, ShowStatus> | undefined
      if (status) {
        const recent = await readRecentShowKeys(baseUrl, token, lib.key, req.fresh)
        showStatus = await ShowStatusService.resolve(pool, {
          resolveTmdbId: show => plexIds.resolveTmdbId({
            key: show.key, title: show.title, type: 'show',
            tmdbId: show.tmdbId, tvdbId: show.tvdbId, imdbId: show.imdbId, anidbId: show.anidbId,
          }),
          fallback: key => (recent.has(key) ? 'continuing' : 'ended'),
        })
      }
      const matching = applyGridQuery(pool, {
        artFilter: req.artFilter, status, libraryType: libType, search: req.search, sort: req.sort, sortDir: req.sortDir,
        byItem, coverage, showStatus,
      })
      const page = matching.slice(req.offset, req.offset + req.limit)
      return { items: await hydrateItems(baseUrl, token, page, mapItems), total: matching.length }
    }

    const params = new URLSearchParams({
      type: String(libType === 'movie' ? 1 : 2),
      includeGuids: '1',
      'X-Plex-Container-Start': String(req.offset),
      'X-Plex-Container-Size': String(req.limit),
      sort: plexSortParam(req.sort, req.sortDir),
    })
    if (req.search?.trim()) params.set('title', req.search.trim())
    const data = await plexFetch(
      baseUrl, token,
      `/library/sections/${lib.key}/all?${params.toString()}`,
    ) as { MediaContainer?: { totalSize?: number; size?: number; Metadata?: unknown[] } }
    const mc = data?.MediaContainer
    const items = mapItems(mc?.Metadata ?? [])
    return { items, total: mc?.totalSize ?? mc?.size ?? items.length }
  },
}
