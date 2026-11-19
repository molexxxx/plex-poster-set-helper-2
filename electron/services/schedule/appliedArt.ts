import type { AppliedRecord, LibraryArtFilter, PosterInfo } from '../../ipc/types'
import { coverageKey, recordCoverageKey, type ScheduleCoverage } from './coverage'

/** Applied-poster history entries kept in config. */
export const MAX_APPLIED_RECORDS = 2000

/**
 * Groups applied-poster history by Plex item.
 *
 * @param records - Applied-poster history.
 * @returns Item key to that item's records.
 */
export function appliedByItem(records: AppliedRecord[]): Map<string, AppliedRecord[]>
{
  const index = new Map<string, AppliedRecord[]>()
  for (const r of records)
  {
    const list = index.get(r.itemKey)
    if (list) list.push(r)
    else index.set(r.itemKey, [r])
  }
  return index
}

/** A creator with art on record. */
export interface AppliedUploader
{
  uploader: string
  /** The site they publish on; the same name on the other site is someone else. */
  source: 'mediux' | 'posterdb'
  /** Items carrying their art. */
  count: number
}

/**
 * Lists the creators whose art is on record, most-used first.
 *
 * @param records - Applied-poster history.
 * @returns Each creator, per site, with the number of items carrying their art.
 */
export function appliedUploaders(records: AppliedRecord[]): AppliedUploader[]
{
  const items = new Map<string, { uploader: string; source: 'mediux' | 'posterdb'; keys: Set<string> }>()
  for (const r of records)
  {
    if (!r.uploader) continue
    const k = `${r.source}:${r.uploader.toLowerCase()}`
    let entry = items.get(k)
    if (!entry) items.set(k, (entry = { uploader: r.uploader, source: r.source, keys: new Set() }))
    entry.keys.add(r.itemKey)
  }
  return [...items.values()]
    .map(e => ({ uploader: e.uploader, source: e.source, count: e.keys.size }))
    .sort((a, b) => b.count - a.count || a.uploader.localeCompare(b.uploader) || a.source.localeCompare(b.source))
}

/**
 * Tells whether an item passes a Library Browser art filter.
 *
 * @param filter - The filter.
 * @param records - The item's applied-poster records.
 * @param coverage - Scheduled-job coverage from {@link scheduleCoverage}.
 * @returns true when the item should be shown.
 */
export function artFilterMatches(filter: LibraryArtFilter, records: AppliedRecord[], coverage: ScheduleCoverage): boolean
{
  switch (filter.kind)
  {
    case 'none':
      return records.length === 0
    case 'applied':
      return records.length > 0
    case 'uploader':
    {
      const wanted = filter.uploader.toLowerCase()
      return records.some(r => r.uploader?.toLowerCase() === wanted && (!filter.source || r.source === filter.source))
    }
    case 'unscheduled':
      return records.length > 0 && !records.some(r =>
        (!!r.setId && coverage.sets.has(coverageKey(r.source, r.setId)))
        || (r.source === 'mediux' && !!r.uploader && coverage.creators.has(r.uploader.toLowerCase())))
    default:
      return true
  }
}

/**
 * Collects every image URL ever applied to each Plex item.
 *
 * @param records - Applied-poster history.
 * @returns Item key to applied image URLs.
 */
export function appliedUrlIndex(records: AppliedRecord[]): Map<string, Set<string>>
{
  const index = new Map<string, Set<string>>()
  for (const r of records)
  {
    let urls = index.get(r.itemKey)
    if (!urls)
    {
      urls = new Set()
      index.set(r.itemKey, urls)
    }
    for (const u of r.posterUrls ?? []) urls.add(u)
  }
  return index
}

/**
 * Merges new applied entries into history. Entries dedupe on item, set and source, the
 * per-poster URLs and slots accumulate, and the newest entries move to the
 * front.
 *
 * @param existing - Current history, newest first.
 * @param incoming - Entries to record.
 * @param cap - Maximum entries kept.
 * @returns The updated history.
 */
export function mergeAppliedRecords(existing: AppliedRecord[], incoming: AppliedRecord[], cap = MAX_APPLIED_RECORDS): AppliedRecord[]
{
  let list = existing
  for (const rec of incoming)
  {
    // Same item + same set from the same site. Source matters: MediUX set 42 and
    // ThePosterDB set 42 are different sets, and merging them would lose a row.
    const same = (r: AppliedRecord) => r.itemKey === rec.itemKey && r.setId === rec.setId && r.source === rec.source
    const prior = list.find(same)
    const posterUrls = [...new Set([...(prior?.posterUrls ?? []), ...(rec.posterUrls ?? [])])]
    const merged: AppliedRecord = { ...rec, posterUrls }
    if (prior?.slots || rec.slots) merged.slots = [...new Set([...(prior?.slots ?? []), ...(rec.slots ?? [])])]
    list = [merged, ...list.filter(r => !same(r))]
  }
  return list.slice(0, cap)
}

/**
 * Names the art slot a poster fills on its Plex item.
 *
 * @param p - The poster.
 * @returns poster, backdrop, s<n> for a season poster, or s<n>e<n> for a title card.
 */
export function posterSlot(p: Pick<PosterInfo, 'season' | 'episode'>): string
{
  if (p.season === 'Backdrop') return 'backdrop'
  if (p.episode != null) return `s${p.season ?? '?'}e${p.episode}`
  if (typeof p.season === 'number') return `s${p.season}`
  return 'poster'
}

/** Which sets have filled each slot on each item, for fill-gaps jobs. */
export interface SlotCoverage
{
  /** Item key to the set keys (empty string when unknown) of slotless records. */
  whole: Map<string, Set<string>>
  /** Item key to slot to the set keys that filled it. */
  slots: Map<string, Map<string, Set<string>>>
}

/**
 * Indexes applied-poster history by item and slot. Sets are keyed by
 * {@link coverageKey}, so a MediUX set and a ThePosterDB set that share an id
 * stay two sets.
 *
 * @param records - Applied-poster history.
 * @returns The coverage index for {@link isSlotCovered}.
 */
export function slotCoverage(records: AppliedRecord[]): SlotCoverage
{
  const coverage: SlotCoverage = { whole: new Map(), slots: new Map() }
  for (const r of records)
  {
    const setKey = recordCoverageKey(r)
    if (!r.slots)
    {
      let sets = coverage.whole.get(r.itemKey)
      if (!sets) coverage.whole.set(r.itemKey, (sets = new Set()))
      sets.add(setKey)
      continue
    }
    let bySlot = coverage.slots.get(r.itemKey)
    if (!bySlot) coverage.slots.set(r.itemKey, (bySlot = new Map()))
    for (const slot of r.slots)
    {
      let sets = bySlot.get(slot)
      if (!sets) bySlot.set(slot, (sets = new Set()))
      sets.add(setKey)
    }
  }
  return coverage
}

/**
 * Marks a slot as filled by a set, so later posters in the same run see it.
 *
 * @param coverage - Index from {@link slotCoverage}.
 * @param itemKey - Plex item.
 * @param slot - Slot from {@link posterSlot}.
 * @param setKey - The set that filled it, from {@link coverageKey}.
 */
export function addSlotCoverage(coverage: SlotCoverage, itemKey: string, slot: string, setKey?: string): void
{
  let bySlot = coverage.slots.get(itemKey)
  if (!bySlot) coverage.slots.set(itemKey, (bySlot = new Map()))
  let sets = bySlot.get(slot)
  if (!sets) bySlot.set(slot, (sets = new Set()))
  sets.add(setKey ?? '')
}

/**
 * Tells whether art from another set already fills a slot. Records without
 * slots predate slot tracking and count as covering every slot on their item.
 * The poster's own set never blocks it, so an updated card still applies.
 *
 * @param coverage - Index from {@link slotCoverage}.
 * @param itemKey - Plex item.
 * @param slot - Slot from {@link posterSlot}.
 * @param setKey - The set the poster comes from, from {@link coverageKey}.
 * @returns true when a different set has filled the slot.
 */
export function isSlotCovered(coverage: SlotCoverage, itemKey: string, slot: string, setKey?: string): boolean
{
  const own = setKey ?? ''
  const other = (sets?: Set<string>) => !!sets && [...sets].some(s => s !== own)
  return other(coverage.whole.get(itemKey)) || other(coverage.slots.get(itemKey)?.get(slot))
}
