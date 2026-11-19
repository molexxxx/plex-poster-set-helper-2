import type { LibraryArtFilter, LibrarySort, SetSource } from '../../../../electron/ipc/types'

/** Items read per page of the grid. */
export const PAGE_SIZE = 60

/** Library Browser grid sort options and their labels. */
export const SORT_LABEL: Record<LibrarySort, string> = {
  recentlyAdded: 'Recently Added',
  title: 'Title',
  year: 'Release Year',
  lastPlayed: 'Last Played',
}
/** Collections only support title / date-added ordering. */
export const COLLECTION_SORTS: LibrarySort[] = ['recentlyAdded', 'title']
/** Every sort a library tab offers. */
export const ALL_SORTS: LibrarySort[] = ['recentlyAdded', 'title', 'year', 'lastPlayed']
/** Sentinel activeKey for the movie-collections browser tab. */
export const COLLECTIONS_TAB_KEY = '__collections__'

/** Grid art filter as the dropdown holds it; creators carry their site so the same name on two sites stays two entries. */
export type ArtFilterValue = 'all' | 'none' | 'applied' | 'unscheduled' | `uploader:${SetSource}:${string}`

/**
 * Converts the dropdown value into the request filter.
 *
 * @param value - The selected option.
 * @returns The filter, or undefined for "all".
 */
export function toArtFilter(value: ArtFilterValue): LibraryArtFilter | undefined {
  if (value === 'all') return undefined
  if (value === 'none' || value === 'applied' || value === 'unscheduled') return { kind: value }
  const m = value.match(/^uploader:(mediux|posterdb):(.*)$/)
  return m ? { kind: 'uploader', uploader: m[2], source: m[1] as SetSource } : undefined
}
