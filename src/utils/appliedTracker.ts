import type { AppliedRecord } from '../../electron/ipc/types'

// Record an applied poster set in local history - the single source of truth for
// the "Applied / in library" markers and the Reset Posters page. Deduped by the
// Plex item + set (manual uploads have no setId, so they dedupe per item); the
// per-poster `posterUrls` are merged so multiple uploads to the same set/item
// accumulate rather than overwrite.
export async function recordApplied(rec: AppliedRecord) {
  const cfg = await window.api.config.get()
  const list = cfg.appliedPosters ?? []
  const existing = list.find(r => r.itemKey === rec.itemKey && r.setId === rec.setId)
  const mergedUrls = [...new Set([...(existing?.posterUrls ?? []), ...(rec.posterUrls ?? [])])]
  const merged: AppliedRecord = { ...rec, posterUrls: mergedUrls }
  const deduped = list.filter(r => !(r.itemKey === rec.itemKey && r.setId === rec.setId))
  await window.api.config.set({ appliedPosters: [merged, ...deduped].slice(0, 2000) })
}

// Key used to tell if a title already has applied art (title|year).
export function appliedKey(title: string, year?: number): string {
  return `${title.toLowerCase()}|${year ?? ''}`
}

// A snapshot of what's been applied - interchangeable across Manual Scrape and
// the Library Browser. `setIds` = exact MediUX sets applied; `titles` = any title
// (title|year) that has custom art, regardless of which set/source it came from.
export interface AppliedIndex {
  setIds: Set<string>
  titles: Set<string>
  posterUrls: Set<string>   // exact poster image URLs already applied
}

export async function loadAppliedIndex(): Promise<AppliedIndex> {
  const c = await window.api.config.get()
  const recs = c.appliedPosters ?? []
  return {
    setIds: new Set(recs.map(r => r.setId).filter(Boolean) as string[]),
    titles: new Set(recs.map(r => appliedKey(r.title, r.year))),
    posterUrls: new Set(recs.flatMap(r => r.posterUrls ?? [])),
  }
}
