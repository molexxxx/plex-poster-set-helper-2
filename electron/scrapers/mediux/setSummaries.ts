import { stripSuffix } from '../../services/titleParse'
import type { PosterInfo, PosterSetSummary } from '../../ipc/types'
import type { UserCreated, MediuxSet, Fallback } from './mediuxTypes'
import { ASSET_BASE, extractYear, memberIdIndex, fileToInfo } from './posterFiles'

/**
 * Lowercases a name and strips a trailing " collection" word in linear time.
 * Avoids the `/\s+collection$/` form, whose `\s+` backtracks quadratically on a
 * long whitespace-only input.
 *
 * @param s - Collection name to normalise.
 * @returns The lowercased name without a trailing whitespace + "collection".
 */
export function normalizeCollectionName(s: string): string
{
  const lower = s.toLowerCase().trim()
  if (!lower.endsWith('collection')) return lower
  const head = lower.slice(0, lower.length - 'collection'.length)
  return /\s$/.test(head) ? head.trimEnd() : lower
}

/**
 * Builds a small avatar thumbnail URL for a set's uploader.
 *
 * @param uc - The set's user_created node.
 * @returns The asset URL, or undefined when there's no avatar.
 */
function avatarUrl(uc?: UserCreated | null): string | undefined
{
  const a = uc?.avatar
  const id = typeof a === 'string' ? a : a?.id
  return id ? `${ASSET_BASE}/${id}?width=48&height=48&quality=80&format=webp` : undefined
}

/**
 * Converts a raw MediUX set into the library-browser summary.
 *
 * @param set - The raw set.
 * @param allowed - fileTypes to include in the posters list.
 * @param fb - Title/year fallback for files lacking refs.
 * @returns Counts, preview, posters, uploader info, and detected media type.
 */
export function setToSummary(set: MediuxSet, allowed: Set<string>, fb: Fallback): PosterSetSummary
{
  const memberIds = memberIdIndex(set)
  const posters = (set.files ?? [])
    .map(f => fileToInfo(f, set, allowed, fb, memberIds))
    .filter((p): p is PosterInfo => p !== null)

  let posterCount = 0, backdropCount = 0, titleCardCount = 0
  let preview: string | undefined
  let hasEpisodic = false, hasMovieRef = false
  for (const f of set.files ?? [])
  {
    const ft = (f.fileType ?? '').toLowerCase().replace(/[-\s]/g, '_')
    if (ft === 'poster') { posterCount++; if (!preview) preview = `${ASSET_BASE}/${f.id}?width=400&quality=80&format=webp` }
    else if (ft === 'backdrop') backdropCount++
    else if (ft === 'title_card') titleCardCount++
    if (ft === 'title_card' || f.episode_id != null || f.season_id != null || f.show_id != null) hasEpisodic = true
    if (f.movie_id != null) hasMovieRef = true
  }
  if (!preview && posters[0]) preview = posters[0].thumbUrl

  // Detect media type so library matching only considers same-type items.
  // Title cards / season / episode / show refs mean a TV show; otherwise a
  // movie reference (set.movie or a file movie_id) means a movie.
  const mediaType: 'movie' | 'show' | undefined =
    (set.show || hasEpisodic) ? 'show'
    : (set.movie || hasMovieRef) ? 'movie'
    : undefined

  return {
    id: String(set.id),
    source: 'mediux',
    setName: set.set_name ?? set.name ?? `Set ${set.id}`,
    uploader: set.user_created?.username ?? 'Unknown',
    uploaderAvatar: avatarUrl(set.user_created),
    setUrl: `https://mediux.pro/sets/${set.id}`,
    posterCount,
    backdropCount,
    titleCardCount,
    previewUrl: preview,
    posters,
    ...(mediaType ? { mediaType } : {}),
  }
}

/**
 * Sums the download counts on a set's files. Movie and show pages carry them;
 * collection and set pages do not, so a set read from one of those gets no
 * total rather than a misleading 0.
 *
 * @param set - The raw set.
 * @returns The total, or undefined when no file carries a count.
 */
export function setDownloads(set: MediuxSet): number | undefined
{
  let total: number | undefined
  for (const f of set.files ?? [])
  {
    const count = f.downloads_func?.count
    if (count == null || !Number.isFinite(Number(count))) continue
    total = (total ?? 0) + Number(count)
  }
  return total
}

/**
 * A set's own /sets/{id} page carries no download counts, so an enriched copy
 * takes them from the browse page's files, matched by file id.
 *
 * @param full - The set as its own page lists it.
 * @param original - The same set from the browse page.
 * @returns `full`, its files carrying the browse page's counts.
 */
export function keepDownloads(full: MediuxSet, original: MediuxSet): MediuxSet
{
  const counts = new Map((original.files ?? []).map(f => [f.id, f.downloads_func]))
  if (!full.files) return full
  return {
    ...full,
    files: full.files.map(f => (f.downloads_func || !counts.get(f.id) ? f : { ...f, downloads_func: counts.get(f.id) })),
  }
}

/**
 * Numbers sets most downloaded first, keeping page order between equal counts.
 *
 * @param sets - One title's sets, in page order.
 * @returns The same sets carrying popularityRank.
 */
export function rankByDownloads(sets: PosterSetSummary[]): PosterSetSummary[]
{
  const order = sets
    .map((s, i) => ({ i, d: s.downloads ?? 0 }))
    .sort((a, b) => b.d - a.d || a.i - b.i)
  const rank = new Array<number>(sets.length)
  order.forEach(({ i }, r) => { rank[i] = r })
  return sets.map((s, i) => ({ ...s, popularityRank: rank[i] }))
}

/**
 * Strips the per-file suffix MediUX appends to a file title, such as
 * " - S1 E3", " - Season 2", " - Specials", or " - Backdrop".
 *
 * @param title - The file's title string.
 * @returns The title without the suffix.
 */
export function stripFileSuffix(title: string): string
{
  return stripSuffix(title, /-\s*(?:S\d{1,3}\s*E\d{1,4}|Season\s+\d{1,3}|Specials|Backdrop)\s*$/i).trim()
}

/**
 * Parses "Name (Year)" from a title, allowing trailing words such as "Set",
 * "Title Cards", or "Collection" after the year.
 *
 * @param raw - A file title or set name.
 * @returns The name and year, or null when there is no year.
 */
export function parseNameYear(raw: string): Fallback | null
{
  const m = /\((\d{4})\)/.exec(raw)
  const title = m ? raw.slice(0, m.index).trim() : ''
  return m && title ? { title, year: parseInt(m[1]) } : null
}

/**
 * Derives a {title, year} for a set that lacks denormalised show/movie objects
 * (creator pages). A poster file is titled "Name (Year)" and any other file
 * "Name (Year) - S1 E1", so a set with only title cards still names its show;
 * the set name is the last resort.
 *
 * @param set - The raw set.
 * @returns The best title/year guess, possibly empty.
 */
export function deriveSetFallback(set: MediuxSet): Fallback
{
  const direct =
    set.show?.name ?? set.show?.title ?? set.movie?.title ?? set.collection?.collection_name
  if (direct)
  {
    return { title: direct, year: extractYear(set.movie?.release_date ?? set.show?.first_air_date) }
  }
  const files = set.files ?? []
  const named = files.find(f => (f.fileType ?? '').toLowerCase().includes('poster') && f.title) ?? files.find(f => f.title)
  if (named?.title)
  {
    const parsed = parseNameYear(stripFileSuffix(named.title))
    if (parsed) return parsed
  }
  const raw = set.set_name ?? set.name
  if (!raw) return {}
  return parseNameYear(raw) ?? { title: stripSuffix(raw, /(?:Collection|Set|Title\s*Cards|Titlecards|Posters|Backdrops)$/i, true).trim() }
}
