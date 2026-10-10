import type { AppliedRecord, LibraryArtFilter, LibrarySort, LibraryStatusFilter, SortDir } from '../ipc/types'
import { artFilterMatches, type ScheduleCoverage } from './scheduleUtils'
import type { ShowStatus } from './showStatusService'

/** The fields a grid filter needs per item, read without cast, genres, or images. */
export interface LightItem
{
  key: string
  title: string
  titleSort: string
  year?: number
  /** Raw Plex thumb path. */
  thumb?: string
  addedAt: number
  lastViewedAt: number
  tmdbId?: string
  tvdbId?: string
  imdbId?: string
  anidbId?: string
}

/** Everything a filtered grid page is computed from. */
export interface GridQuery
{
  artFilter?: LibraryArtFilter
  status?: LibraryStatusFilter
  libraryType: 'movie' | 'show'
  search?: string
  sort?: LibrarySort
  sortDir?: SortDir
  /** Item key to its applied-poster records. */
  byItem: Map<string, AppliedRecord[]>
  coverage: ScheduleCoverage
  /** Show key to status; required when `status` is set. */
  showStatus?: Map<string, ShowStatus>
}

/**
 * Maps a raw Plex metadata node to a light item.
 *
 * @param m - Raw node from a light read.
 * @returns The light item.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toLightItem(m: any): LightItem
{
  const title = String(m.title ?? '')
  return {
    key: String(m.ratingKey),
    title,
    titleSort: String(m.titleSort ?? title).toLowerCase(),
    year: typeof m.year === 'number' ? m.year : undefined,
    thumb: typeof m.thumb === 'string' ? m.thumb : undefined,
    addedAt: typeof m.addedAt === 'number' ? m.addedAt : 0,
    lastViewedAt: typeof m.lastViewedAt === 'number' ? m.lastViewedAt : 0,
  }
}

/**
 * Orders light items the way Plex would for the same sort, with title as the
 * tiebreak so paging is stable.
 *
 * @param sort - Grid sort field.
 * @param dir - Sort direction.
 * @returns A comparator for Array.prototype.sort.
 */
export function lightComparator(sort: LibrarySort = 'title', dir: SortDir = 'asc'): (a: LightItem, b: LightItem) => number
{
  const mul = dir === 'asc' ? 1 : -1
  return (a, b) =>
  {
    let d: number
    switch (sort)
    {
      case 'recentlyAdded': d = a.addedAt - b.addedAt; break
      case 'year': d = (a.year ?? 0) - (b.year ?? 0); break
      case 'lastPlayed': d = a.lastViewedAt - b.lastViewedAt; break
      default: d = a.titleSort.localeCompare(b.titleSort)
    }
    return mul * d || a.titleSort.localeCompare(b.titleSort)
  }
}

/**
 * Tells whether a grid query can be answered from applied history alone, so
 * only those items need reading from Plex instead of the whole section.
 *
 * @param filter - The art filter.
 * @returns true for filters that only ever match items with history.
 */
export function needsHistoryOnly(filter: LibraryArtFilter | undefined): filter is Exclude<LibraryArtFilter, { kind: 'none' }>
{
  return !!filter && filter.kind !== 'none'
}

/**
 * Item keys from history that pass a history-only art filter.
 *
 * @param filter - A filter {@link needsHistoryOnly} accepted.
 * @param byItem - Item key to records.
 * @param coverage - Scheduled-job coverage.
 * @returns The keys to read.
 */
export function historyKeysFor(filter: Exclude<LibraryArtFilter, { kind: 'none' }>, byItem: Map<string, AppliedRecord[]>, coverage: ScheduleCoverage): string[]
{
  return [...byItem.entries()].filter(([, recs]) => artFilterMatches(filter, recs, coverage)).map(([key]) => key)
}

/**
 * Filters and sorts a pool of light items for one grid query. The pool is not
 * modified.
 *
 * @param pool - Candidate items, either a whole section or the history-backed subset.
 * @param q - The query.
 * @returns The matching items in display order.
 */
export function applyGridQuery(pool: LightItem[], q: GridQuery): LightItem[]
{
  let items = pool
  if (q.artFilter) items = items.filter(it => artFilterMatches(q.artFilter!, q.byItem.get(it.key) ?? [], q.coverage))
  if (q.status && q.libraryType === 'show' && q.showStatus)
  {
    const statuses = q.showStatus
    items = items.filter(it => statuses.get(it.key) === q.status)
  }
  const term = q.search?.trim().toLowerCase()
  if (term) items = items.filter(it => it.title.toLowerCase().includes(term))
  return [...items].sort(lightComparator(q.sort, q.sortDir))
}
