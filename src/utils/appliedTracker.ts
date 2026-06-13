import type { AppliedRecord } from '../../electron/ipc/types'

/**
 * Records an applied poster set in local history - the single source of truth
 * for the "Applied / in library" markers and the Reset Posters page. Deduped by
 * the Plex item + set (manual uploads have no setId, so they dedupe per item);
 * the per-poster `posterUrls` are merged so multiple uploads to the same
 * set/item accumulate rather than overwrite.
 *
 * @param rec - The applied set to record; merged with any existing record for
 *   the same item + set.
 */
export async function recordApplied(rec: AppliedRecord) {
  return recordAppliedBatch([rec])
}

/**
 * Records several applied entries in a single config read/write. Applying a
 * whole collection touches multiple Plex items at once; recording each with a
 * separate {@link recordApplied} call races on the shared config (concurrent
 * get/set lose each other's writes), so the per-movie rows would mostly vanish.
 * Batching keeps every item's row.
 *
 * @param recs - Applied entries; merged per item + set with existing history.
 */
export async function recordAppliedBatch(recs: AppliedRecord[]) {
  if (!recs.length) return
  const cfg = await window.api.config.get()
  let list = cfg.appliedPosters ?? []
  for (const rec of recs) {
    const existing = list.find(r => r.itemKey === rec.itemKey && r.setId === rec.setId)
    const mergedUrls = [...new Set([...(existing?.posterUrls ?? []), ...(rec.posterUrls ?? [])])]
    const merged: AppliedRecord = { ...rec, posterUrls: mergedUrls }
    list = [merged, ...list.filter(r => !(r.itemKey === rec.itemKey && r.setId === rec.setId))]
  }
  await window.api.config.set({ appliedPosters: list.slice(0, 2000) })
}

/**
 * Key used to tell if a title already has applied art.
 *
 * @param title - Media title.
 * @param year - Release year, when known.
 * @returns The "title|year" key, lowercased.
 */
export function appliedKey(title: string, year?: number): string {
  return `${title.toLowerCase()}|${year ?? ''}`
}

/**
 * A snapshot of what's been applied - interchangeable across Manual Scrape and
 * the Library Browser.
 */
export interface AppliedIndex {
  /** Every set ever applied (current or previously). */
  setIds: Set<string>
  /** Any title (title|year) that has custom art, regardless of set/source. */
  titles: Set<string>
  /** Exact poster image URLs ever applied. */
  posterUrls: Set<string>
  /** itemKey to the current set id (latest applied). */
  currentByItem: Map<string, string>
  /** Poster URLs belonging to the current set per item. */
  currentPosterUrls: Set<string>
}

/**
 * Builds the applied index from local history.
 *
 * @returns Lookup sets/maps over everything recorded as applied.
 */
export async function loadAppliedIndex(): Promise<AppliedIndex> {
  const c = await window.api.config.get()
  const recs = c.appliedPosters ?? []

  // The most-recently-applied record per item is the one currently live in Plex;
  // older records for the same item were overwritten (downloaded, not current)
  const latestPerItem = new Map<string, typeof recs[number]>()
  for (const r of recs) {
    const at = Date.parse(r.appliedAt) || 0
    const cur = latestPerItem.get(r.itemKey)
    if (!cur || at > (Date.parse(cur.appliedAt) || 0)) latestPerItem.set(r.itemKey, r)
  }
  const currentByItem = new Map<string, string>()
  const currentPosterUrls = new Set<string>()
  for (const [item, r] of latestPerItem) {
    if (r.setId) currentByItem.set(item, r.setId)
    for (const u of r.posterUrls ?? []) currentPosterUrls.add(u)
  }

  return {
    setIds: new Set(recs.map(r => r.setId).filter(Boolean) as string[]),
    titles: new Set(recs.map(r => appliedKey(r.title, r.year))),
    posterUrls: new Set(recs.flatMap(r => r.posterUrls ?? [])),
    currentByItem,
    currentPosterUrls,
  }
}
