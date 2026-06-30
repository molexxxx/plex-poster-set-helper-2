import { BaseScraper, USER_AGENTS, pick, sleepConfig, mapPool } from './baseScraper'
import { Logger } from '../services/logger'
import { ConfigService } from '../services/config'
import type { PosterInfo, MediuxSetSummary, MediuxUserSet } from '../ipc/types'
import type { Page } from 'playwright'

/*
 * MediUX embeds set data inside the Next.js App Router RSC flight payload
 * (self.__next_f.push([...]) inline <script> tags) - NOT in __NEXT_DATA__ and
 * NOT in the public Directus API (which is now 403). The data is server-rendered
 * into the raw HTML, so a plain fetch works; a browser is only a fallback.
 *
 * Approach ported from the Python project:
 * github.com/tonywied17/plex-poster-set-helper-2 (src/scrapers/mediux_scraper.py)
 */

const ASSET_BASE = 'https://api.mediux.pro/assets'

interface SeasonEntry { id?: string | number; season_number?: number }

interface Show {
  id?: string | number
  name?: string
  title?: string
  first_air_date?: string
  seasons?: SeasonEntry[]
}

interface Movie {
  id?: string | number
  title?: string
  release_date?: string
}

interface Collection {
  id?: string | number
  collection_name?: string
  movies?: Movie[]
}

interface SeasonRef  { id?: string | number; season_number?: number }
interface EpisodeRef { id?: string | number; episode_number?: number; season_id?: SeasonRef }
interface ShowRef    { id?: string | number; name?: string; title?: string }
interface MovieRef   { id?: string | number; title?: string; release_date?: string }

interface MediuxFile {
  id: string
  fileType: string
  title?: string | null
  show_id?:       ShowRef | null
  season_id?:     SeasonRef | null
  episode_id?:    EpisodeRef | null
  movie_id?:      MovieRef | null
  collection_id?: { id?: string | number; collection_name?: string } | null
}

interface UserCreated {
  username?: string
  avatar?: string | { id?: string } | null
}

interface MediuxSet {
  id: number | string
  name?: string
  set_name?: string
  date_updated?: string
  user_created?: UserCreated | null
  show?:       Show | null
  movie?:      Movie | null
  collection?: Collection | null
  files?:      MediuxFile[]
}

/**
 * Cleans an RSC flight-payload script and parses it to JSON. Faithful port of
 * the Python parse_string_to_dict cleaning:
 * 1. remove all `\\\"` (3 backslashes + quote) sequences
 * 2. strip every remaining backslash
 * 3. replace `u0026` with `&`
 * 4. slice from first `{` to last `}` and JSON.parse
 *
 * @param scriptText - Raw text of one inline script tag.
 * @returns The parsed object, or null when nothing parses.
 */
function cleanAndParse(scriptText: string): unknown | null {
  const cleaned = scriptText
    .replace(/\\\\\\"/g, '')   // matches \ \ \ "
    .replace(/\\/g, '')        // strip remaining backslashes
    .replace(/u0026/g, '&')

  const start = cleaned.indexOf('{')
  const end   = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Walks an arbitrary parsed object and collects every "set-like" node:
 * an object with a files[] array whose entries have id + fileType.
 *
 * @param root - Parsed RSC payload of unknown shape.
 * @returns The unique sets found, in discovery order.
 */
function collectSets(root: unknown): MediuxSet[] {
  const found: MediuxSet[] = []
  const seen = new Set<string | number>()

  const looksLikeSet = (o: Record<string, unknown>): boolean => {
    const files = o['files']
    return Array.isArray(files) && files.some(
      f => f && typeof f === 'object' && 'id' in f && 'fileType' in f,
    )
  }

  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 10) return

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }

    const obj = node as Record<string, unknown>
    if (looksLikeSet(obj)) {
      const set = obj as unknown as MediuxSet
      if (!seen.has(set.id)) {
        seen.add(set.id)
        found.push(set)
      }
      // Don't descend into a set's own files
      return
    }

    for (const value of Object.values(obj)) walk(value, depth + 1)
  }

  walk(root, 0)
  return found
}

/**
 * Parses every script's text and collects the sets across them.
 *
 * @param scriptTexts - Inline script contents from the page.
 * @returns Unique sets found across all matching scripts.
 */
function setsFromScripts(scriptTexts: string[]): MediuxSet[] {
  const all: MediuxSet[] = []
  const seen = new Set<string | number>()

  for (const text of scriptTexts) {
    if (!text) continue
    // Must reference both files and set; skip the breadcrumb "Set Link\" script
    if (!text.includes('files') || !text.includes('set')) continue
    if (text.includes('Set Link\\')) continue

    const parsed = cleanAndParse(text)
    if (!parsed) continue

    for (const set of collectSets(parsed)) {
      if (!seen.has(set.id)) {
        seen.add(set.id)
        all.push(set)
      }
    }
  }

  return all
}

/**
 * Lowercases a name and strips a trailing " collection" word in linear time.
 * Avoids the `/\s+collection$/` form, whose `\s+` backtracks quadratically on a
 * long whitespace-only input.
 *
 * @param s - Collection name to normalise.
 * @returns The lowercased name without a trailing whitespace + "collection".
 */
function normalizeCollectionName(s: string): string {
  const lower = s.toLowerCase().trim()
  if (!lower.endsWith('collection')) return lower
  const head = lower.slice(0, lower.length - 'collection'.length)
  return /\s$/.test(head) ? head.trimEnd() : lower
}

/**
 * Extracts the 4-digit year from a date string like "1999-11-19".
 *
 * @param d - Date string, or nothing.
 * @returns The year, or undefined.
 */
function extractYear(d?: string | null): number | undefined {
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
function parseEpisodeFromTitle(title?: string | null): number | undefined {
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
function parseTitleYear(raw?: string | null): { title: string; year?: number } | null {
  if (!raw) return null
  const clean = raw.trim()
  if (!clean) return null
  const m = clean.match(/^(.*?)\s*\((\d{4})\)\s*$/)
  if (m) return { title: m[1].trim(), year: parseInt(m[2]) }
  return { title: clean }
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
function stripArtTypeSuffix(title?: string | null): string {
  return (title ?? '').replace(/\s*-\s*Backdrop\s*$/i, '').trim()
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
function memberKey(title: string, year?: number): string {
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
function memberIdIndex(set: MediuxSet): Map<string, string> {
  const map = new Map<string, string>()
  if (!set.collection) return map
  for (const f of set.files ?? []) {
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
function parseSeasonFromTitle(title?: string | null): number | undefined {
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
function parseSeasonPosterFromTitle(title?: string | null): number | undefined {
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
function seasonNumberFor(file: MediuxFile, set: MediuxSet): number | undefined {
  if (file.season_id?.season_number != null) return file.season_id.season_number
  const sid = file.season_id?.id
  if (sid != null && set.show?.seasons) {
    const match = set.show.seasons.find(s => String(s.id) === String(sid))
    if (match?.season_number != null) return match.season_number
  }
  return undefined
}

/**
 * Fallback metadata for pages (shows/boxsets) that don't denormalise show/movie
 * info into each set - derived from the page's og:title ("Name (Year)").
 */
interface Fallback { title?: string; year?: number }

/**
 * Parses the page's og:title meta tag into a title/year fallback.
 *
 * @param html - Raw page HTML.
 * @returns Whatever title/year could be parsed.
 */
function parseOgTitle(html: string): Fallback {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)
  if (!m?.[1]) return {}
  const raw = m[1].trim()
  const ym = raw.match(/^(.*?)\s*\((\d{4})\)\s*$/)
  if (ym) return { title: ym[1].trim(), year: parseInt(ym[2]) }
  return { title: raw }
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
function fileToInfo(file: MediuxFile, set: MediuxSet, allowed: Set<string>, fb: Fallback, memberIds?: Map<string, string>): PosterInfo | null {
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
  const parsedFileTitle = set.collection ? parseTitleYear(stripArtTypeSuffix(file.title)) : null
  const isCollectionArt =
    !!set.collection && !set.movie && !set.show &&
    !file.movie_id && !file.show_id &&
    (!!file.collection_id || parsedFileTitle == null || parsedFileTitle.year == null)
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

  if (ft === 'backdrop') {
    season = 'Backdrop'
  } else if (ft === 'title_card') {
    // Prefer structured refs; fall back to the "S<n> E<n>" tokens in file.title
    // (creator-page title cards have no episode_id, only the title string)
    season  = file.episode_id?.season_id?.season_number ?? seasonNumberFor(file, set) ?? parseSeasonFromTitle(file.title)
    episode = file.episode_id?.episode_number ?? parseEpisodeFromTitle(file.title)
  } else if (ft === 'poster') {
    if (file.season_id != null) {
      const sn = seasonNumberFor(file, set)
      if (sn != null) season = sn
    } else {
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

/**
 * Builds a small avatar thumbnail URL for a set's uploader.
 *
 * @param uc - The set's user_created node.
 * @returns The asset URL, or undefined when there's no avatar.
 */
function avatarUrl(uc?: UserCreated | null): string | undefined {
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
function setToSummary(set: MediuxSet, allowed: Set<string>, fb: Fallback): MediuxSetSummary {
  const memberIds = memberIdIndex(set)
  const posters = (set.files ?? [])
    .map(f => fileToInfo(f, set, allowed, fb, memberIds))
    .filter((p): p is PosterInfo => p !== null)

  let posterCount = 0, backdropCount = 0, titleCardCount = 0
  let preview: string | undefined
  let hasEpisodic = false, hasMovieRef = false
  for (const f of set.files ?? []) {
    const ft = (f.fileType ?? '').toLowerCase().replace(/[-\s]/g, '_')
    if (ft === 'poster') { posterCount++; if (!preview) preview = `${ASSET_BASE}/${f.id}?width=200&quality=80&format=webp` }
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
    setName: set.set_name ?? set.name ?? `Set ${set.id}`,
    uploader: set.user_created?.username ?? 'Unknown',
    uploaderAvatar: avatarUrl(set.user_created),
    posterCount,
    backdropCount,
    titleCardCount,
    previewUrl: preview,
    posters,
    ...(mediaType ? { mediaType } : {}),
  }
}

/**
 * Derives a {title, year} for a set that lacks denormalised show/movie objects
 * (creator pages) - by parsing a poster file's title ("Name (Year)") or set_name.
 *
 * @param set - The raw set.
 * @returns The best title/year guess, possibly empty.
 */
function deriveSetFallback(set: MediuxSet): Fallback {
  const direct =
    set.show?.name ?? set.show?.title ?? set.movie?.title ?? set.collection?.collection_name
  if (direct) {
    return { title: direct, year: extractYear(set.movie?.release_date ?? set.show?.first_air_date) }
  }
  const posterFile = (set.files ?? []).find(f => (f.fileType ?? '').toLowerCase().includes('poster'))
  const raw = posterFile?.title ?? set.set_name ?? set.name
  if (!raw) return {}
  const ym = raw.match(/^(.*?)\s*\((\d{4})\)\s*$/)
  if (ym) return { title: ym[1].trim(), year: parseInt(ym[2]) }
  return { title: raw.replace(/\s+(Collection|Set)$/i, '').trim() }
}

/** Scrapes MediUX set, boxset, and creator pages via the server-rendered RSC payload. */
export class MediuxScraper extends BaseScraper {

  /**
   * Scrapes a MediUX URL into posters, using plain HTTP first and a browser
   * as fallback.
   *
   * @param url - Set, boxset, show, or creator page URL.
   * @returns Posters allowed by the configured fileType filters.
   */
  async scrape(url: string): Promise<PosterInfo[]> {
    Logger.scrape('MediUX', `Scraping: ${url}`)
    const allowed = new Set<string>(ConfigService.get().mediuxFilters)

    const result = await this._fetchSets(url)
    if (result?.sets.length) {
      // Boxset pages strip per-file metadata (no movie_id / file titles), so a
      // collection set's posters can't be told apart. Re-fetch each collection
      // set's own /sets/{id} page, which carries the full per-movie metadata.
      const sets = /\/boxsets\//i.test(url)
        ? await this._enrichCollectionSets(result.sets)
        : result.sets
      return this._emit(sets, allowed, url, result.fallback)
    }

    Logger.warn('MediUX', `HTTP fetch found no set data, trying browser: ${url}`)
    return this._scrapeViaBrowser(url, allowed)
  }

  /**
   * Re-fetches collection sets via their own /sets/{id} page. Boxset constituent
   * sets come back stripped: a collection set ("Toy Story Collection") lists
   * several posters but no movie_id / file titles to tell which movie each
   * targets. The set's own page does carry that metadata (movie/show sets
   * already resolve fine).
   *
   * @param sets - Sets from a boxset page.
   * @returns The same sets, with collection sets replaced by enriched copies.
   */
  private async _enrichCollectionSets(sets: MediuxSet[]): Promise<MediuxSet[]> {
    // Each set's /sets/{id} re-fetch is independent, so fan them out with a small
    // concurrency cap instead of one slow round-trip after another.
    return mapPool(sets, 4, async s => {
      if (this._aborted) return s
      const posters = (s.files ?? []).filter(f => (f.fileType ?? '').toLowerCase().includes('poster'))
      // Movie/show browse pages strip per-file movie_id and the set-level
      // collection ref, leaving only file titles. Treat a set as a collection
      // set (worth re-fetching for its per-movie metadata) when it has the
      // collection object, is named "... Collection", or its poster titles
      // resolve to more than one dated movie.
      const datedMovies = new Set(
        posters
          .map(f => parseTitleYear(f.title))
          .filter((p): p is { title: string; year?: number } => !!p && p.year != null)
          .map(p => `${p.title.toLowerCase()}|${p.year}`),
      )
      const looksLikeCollection =
        !!s.collection ||
        /\bcollection\b/i.test(s.set_name ?? s.name ?? '') ||
        datedMovies.size > 1
      const needsEnrich = looksLikeCollection && posters.length > 1 && !posters.some(f => f.movie_id)
      if (!needsEnrich) return s
      try {
        const full = await this._fetchSets(`https://mediux.pro/sets/${s.id}`)
        const fullSet = full?.sets.find(x => String(x.id) === String(s.id))
        if (fullSet?.files?.some(f => f.movie_id)) {
          Logger.scrape('MediUX', `Enriched collection set ${s.id} (${s.collection?.collection_name}) via /sets/${s.id}`)
          return fullSet
        }
        return fullSet ?? s
      } catch (err) {
        Logger.warn('MediUX', `Enrich failed for set ${s.id}: ${err instanceof Error ? err.message : err}`)
        return s
      }
    })
  }

  /**
   * Lists all sets for a TMDB title with uploader metadata, for the library
   * browser. Unlike scrape(), this keeps the set grouping and uploader info
   * rather than flattening to a poster list, and ignores the user's fileType
   * filters (the UI decides what to apply).
   *
   * @param tmdbId - Resolved TMDB id.
   * @param type - Media type of the title.
   * @returns Set summaries, empty when none exist.
   */
  async browseSets(tmdbId: string, type: 'movie' | 'show'): Promise<MediuxSetSummary[]> {
    const url = `https://mediux.pro/${type === 'movie' ? 'movies' : 'shows'}/${tmdbId}`
    Logger.scrape('MediUX', `Browsing sets: ${url}`)

    const allTypes = new Set(['poster', 'backdrop', 'title_card'])
    const result = await this._fetchSets(url)
    let sets = result?.sets
    const fallback = result?.fallback ?? {}

    if (!sets?.length) {
      const { context, page } = await this.newContext()
      try {
        await sleepConfig('initial')
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await page.waitForSelector('script', { timeout: 5_000 }).catch(() => {})
        await page.waitForTimeout(1500)
        const scripts = await this._readScripts(page)
        sets = setsFromScripts(scripts)
      } finally {
        await context.close()
      }
    }

    if (!sets?.length) {
      Logger.warn('MediUX', `No sets found for ${type} ${tmdbId}`)
      return []
    }

    // Recover per-movie metadata for any collection set that came back stripped,
    // so its posters can be told apart and routed to the right movie. No-op for
    // ordinary sets and for collection sets that already carry movie_id.
    sets = await this._enrichCollectionSets(sets)

    const summaries = sets.map(s => setToSummary(s, allTypes, fallback))
    Logger.scrape('MediUX', `Browse: ${summaries.length} set(s) for ${type} ${tmdbId}`)
    return summaries
  }

  /**
   * Finds MediUX sets with collection-level art for a Plex Collection.
   * Tries the TMDB collection page first, then scans member movies' set lists.
   */
  async browseCollectionSets(
    collectionTitle: string,
    tmdbCollectionId: string | undefined,
    childTmdbIds: string[],
  ): Promise<MediuxSetSummary[]> {
    const allTypes = new Set(['poster', 'backdrop', 'title_card'])
    const collNorm = normalizeCollectionName(collectionTitle)

    const matchesTitle = (name: string) => {
      const n = normalizeCollectionName(name)
      return n === collNorm || n.includes(collNorm) || collNorm.includes(n)
    }

    const hasCollectionArt = (s: MediuxSetSummary) =>
      s.posters.some(p => p.isCollection)
      || (/\bcollection\b/i.test(s.setName) && matchesTitle(s.setName))

    const filterSummaries = (raw: MediuxSet[]) =>
      raw
        .map(s => setToSummary(s, allTypes, deriveSetFallback(s)))
        .filter(s => {
          if (!hasCollectionArt(s)) return false
          if (matchesTitle(s.setName)) return true
          return s.posters.some(p => p.isCollection && matchesTitle(p.title))
        })

    const rawById = new Map<string, MediuxSet>()
    const fetchInto = async (url: string, timeoutMs: number) => {
      try {
        const result = await this._fetchSets(url, timeoutMs)
        for (const s of result?.sets ?? []) rawById.set(String(s.id), s)
      } catch (err) {
        Logger.warn('MediUX', `Collection fetch failed for ${url}: ${err instanceof Error ? err.message : err}`)
      }
    }

    // Cache enrichment so the member-movie fallback loop, which calls finalize()
    // after every fetch, only re-fetches /sets/{id} for sets it hasn't enriched
    // yet instead of re-enriching the whole accumulated pile each pass.
    const enrichedById = new Map<string, MediuxSet>()
    const finalize = async (): Promise<MediuxSetSummary[]> => {
      const pending = [...rawById.values()].filter(s => !enrichedById.has(String(s.id)))
      for (const s of await this._enrichCollectionSets(pending)) enrichedById.set(String(s.id), s)
      if (!enrichedById.size) return []
      return filterSummaries([...enrichedById.values()])
    }

    Logger.scrape('MediUX', `Browsing collection sets: "${collectionTitle}"`)

    // TMDB collection pages can be very large (multi-MB); use a longer timeout and
    // skip member-movie scans when this page already yields matches.
    if (tmdbCollectionId) {
      await fetchInto(`https://mediux.pro/collections/${tmdbCollectionId}`, 90_000)
      const fromCollection = await finalize()
      if (fromCollection.length) {
        Logger.scrape('MediUX', `Collection browse: ${fromCollection.length} matching set(s) for "${collectionTitle}"`)
        return fromCollection
      }
    }

    // Fall back to member movies (cap scans — franchise pages are also huge).
    const maxChildScans = tmdbCollectionId ? 2 : 3
    for (const id of childTmdbIds.slice(0, maxChildScans)) {
      if (this._aborted) break
      await fetchInto(`https://mediux.pro/movies/${id}`, 60_000)
      const partial = await finalize()
      if (partial.length) {
        Logger.scrape('MediUX', `Collection browse: ${partial.length} matching set(s) for "${collectionTitle}"`)
        return partial
      }
    }

    if (!rawById.size) {
      Logger.warn('MediUX', `No raw sets found for collection "${collectionTitle}"`)
      return []
    }

    const summaries = await finalize()
    Logger.scrape('MediUX', `Collection browse: ${summaries.length} matching set(s) for "${collectionTitle}"`)
    return summaries
  }

  /**
   * Lists a creator's most-recent sets (for subscriptions) with a parsed
   * title/year per set so the caller can match them against the Plex library.
   * matchedKey is filled in later by the library handler.
   *
   * @param username - Creator to browse.
   * @param page - MediUX's cumulative pagination: page N server-renders the
   *   creator's first N*12 sets, so each higher page is a superset of the prior.
   * @returns The creator's own sets from that page.
   */
  async browseUserSets(username: string, page = 1): Promise<MediuxUserSet[]> {
    const base = `https://mediux.pro/user/${encodeURIComponent(username)}/sets`
    const url = page > 1 ? `${base}?page=${page}` : base
    Logger.scrape('MediUX', `Browsing creator: ${url}`)

    const allTypes = new Set(['poster', 'backdrop', 'title_card'])
    let sets = (await this._fetchSets(url))?.sets

    if (!sets?.length) {
      const { context, page: pg } = await this.newContext()
      try {
        await sleepConfig('initial')
        await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await pg.waitForSelector('script', { timeout: 5_000 }).catch(() => {})
        await pg.waitForTimeout(1500)
        sets = setsFromScripts(await this._readScripts(pg))
      } finally {
        await context.close()
      }
    }

    if (!sets?.length) {
      Logger.warn('MediUX', `No sets found for creator "${username}"`)
      return []
    }

    // The page can include other creators' sets (recommendations) - keep only this
    // creator's own (plus any set lacking a denormalised username, to be safe)
    const target = username.toLowerCase()
    const owned = sets.filter(s => {
      const u = s.user_created?.username?.toLowerCase()
      return !u || u === target
    })

    const out = owned.map(s => {
      const fb = deriveSetFallback(s)
      const summary = setToSummary(s, allTypes, fb)
      return {
        ...summary,
        title: fb.title ?? summary.setName,
        year: fb.year,
        dateUpdated: s.date_updated,
      } as MediuxUserSet
    })
    Logger.scrape('MediUX', `Creator "${username}": ${out.length} set(s)`)
    return out
  }

  /**
   * Fetches a page over plain HTTP, extracts its script blocks, and parses the
   * RSC payload into sets.
   *
   * @param url - Page to fetch.
   * @returns The sets plus an og:title fallback, or null when none were found.
   */
  private async _fetchSets(
    url: string,
    timeoutMs = 25_000,
  ): Promise<{ sets: MediuxSet[]; fallback: Fallback } | null> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':      pick(USER_AGENTS),
          'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control':   'no-cache',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })

      // MediUX set/boxset pages return HTTP 500 while still streaming the RSC
      // payload with valid data - parse the body regardless of status
      const html = await res.text()
      if (!html || html.length < 500) {
        Logger.warn('MediUX', `HTTP ${res.status}, empty/short body for: ${url}`)
        return null
      }
      if (!res.ok) Logger.scrape('MediUX', `HTTP ${res.status} but parsing body anyway`)

      const fallback = parseOgTitle(html)
      const scripts: string[] = []
      const re = /<script[^>]*>([\s\S]*?)<\/script>/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(html)) !== null) scripts.push(m[1])

      Logger.scrape('MediUX', `HTTP: ${scripts.length} script tag(s)`)
      const sets = setsFromScripts(scripts)
      Logger.scrape('MediUX', `HTTP: extracted ${sets.length} set(s)`)
      return sets.length ? { sets, fallback } : null
    } catch (err) {
      Logger.warn('MediUX', `HTTP fetch failed: ${err instanceof Error ? err.message : err}`)
      return null
    }
  }

  /**
   * Browser fallback for JS-rendered, anti-bot, or slow-hydration pages.
   *
   * @param url - Page to scrape.
   * @param allowed - Enabled fileTypes.
   * @returns Posters found, empty on failure.
   */
  private async _scrapeViaBrowser(url: string, allowed: Set<string>): Promise<PosterInfo[]> {
    Logger.scrape('MediUX', `Browser: ${url}`)
    const { context, page } = await this.newContext()

    try {
      await sleepConfig('initial')
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.waitForSelector('script', { timeout: 5_000 }).catch(() => {})
      await page.waitForTimeout(1500)

      const fallback = await page.evaluate((): { title?: string } => {
        const doc = (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(a: string): string | null } | null } }).document
        const c = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
        return { title: c ?? undefined }
      }).then(r => {
        if (!r.title) return {}
        const ym = r.title.match(/^(.*?)\s*\((\d{4})\)\s*$/)
        return ym ? { title: ym[1].trim(), year: parseInt(ym[2]) } : { title: r.title }
      }).catch(() => ({} as Fallback))

      const scripts = await this._readScripts(page)
      Logger.scrape('MediUX', `Browser: ${scripts.length} script tag(s)`)

      const sets = setsFromScripts(scripts)
      Logger.scrape('MediUX', `Browser: extracted ${sets.length} set(s)`)

      if (sets.length) return this._emit(sets, allowed, url, fallback)

      Logger.warn('MediUX', `No set data found for: ${url}`)
      return []
    } catch (err) {
      Logger.error('MediUX', `Browser scrape failed: ${err instanceof Error ? err.message : err}`)
      return []
    } finally {
      await context.close()
    }
  }

  /**
   * Reads the text content of every script tag on the page.
   *
   * @param page - Loaded page.
   * @returns Non-empty script bodies.
   */
  private async _readScripts(page: Page): Promise<string[]> {
    return page.$$eval('script', (els: Array<{ textContent: string | null }>) =>
      els.map(e => e.textContent ?? '').filter(Boolean),
    ).catch(() => [])
  }

  /**
   * Flattens sets into PosterInfo entries, applying per-set title/year fallbacks.
   *
   * @param sets - Sets to emit.
   * @param allowed - Enabled fileTypes.
   * @param url - Source URL, for logging.
   * @param fallback - Page-level title/year fallback.
   * @returns All posters across the sets.
   */
  private _emit(sets: MediuxSet[], allowed: Set<string>, url: string, fallback: Fallback = {}): PosterInfo[] {
    const out: PosterInfo[] = []
    for (const set of sets) {
      if (this._aborted) break
      // Per-set title/year handles creator pages where each set is a different
      // title and the page-level og:title is absent
      const fb: Fallback = { ...fallback, ...deriveSetFallback(set) }
      const memberIds = memberIdIndex(set)
      const found = (set.files ?? [])
        .map(f => fileToInfo(f, set, allowed, fb, memberIds))
        .filter((p): p is PosterInfo => p !== null)
      const label = fb.title ?? set.name ?? `set ${set.id}`
      Logger.scrape('MediUX', `"${label}" → ${found.length} poster(s)`)
      out.push(...found)
    }
    Logger.scrape('MediUX', `Total: ${out.length} poster(s) from ${url}`)
    return out
  }
}
