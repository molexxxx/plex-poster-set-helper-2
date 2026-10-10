import Fuse from 'fuse.js'

/** The fields a Plex search result needs for matching. */
export interface MatchCandidate
{
  title: string
  year?: number
  tmdbId?: string
}

/** What a poster says about the title it belongs to. */
export interface MatchWant
{
  title: string
  year?: number
  tmdbId?: string
}

/** Fuse scores above this are not a match at all. */
const FUZZY_THRESHOLD = 0.35
/**
 * Added to a candidate's fuzzy score when its year differs from the wanted
 * one. Near-identical titles score close to zero, so this makes the same-year
 * entry win unless its title is clearly the worse fit.
 */
const YEAR_PENALTY = 0.1

/**
 * Normalizes a title for tolerant comparison: lowercased, diacritics stripped,
 * and all punctuation collapsed to single spaces. Lets "The Librarian: ..." and
 * "The Librarian - ..." compare equal regardless of how Plex stored the title.
 *
 * @param s - Raw title.
 * @returns The normalized form.
 */
export function normTitle(s: string): string
{
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Picks the library item a poster belongs to from Plex search results.
 *
 * Order: the TMDB id when both sides carry one, then an exact normalized title
 * (with the year, when known), then the closest fuzzy title among candidates
 * within a year of the wanted year, with a penalty for a different year. A
 * franchise often holds a miniseries, a reboot, and a spin-off under near
 * identical names a year apart, such as "Battlestar Galactica" (2003) and
 * "Battlestar Galactica (2003)" (2004); the penalty keeps a set on the entry
 * whose year it names.
 *
 * @param candidates - Search results from the eligible libraries.
 * @param want - Title, year, and TMDB id from the poster.
 * @returns The best candidate, or null when nothing qualifies.
 */
export function pickLibraryMatch<T extends MatchCandidate>(candidates: T[], want: MatchWant): T | null
{
  if (want.tmdbId)
  {
    const byId = candidates.find(c => c.tmdbId === want.tmdbId)
    if (byId) return byId
  }

  const wanted = normTitle(want.title)
  const year = want.year
  const exact = candidates.find(c => normTitle(c.title) === wanted && (year == null || c.year === year))
  if (exact) return exact
  if (year == null)
  {
    const exactTitle = candidates.find(c => normTitle(c.title) === wanted)
    if (exactTitle) return exactTitle
  }

  const scoped = year == null ? candidates : candidates.filter(c => c.year != null && Math.abs(c.year - year) <= 1)
  if (!scoped.length) return null
  const fuse = new Fuse(scoped, { keys: ['title'], threshold: FUZZY_THRESHOLD, includeScore: true })
  let best: { item: T; score: number } | null = null
  for (const r of fuse.search(want.title))
  {
    const score = (r.score ?? 1) + (year != null && r.item.year !== year ? YEAR_PENALTY : 0)
    if (!best || score < best.score) best = { item: r.item, score }
  }
  return best?.item ?? null
}
