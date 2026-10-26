import type { PosterSetSummary, SetSource } from '../../electron/ipc/types'
import { posterFileType, SOURCE_SHORT, type FileType } from './posterGroups'
import type { CreatorState } from './creatorPrefs'

/**
 * Dropdown value for one uploader. The site travels with the name: the same
 * name on MediUX and ThePosterDB is two people.
 *
 * @param s - Anything carrying an uploader and their site.
 * @returns The "source:name" value.
 */
export function uploaderValue(s: Pick<PosterSetSummary, 'source' | 'uploader'>): string {
  return `${s.source}:${s.uploader}`
}

/** One creator in the uploader dropdown. */
export interface UploaderOption {
  value: string
  /** The name, with the site appended when the same name appears on both. */
  label: string
}

export interface ArrangeOptions {
  source: SetSource | 'all'
  /** Chosen uploader value, or "all". */
  uploader: string
  types: Set<FileType>
  /** Whether hidden creators' sets are revealed. */
  showHidden: boolean
  stateOf: (source: SetSource, uploader: string) => CreatorState
}

export interface ArrangedSets {
  sourceCounts: Record<SetSource, number>
  /** The chosen source, or "all" when that site contributed nothing. */
  activeSource: SetSource | 'all'
  /** Sets within the active source, before the uploader and type filters. */
  sourceSets: PosterSetSummary[]
  /** Creators to choose from: followed first, then the rest alphabetically; hidden ones only when revealed. */
  uploaders: UploaderOption[]
  /** The chosen uploader, or "all" when the choice is no longer in the list. */
  activeUploader: string
  /** Followed creators first, revealed hidden sets last, otherwise arrival order. */
  visibleSets: PosterSetSummary[]
  /** Sets kept back by hidden creators, among those the other filters allow. */
  hiddenCount: number
}

const RANK: Record<CreatorState, number> = { followed: 0, none: 1, hidden: 2 }

/**
 * Most downloaded first. The two sites' counts can't be compared (ThePosterDB
 * shows none), so "All" alternates them: each site's #1, then each #2, and so
 * on, MediUX first on a tie. Sets without a rank (MediUX collection browsing)
 * keep the old alphabetical order after the ranked ones.
 *
 * @param a - A set from either site.
 * @param b - Another set from either site.
 * @returns A negative number when `a` sorts first, positive when `b` does.
 */
export function byPopularity(a: PosterSetSummary, b: PosterSetSummary): number {
  const ra = a.popularityRank ?? Infinity, rb = b.popularityRank ?? Infinity
  if (ra !== rb) return ra < rb ? -1 : 1
  return a.source.localeCompare(b.source) || a.uploader.localeCompare(b.uploader)
}

/**
 * Applies the sets panel's filters and the creator preferences to a title's
 * sets, in one place so the dropdown, the list and the hidden count always
 * agree.
 *
 * @param sets - Every set the sites returned.
 * @param opts - The panel's filter state and the creator lookup.
 * @returns What to render; `sets` is not modified.
 */
export function arrangeSets(sets: PosterSetSummary[], opts: ArrangeOptions): ArrangedSets {
  const sourceCounts: Record<SetSource, number> = { mediux: 0, posterdb: 0 }
  for (const s of sets) sourceCounts[s.source]++
  const activeSource = opts.source !== 'all' && sourceCounts[opts.source] === 0 ? 'all' : opts.source
  const sourceSets = activeSource === 'all' ? sets : sets.filter(s => s.source === activeSource)
  const stateOf = (s: PosterSetSummary) => opts.stateOf(s.source, s.uploader)

  const byValue = new Map<string, { s: PosterSetSummary; rank: number }>()
  const sitesByName = new Map<string, Set<SetSource>>()
  for (const s of sourceSets) {
    const st = stateOf(s)
    if (st === 'hidden' && !opts.showHidden) continue
    const value = uploaderValue(s)
    const rank = RANK[st]
    const prev = byValue.get(value)
    if (!prev || rank < prev.rank) byValue.set(value, { s, rank })
    const lower = s.uploader.toLowerCase()
    let sites = sitesByName.get(lower)
    if (!sites) sitesByName.set(lower, (sites = new Set()))
    sites.add(s.source)
  }
  const uploaders = [...byValue.values()]
    .sort((a, b) => a.rank - b.rank || a.s.uploader.localeCompare(b.s.uploader) || a.s.source.localeCompare(b.s.source))
    .map(({ s }) => ({
      value: uploaderValue(s),
      label: (sitesByName.get(s.uploader.toLowerCase())?.size ?? 1) > 1 ? `${s.uploader} · ${SOURCE_SHORT[s.source]}` : s.uploader,
    }))
  const activeUploader = opts.uploader !== 'all' && !uploaders.some(u => u.value === opts.uploader) ? 'all' : opts.uploader

  const byUploader = activeUploader === 'all' ? sourceSets : sourceSets.filter(s => uploaderValue(s) === activeUploader)
  // Sets with nothing to apply under the type chips are dropped, so the chips
  // narrow the list instead of only dimming art.
  const matching = byUploader.filter(s => s.posters.some(p => opts.types.has(posterFileType(p))))
  const hiddenCount = matching.filter(s => stateOf(s) === 'hidden').length
  const shown = opts.showHidden ? matching : matching.filter(s => stateOf(s) !== 'hidden')
  const visibleSets = [...shown].sort((a, b) => RANK[stateOf(a)] - RANK[stateOf(b)])

  return { sourceCounts, activeSource, sourceSets, uploaders, activeUploader, visibleSets, hiddenCount }
}
