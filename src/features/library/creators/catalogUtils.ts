import type { MediuxUserSet, PosterInfo } from '../../../../electron/ipc/types'

/** The catalog's views: sets grouped by title, or one type of single file. */
export type Tab = 'sets' | 'posters' | 'backdrops' | 'titlecards'
/** Which sets show: those for titles in the library, those for titles outside it, or all. */
export type LibraryFilter = 'library' | 'missing' | 'all'

/** The sets for one title, in catalog order. */
export interface TitleGroup { key: string; title: string; year?: number; matchedKey?: string; sets: MediuxUserSet[] }

/** Formats a count with thousands separators. */
export const count = (n: number) => n.toLocaleString('en-US')
/** A count with its noun, such as "1 set" or "12 sets". */
export const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`

/** The key sets for the same title share: the matched Plex item, or the normalized title and year. */
export function titleKey(s: MediuxUserSet): string {
  return s.matchedKey ? `k:${s.matchedKey}` : `t:${s.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${s.year ?? ''}`
}

/** Groups sets by the title they are for, keeping the catalog's order. */
export function groupByTitle(sets: MediuxUserSet[]): TitleGroup[] {
  const groups = new Map<string, TitleGroup>()
  for (const s of sets) {
    const key = titleKey(s)
    const group = groups.get(key)
    if (group) group.sets.push(s)
    else groups.set(key, { key, title: s.title, year: s.year, matchedKey: s.matchedKey, sets: [s] })
  }
  return [...groups.values()]
}

/** Appends the incoming sets the list does not hold yet, returning the same list when none are new. */
export function appendNew(prev: MediuxUserSet[], incoming: MediuxUserSet[]): MediuxUserSet[] {
  if (!incoming.length) return prev
  const seen = new Set(prev.map(s => s.id))
  const fresh = incoming.filter(s => !seen.has(s.id))
  return fresh.length ? [...prev, ...fresh] : prev
}

/** Counts a set's files by type, such as "1 poster · 3 title cards", or "No files". */
export function shortTypeCounts(s: MediuxUserSet): string {
  const parts: string[] = []
  if (s.posterCount) parts.push(plural(s.posterCount, 'poster'))
  if (s.titleCardCount) parts.push(plural(s.titleCardCount, 'title card'))
  if (s.backdropCount) parts.push(plural(s.backdropCount, 'backdrop'))
  return parts.join(' · ') || 'No files'
}

/** Names a single file's season or episode for its lightbox caption, when it has one. */
export function fileCaption(p: PosterInfo): string | undefined {
  if (p.episode != null) return `${typeof p.season === 'number' ? `Season ${p.season}, ` : ''}Episode ${p.episode}`
  if (typeof p.season === 'number') return p.season === 0 ? 'Specials' : `Season ${p.season}`
  return undefined
}
