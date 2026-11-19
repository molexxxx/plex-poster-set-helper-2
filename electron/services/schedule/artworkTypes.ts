import type { ArtworkType, PosterInfo, ScheduledJob } from '../../ipc/types'

/**
 * Classifies a poster by the MediUX file type filter it falls under.
 *
 * @param p - The poster.
 * @returns backdrop for background art, title_card for episode art, else poster.
 */
export function posterKind(p: Pick<PosterInfo, 'season' | 'episode'>): ArtworkType
{
  if (p.season === 'Backdrop') return 'backdrop'
  if (p.episode != null) return 'title_card'
  return 'poster'
}

/** Every artwork type, in display order. */
export const ARTWORK_TYPES: readonly ArtworkType[] = ['poster', 'backdrop', 'title_card']

const ARTWORK_TYPE_NAMES: Record<ArtworkType, string> = { poster: 'posters', backdrop: 'backdrops', title_card: 'title cards' }

/**
 * Reads a list of artwork types from untrusted input.
 *
 * @param raw - Value to read.
 * @returns The known types in display order without repeats, or undefined when the value is not a list.
 */
export function parseArtworkTypes(raw: unknown): ArtworkType[] | undefined
{
  if (!Array.isArray(raw)) return undefined
  return ARTWORK_TYPES.filter(t => raw.includes(t))
}

/**
 * Tells whether two lists pick the same artwork types, in any order.
 *
 * @param a - First list.
 * @param b - Second list.
 * @returns true when both hold the same types.
 */
export function sameArtworkTypes(a: Iterable<string>, b: Iterable<string>): boolean
{
  const left = new Set(a)
  const right = new Set(b)
  return left.size === right.size && [...left].every(t => right.has(t))
}

/**
 * The types a scheduled job applies.
 *
 * @param job - The job.
 * @param defaults - Types picked in Settings.
 * @returns The job's own types, or the Settings types when it has none.
 */
export function jobArtworkTypes(job: Pick<ScheduledJob, 'assetTypes'>, defaults: readonly ArtworkType[] | undefined): ArtworkType[]
{
  return [...(job.assetTypes ?? defaults ?? ARTWORK_TYPES)]
}

/**
 * The types to store as a choice made on top of Settings. A choice that
 * matches Settings stores nothing, so it keeps following Settings.
 *
 * @param picked - Types the user picked.
 * @param defaults - Types picked in Settings.
 * @returns The picked types in display order, or undefined when they match Settings.
 */
export function artworkOverride(picked: Iterable<string>, defaults: Iterable<string>): ArtworkType[] | undefined
{
  const chosen = new Set(picked)
  const list = ARTWORK_TYPES.filter(t => chosen.has(t))
  return sameArtworkTypes(list, defaults) ? undefined : list
}

/**
 * Names artwork types for a sentence.
 *
 * @param types - Types to name.
 * @returns A phrase such as "posters, backdrops, and title cards", or "no artwork" for none.
 */
export function describeArtworkTypes(types: Iterable<string>): string
{
  const chosen = new Set(types)
  const words = ARTWORK_TYPES.filter(t => chosen.has(t)).map(t => ARTWORK_TYPE_NAMES[t])
  if (!words.length) return 'no artwork'
  if (words.length <= 2) return words.join(' and ')
  return `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`
}
