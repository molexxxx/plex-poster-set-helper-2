import type { AppliedRecord } from '../../../electron/ipc/types'

export type SourceFilter = 'all' | 'mediux' | 'posterdb'
export type TypeFilter   = 'all' | 'movie' | 'show'
export type CleanState   = 'idle' | 'cleaning' | 'done' | 'error'

/** One row of the Reset Posters list: an item's latest applied record. */
export interface TrackedItem extends AppliedRecord
{
  /** itemKey alias for existing markup. */
  key: string
}

/** Applied-poster counts by source and type. */
export interface Stats
{
  total: number
  mediux: number
  posterdb: number
  movies: number
  shows: number
}

/**
 * Bumps the width/height params on a thumb URL so the lightbox shows it larger.
 *
 * @param url - Transcode thumb URL.
 * @returns The same URL at 700x1050, or undefined when absent.
 */
export function enlarge(url?: string): string | undefined
{
  if (!url) return undefined
  return url.replace(/width=\d+/i, 'width=700').replace(/height=\d+/i, 'height=1050')
}

/**
 * "3 days ago" style relative time.
 *
 * @param iso - ISO timestamp.
 * @returns A short label, or an empty string when absent.
 */
export function timeAgo(iso?: string): string
{
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

/**
 * Keeps one record per Plex item from the applied history.
 *
 * @param records - The applied history, newest first.
 * @returns The first record seen for each item, keyed for the list.
 */
export function latestPerItem(records: AppliedRecord[]): TrackedItem[]
{
  const byItem = new Map<string, AppliedRecord>()
  for (const r of records) if (!byItem.has(r.itemKey)) byItem.set(r.itemKey, r)
  return [...byItem.values()].map(r => ({ ...r, key: r.itemKey }))
}

/**
 * Applies the list's source, type, and title filters.
 *
 * @param items - Every tracked item.
 * @param sourceFilter - Site to keep, or all.
 * @param typeFilter - Media type to keep, or all.
 * @param search - Text the title must contain, case-insensitive.
 * @returns The items that pass every filter.
 */
export function filterTracked(items: TrackedItem[], sourceFilter: SourceFilter, typeFilter: TypeFilter, search: string): TrackedItem[]
{
  return items.filter(i =>
  {
    if (sourceFilter !== 'all' && i.source !== sourceFilter) return false
    if (typeFilter   !== 'all' && i.type   !== typeFilter)   return false
    if (search && !i.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
}

/**
 * Counts the tracked items by source and type.
 *
 * @param items - Every tracked item.
 * @returns The totals the stats strip shows.
 */
export function trackedStats(items: TrackedItem[]): Stats
{
  return {
    total:    items.length,
    mediux:   items.filter(i => i.source === 'mediux').length,
    posterdb: items.filter(i => i.source === 'posterdb').length,
    movies:   items.filter(i => i.type === 'movie').length,
    shows:    items.filter(i => i.type === 'show').length,
  }
}

/**
 * The Clean Bundles button's label.
 *
 * @param cleanState - Where the task stands.
 * @returns The label for that state.
 */
export function cleanLabel(cleanState: CleanState): string
{
  return cleanState === 'cleaning' ? 'Cleaning…'
    : cleanState === 'done' ? 'Cleaned'
    : cleanState === 'error' ? 'Failed'
    : 'Clean Bundles'
}
