import type { PosterInfo, SetSource } from '../../electron/ipc/types'
import { posterKind, posterSlot } from '../../electron/services/scheduleUtils'

export type FileType = 'poster' | 'backdrop' | 'title_card'
export const ALL_TYPES: FileType[] = ['poster', 'backdrop', 'title_card']

export type { SetSource }

/** Display names for the sites sets come from. */
export const SOURCE_LABEL: Record<SetSource, string> = {
  mediux: 'MediUX',
  posterdb: 'ThePosterDB',
}

/** Compact form for badges; TPDb is ThePosterDB's own shorthand. */
export const SOURCE_SHORT: Record<SetSource, string> = {
  mediux: 'MediUX',
  posterdb: 'TPDb',
}

/**
 * Source-qualified identity for a poster set. MediUX and ThePosterDB both
 * number their sets from 1, so ids collide across sources - anything that keys
 * a map, a React list, or applied history by set must use this, never `id`.
 *
 * @param s - Anything carrying a set id and its source.
 * @returns The "source:id" key.
 */
export function setKey(s: { id?: string; source: SetSource }): string {
  return `${s.source}:${s.id ?? ''}`
}

/**
 * Classifies a poster by what it targets in Plex.
 *
 * @param p - The poster to classify.
 * @returns backdrop for background art, title_card for episode art, else poster.
 */
export function posterFileType(p: PosterInfo): FileType {
  return posterKind(p)
}

export interface PosterGroup<T extends PosterInfo = PosterInfo> {
  label: string
  kind: FileType
  posters: T[]
}

/**
 * Groups posters into clean, non-mixed sections (Main / Season N / Title Cards
 * / Backdrop).
 *
 * @param posters - Posters from one set.
 * @returns Ordered groups, each holding posters of a single kind.
 */
export function groupPosters<T extends PosterInfo>(posters: T[]): PosterGroup<T>[] {
  const collectionArt: T[] = []
  const showPosters: T[] = []
  const seasonPosters = new Map<number, T[]>()
  const titleCards = new Map<number, T[]>()
  const backdrops: T[] = []

  const push = (map: Map<number, T[]>, key: number, p: T) => {
    const arr = map.get(key) ?? []
    arr.push(p)
    map.set(key, arr)
  }

  for (const p of posters) {
    if (p.isCollection) { collectionArt.push(p); continue }
    if (p.season === 'Backdrop') backdrops.push(p)
    else if (p.episode != null) push(titleCards, typeof p.season === 'number' ? p.season : 0, p)
    else if (typeof p.season === 'number') push(seasonPosters, p.season, p)
    else showPosters.push(p)
  }

  const groups: PosterGroup<T>[] = []
  if (collectionArt.length) groups.push({ label: 'Collection Poster', kind: 'poster', posters: collectionArt })
  if (showPosters.length) groups.push({ label: 'Main Poster', kind: 'poster', posters: showPosters })
  for (const s of [...seasonPosters.keys()].sort((a, b) => a - b))
    groups.push({ label: s === 0 ? 'Specials Poster' : `Season ${s} Poster`, kind: 'poster', posters: seasonPosters.get(s)! })
  for (const s of [...titleCards.keys()].sort((a, b) => a - b)) {
    const cards = titleCards.get(s)!.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
    groups.push({ label: s === 0 ? 'Title Cards' : `Season ${s} Title Cards`, kind: 'title_card', posters: cards })
  }
  if (backdrops.length) groups.push({ label: 'Backdrop', kind: 'backdrop', posters: backdrops })
  return groups
}

/** What the Library Browser is applying a set from: a movie or show, or a Plex Collection. */
export type ApplyContext = 'title' | 'collection'

/**
 * Folds a name to the form two collection names are compared in. Case,
 * accents, punctuation, a leading article, and a trailing "Collection" all
 * vary between Plex and the sites.
 *
 * @param s - A Plex collection title or a poster's title.
 * @returns The comparable form.
 */
export function collectionName(s: string): string {
  return s
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')
    .replace(/ collection$/, '')
}

/**
 * Names the Plex slot a poster fills: which item it lands on (the viewed
 * one, a member movie, or a collection) and which art slot there. Posters
 * sharing a key would overwrite each other, so only one of them is applied.
 *
 * @param p - The poster.
 * @param context - Whether a collection or a title is being viewed.
 * @returns The slot key.
 */
export function variantKey(p: PosterInfo, context: ApplyContext): string {
  const target = p.isCollection
    ? (context === 'collection' ? 'collection' : `collection:${collectionName(p.title)}`)
    : p.isCollectionMember
      ? `member:${p.tmdbId ?? `${p.title.toLowerCase()}|${p.year ?? ''}`}`
      : 'self'
  return `${target}|${posterSlot(p)}`
}

/**
 * Groups a set's posters by the slot they fill, in first-seen order.
 *
 * @param posters - Posters from one set.
 * @param context - Whether a collection or a title is being viewed.
 * @returns Slot key to the posters competing for it.
 */
export function variantClusters<T extends PosterInfo>(posters: T[], context: ApplyContext): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const p of posters) {
    const key = variantKey(p, context)
    const list = out.get(key)
    if (list) list.push(p)
    else out.set(key, [p])
  }
  return out
}

/**
 * The poster a slot gets when the user has not chosen one: the collection
 * poster named after the viewed title, else the first.
 *
 * @param cluster - Posters competing for one slot.
 * @param itemTitle - The viewed item's title.
 * @returns The poster to apply.
 */
export function defaultVariant<T extends PosterInfo>(cluster: T[], itemTitle?: string): T {
  if (itemTitle) {
    const want = collectionName(itemTitle)
    const named = cluster.find(p => p.isCollection && collectionName(p.title) === want)
    if (named) return named
  }
  return cluster[0]
}

/**
 * Keeps one poster per slot: the user's pick when it is still in the set,
 * else the default. Order is preserved.
 *
 * @param posters - Posters about to be applied.
 * @param context - Whether a collection or a title is being viewed.
 * @param picks - Chosen poster URL by slot key.
 * @param itemTitle - The viewed item's title, for the default collection poster.
 * @returns The posters to apply.
 */
export function resolveVariants<T extends PosterInfo>(posters: T[], context: ApplyContext, picks: Record<string, string> = {}, itemTitle?: string): T[] {
  const keep = new Set<T>()
  for (const [key, cluster] of variantClusters(posters, context)) {
    const picked = picks[key] ? cluster.find(p => p.url === picks[key]) : undefined
    keep.add(picked ?? defaultVariant(cluster, itemTitle))
  }
  return posters.filter(p => keep.has(p))
}

/** How movie posters from a collection set should be applied. */
export type MovieApplyScope = 'this' | 'all' | 'none'

/** Independent apply targets for a MediUX collection/boxset set. */
export interface SetApplyScope {
  movies: MovieApplyScope
  collectionPoster: boolean
}

/** Default scope: all library movies + collection poster when both exist. */
export function defaultSetApplyScope(hasCollectionArt: boolean, moviesInLib: number): SetApplyScope {
  return {
    movies: moviesInLib > 1 ? 'all' : moviesInLib >= 1 ? 'this' : 'none',
    collectionPoster: hasCollectionArt,
  }
}
