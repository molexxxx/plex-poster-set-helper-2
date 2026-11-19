import { splitTrailingYear, stripSuffix } from '../../services/titleParse'
import type { PosterInfo } from '../../ipc/types'
import type { MediuxFile, MediuxSet, Fallback } from './mediuxTypes'

/** MediUX's asset endpoint; a file id appended to it is the file's image. */
export const ASSET_BASE = 'https://api.mediux.pro/assets'

/**
 * Extracts the 4-digit year from a date string like "1999-11-19".
 *
 * @param d - Date string, or nothing.
 * @returns The year, or undefined.
 */
export function extractYear(d?: string | null): number | undefined
{
  if (!d) return undefined
  const m = d.match(/^(\d{4})/)
  return m ? parseInt(m[1]) : undefined
}

/**
 * Parses the episode number from a title-card title like "Show (2026) - S1 E3".
 *
 * @param title - The file's title string.
 * @returns The episode number, or undefined.
 */
function parseEpisodeFromTitle(title?: string | null): number | undefined
{
  if (!title) return undefined
  const m = title.match(/S\d{1,3}\s*E(\d{1,4})/i) ?? title.match(/ E(\d{1,4})\b/i)
  return m ? parseInt(m[1]) : undefined
}

/**
 * Parses a movie poster's "Title (Year)" file name, e.g. "Toy Story 2 (1999)".
 * Used for collection-member posters where the only per-movie signal is the
 * file title.
 *
 * @param raw - The file's title string.
 * @returns Parsed title and optional year, or null for blank input.
 */
export function parseTitleYear(raw?: string | null): { title: string; year?: number } | null
{
  if (!raw) return null
  const clean = raw.trim()
  if (!clean) return null
  return splitTrailingYear(clean) ?? { title: clean }
}

/**
 * Strips a trailing artwork-type suffix from a file title. Collection-set
 * backdrops name their target movie in the title with a " - Backdrop" suffix
 * (e.g. "300: Rise of an Empire (2014) - Backdrop"); removing it leaves the
 * "Title (Year)" parseTitleYear expects.
 *
 * @param title - The file's title string.
 * @returns The title without the suffix.
 */
function stripArtTypeSuffix(title?: string | null): string
{
  return stripSuffix(title ?? '', /-\s*Backdrop\s*$/i).trim()
}

/**
 * Builds the lookup key for the collection-member id index: a movie's parsed
 * title and year, normalised so a poster ("300 (2007)") and a backdrop
 * ("300 (2007) - Backdrop") for the same movie collide.
 *
 * @param title - Parsed movie title.
 * @param year - Parsed release year, when present.
 * @returns The composite key.
 */
function memberKey(title: string, year?: number): string
{
  return `${title.toLowerCase().trim()}|${year ?? ''}`
}

/**
 * Indexes a collection set's per-movie TMDB ids by "title|year". Only poster
 * files carry a file.movie_id; their sibling backdrops/title cards for the same
 * movie don't, so this lets those files recover the exact id (and match Plex by
 * id like posters) from the poster that does carry it.
 *
 * @param set - The collection set.
 * @returns Map of memberKey -> TMDB id, empty for non-collection sets.
 */
export function memberIdIndex(set: MediuxSet): Map<string, string>
{
  const map = new Map<string, string>()
  if (!set.collection) return map
  for (const f of set.files ?? [])
  {
    const id = f.movie_id?.id
    if (id == null) continue
    const parsed = parseTitleYear(stripArtTypeSuffix(f.title))
    if (parsed) map.set(memberKey(parsed.title, parsed.year), String(id))
  }
  return map
}

/**
 * Parses the season number from a title-card title like "Show (2026) - S1 E1".
 * Creator-page title cards lack structured episode_id refs, so the "S<n>" token
 * in the file title is the only season signal available.
 *
 * @param title - The file's title string.
 * @returns The season number, or undefined.
 */
function parseSeasonFromTitle(title?: string | null): number | undefined
{
  if (!title) return undefined
  const m = title.match(/\bS(\d{1,3})\s*E\d{1,4}/i)
  return m ? parseInt(m[1]) : undefined
}

/**
 * Parses the season number from a season-poster title like "Show (2026) - Season 1"
 * (creator-page posters carry the season in the title, not a season_id).
 *
 * @param title - The file's title string.
 * @returns The season number (0 for Specials), or undefined for a show-level
 *   poster ("Show (2026)") so it stays the main poster.
 */
function parseSeasonPosterFromTitle(title?: string | null): number | undefined
{
  if (!title) return undefined
  const m = title.match(/-\s*Season\s+(\d{1,3})\b/i)
  if (m) return parseInt(m[1])
  if (/-\s*Specials\b/i.test(title)) return 0
  return undefined
}

/**
 * Resolves a file's season number from its season ref, or by id lookup in
 * set.show.seasons.
 *
 * @param file - The set file carrying season references.
 * @param set - The owning set, used for the id lookup.
 * @returns The season number, or undefined.
 */
function seasonNumberFor(file: MediuxFile, set: MediuxSet): number | undefined
{
  if (file.season_id?.season_number != null) return file.season_id.season_number
  const sid = file.season_id?.id
  if (sid != null && set.show?.seasons)
  {
    const match = set.show.seasons.find(s => String(s.id) === String(sid))
    if (match?.season_number != null) return match.season_number
  }
  return undefined
}

/**
 * Maps a MediUX file into a PosterInfo.
 *
 * @param file - The set file to convert.
 * @param set - The owning set, for denormalised title/year data.
 * @param allowed - Enabled fileTypes; others are dropped.
 * @param fb - Title/year fallback when the set lacks denormalised info.
 * @param memberIds - Per-movie TMDB ids for a collection set, so files without
 *   their own movie_id (backdrops/title cards) can recover one by title/year.
 * @returns The poster, or null when filtered out or unusable.
 */
export function fileToInfo(file: MediuxFile, set: MediuxSet, allowed: Set<string>, fb: Fallback, memberIds?: Map<string, string>): PosterInfo | null
{
  const ft = (file.fileType ?? '').toLowerCase().replace(/[-\s]/g, '_')
  if (!allowed.has(ft)) return null
  if (!file.id) return null

  // Full-res original for upload; small webp for the UI grid
  const url = `${ASSET_BASE}/${file.id}`
  const thumbUrl = `${ASSET_BASE}/${file.id}?width=300&quality=80&format=webp`

  // Inside a TMDB-collection set a file targets either the collection itself or
  // one specific movie. Posters carry a file.movie_id, but backdrops/title cards
  // usually don't - their only per-movie signal is file.title
  // ("300: Rise of an Empire (2014) - Backdrop"). Strip the artwork-type suffix
  // and parse "Title (Year)" so every file routes to its movie. A file with a
  // collection_id, or whose name carries no movie year, is the collection's own
  // art and stays matched by collection name.
  //
  // Edge case: when NO file in the set carries an explicit movie_id (memberIds is
  // empty), the title-year heuristic cannot distinguish a collection poster titled
  // "Tron (1982)" from a movie-member poster. Treat all files as collection art in
  // that situation rather than silently misrouting the only poster to a movie.
  const parsedFileTitle = set.collection ? parseTitleYear(stripArtTypeSuffix(file.title)) : null
  const isCollectionArt =
    !!set.collection && !set.movie && !set.show &&
    !file.movie_id && !file.show_id &&
    (!!file.collection_id || parsedFileTitle == null || parsedFileTitle.year == null || !memberIds?.size)
  const collectionMember = !!set.collection && !isCollectionArt
  const fileParsed = collectionMember ? parsedFileTitle : null

  // A member backdrop/title card has no movie_id of its own; recover it from the
  // sibling poster for the same movie so it matches Plex by id, not just title.
  const recoveredId = collectionMember && !file.movie_id && fileParsed
    ? memberIds?.get(memberKey(fileParsed.title, fileParsed.year))
    : undefined

  const title =
    file.movie_id?.title ??
    file.show_id?.name ?? file.show_id?.title ??
    fileParsed?.title ??
    set.show?.name ?? set.show?.title ??
    set.movie?.title ??
    file.collection_id?.collection_name ??
    set.collection?.collection_name ??
    set.name ??
    fb.title ?? 'Unknown'

  const year = extractYear(
    file.movie_id?.release_date ??
    set.movie?.release_date ??
    set.show?.first_air_date,
  ) ?? fileParsed?.year ?? fb.year

  let season: PosterInfo['season'] | undefined
  let episode: number | undefined

  if (ft === 'backdrop')
  {
    season = 'Backdrop'
  }
  else if (ft === 'title_card')
  {
    // Prefer structured refs; fall back to the "S<n> E<n>" tokens in file.title
    // (creator-page title cards have no episode_id, only the title string)
    season  = file.episode_id?.season_id?.season_number ?? seasonNumberFor(file, set) ?? parseSeasonFromTitle(file.title)
    episode = file.episode_id?.episode_number ?? parseEpisodeFromTitle(file.title)
  }
  else if (ft === 'poster')
  {
    if (file.season_id != null)
    {
      const sn = seasonNumberFor(file, set)
      if (sn != null) season = sn
    }
    else
    {
      // Creator-page season posters encode the season in the title
      // ("Show (2026) - Season 1"); a bare "Show (2026)" stays the show poster
      const sn = parseSeasonPosterFromTitle(file.title)
      if (sn != null) season = sn
    }
  }

  // TMDB id of the movie/show this poster targets, so matching to Plex can prefer
  // an exact id (same as the Library Browser) instead of guessing by title/year.
  // Collection art has no single title, so it stays matched by collection name.
  const tmdbId = isCollectionArt
    ? undefined
    : file.movie_id?.id ?? recoveredId ?? file.show_id?.id ?? set.movie?.id ?? set.show?.id ?? undefined

  return {
    title, url, thumbUrl, source: 'mediux', year, season, episode,
    // A collection-set file that targets one specific movie: flag it so the
    // apply path routes it to that movie (not just the viewed item).
    ...(collectionMember ? { isCollectionMember: true } : {}),
    ...(tmdbId != null ? { tmdbId: String(tmdbId) } : {}),
    // Collection art (e.g. "Toy Story Collection") applies to a Plex Collection
    // object, matched by the collection name (= title), not a movie/show.
    ...(isCollectionArt ? { isCollection: true } : {}),
  }
}
