import type { PosterInfo } from '../../electron/ipc/types'
import { posterKind } from '../../electron/services/scheduleUtils'

export type FileType = 'poster' | 'backdrop' | 'title_card'
export const ALL_TYPES: FileType[] = ['poster', 'backdrop', 'title_card']

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
