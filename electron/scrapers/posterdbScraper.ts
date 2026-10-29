import * as cheerio from 'cheerio'
import { BaseScraper, sleepConfig, mapPool, USER_AGENTS } from './baseScraper'
import { Logger } from '../services/logger'
import { ConfigService } from '../services/config'
import { stripSuffix } from '../services/titleParse'
import type { PosterInfo, PosterSetSummary } from '../ipc/types'

const BASE = 'https://theposterdb.com'

/** What the library browser can look up on ThePosterDB. */
export type PosterdbMediaType = 'movie' | 'show' | 'collection'

/** Search section that lists a given media type. */
const SEARCH_SECTION: Record<PosterdbMediaType, string> = {
  movie: 'movies',
  show: 'shows',
  collection: 'collections',
}

/** Posters per media page; a shorter page is the last one. */
const MEDIA_PAGE_SIZE = 24
/**
 * Media pages are sorted by downloads, so the first two pages hold the sets
 * worth showing. The result says when the site lists more.
 */
const MAX_BROWSE_PAGES = 2
const MAX_BROWSE_SETS = MEDIA_PAGE_SIZE * MAX_BROWSE_PAGES
/** Rows per search page; a shorter page is the last one. */
const SEARCH_PAGE_SIZE = 36
/** Search pages walked for a title before it counts as absent. */
const MAX_SEARCH_PAGES = 4
/**
 * Same-titled media pages read for one title. The site holds duplicate
 * entries for many titles, collections above all, and the newest is often an
 * empty shell, so the browse reads them all and merges their sets.
 */
const MAX_MEDIA_CANDIDATES = 6
/** Parallel set-page fetches; the Max Workers setting caps it further. */
const SET_FETCH_CONCURRENCY = 4
/** How long a resolved title -> media-page id mapping stays good. */
const MEDIA_ID_TTL = 6 * 60 * 60 * 1000
/** A miss is remembered only briefly: a new upload or a site hiccup must not hide a title for hours. */
const MEDIA_MISS_TTL = 10 * 60 * 1000
/** Plain HTTP budget per page before the browser takes over. */
const FETCH_TIMEOUT_MS = 15_000
/** Request types a browse page never needs; only its DOM is read. */
const HEAVY_RESOURCES = new Set(['image', 'media', 'font', 'stylesheet'])

/**
 * Classifies a ThePosterDB URL.
 *
 * @param url - URL to inspect.
 * @returns set, poster, user, or unknown.
 */
export function posterdbUrlType(url: string): 'set' | 'poster' | 'media' | 'user' | 'unknown' {
  if (/theposterdb\.com\/set\/\d+/.test(url)) return 'set'
  if (/theposterdb\.com\/poster\/\d+/.test(url)) return 'poster'
  if (/theposterdb\.com\/posters\/\d+/.test(url)) return 'media'
  if (/theposterdb\.com\/user\//.test(url)) return 'user'
  return 'unknown'
}

/**
 * Returns the original-quality image endpoint (matches the Python scraper:
 * /api/assets/{id}).
 *
 * @param posterId - The poster's data-poster-id.
 * @returns The asset URL.
 */
function posterAssetUrl(posterId: string): string {
  return `${BASE}/api/assets/${posterId}`
}

export interface RawCard {
  posterId: string
  thumbUrl: string
  title: string
  mediaType: string
  year?: number
  season?: number | 'Cover' | 'Backdrop'
  /** Set the poster belongs to, from the card's poster-count badge. */
  setId?: string
  /** How many posters that set holds, per the same badge. */
  setSize?: number
  uploader?: string
}

/**
 * Extracts the "(YYYY)" year from a poster title. The last one counts: a
 * title can carry a year of its own ("Dune (1984): Redux (2021)").
 *
 * @param text - Raw card title.
 * @returns The year, or undefined.
 */
export function parseYear(text: string): number | undefined {
  let year: number | undefined
  for (const m of text.matchAll(/\((\d{4})\)/g)) year = parseInt(m[1])
  return year
}

/**
 * Reads the media title out of a card caption: "Title (Year)", optionally
 * followed by " - Season N" or " - Specials". Only the trailing year goes, so
 * a title with its own parenthetical ("Birds of Prey (and the Fantabulous
 * Emancipation of One Harley Quinn)") survives intact.
 *
 * @param rawTitle - Raw card title.
 * @returns The bare media title.
 */
export function parseCardTitle(rawTitle: string): string {
  const years = /\(\d{4}\)/g
  for (let m = years.exec(rawTitle); m; m = years.exec(rawTitle)) {
    const rest = rawTitle.slice(years.lastIndex)
    if (!rest || rest.trimStart().startsWith('-')) return rawTitle.slice(0, m.index).trim()
  }
  return stripSuffix(rawTitle, /-\s+(?:season\s+\d+|specials)\s*$/i, true).trim()
}

/**
 * Derives the season for a TV show poster from the title suffix the way
 * ThePosterDB formats it: "Title (Year) - Season N", "- Specials" maps to 0,
 * otherwise it's the show cover poster. Movies/collections have no season.
 *
 * @param text - Raw card title.
 * @returns The season number, 0 for Specials, or 'Cover'.
 */
function parseShowSeason(text: string): number | 'Cover' | undefined {
  if (text.includes(' - ')) {
    const last = text.split(' - ').pop()!.trim()
    if (/specials/i.test(last)) return 0
    const m = last.match(/season\s+(\d+)/i)
    if (m) return parseInt(m[1])
  }
  return 'Cover'
}

/**
 * Parses poster cards from a ThePosterDB page. Each poster is a grid cell
 * containing a `div.overlay` that carries `data-poster-id`, a tooltip anchor
 * whose `title` is the media type (Movie / Show / Collection), and a
 * `p.text-break` title. The overlay is the most stable hook; the rest is read
 * from its grid cell.
 *
 * @param $ - Cheerio handle over the page HTML.
 * @returns One raw card per poster found.
 */
export function parseCards($: cheerio.CheerioAPI): RawCard[] {
  const cards: RawCard[] = []

  $('div.overlay[data-poster-id]').each((_, el) => {
    const $overlay = $(el)
    const posterId = $overlay.attr('data-poster-id')
    if (!posterId) return

    let $cell = $overlay.closest('div[class*="col-"]')
    if (!$cell.length) $cell = $overlay.parent()

    // The specific selector wins; a comma-joined union with .first() would
    // return whichever match comes first in the markup.
    const firstOf = (...selectors: string[]) => {
      for (const sel of selectors) {
        const $el = $cell.find(sel).first()
        if ($el.length) return $el
      }
      return $cell.find(selectors[0]).first()
    }

    // data-poster-type is the modern attribute; the tooltip anchor's title
    // covers older markup
    const mediaType = (
      $overlay.attr('data-poster-type') ||
      $cell.find('a.text-white[data-toggle="tooltip"]').attr('title') ||
      $overlay.find('a[data-toggle="tooltip"]').attr('title') ||
      'Movie'
    ).trim()

    const rawTitle = (
      $cell.find('p.text-break').first().text() ||
      $cell.find('p').first().text() ||
      $cell.find('img').first().attr('alt') ||
      ''
    ).trim()
    if (!rawTitle) return

    const title = parseCardTitle(rawTitle)
    const year = parseYear(rawTitle)
    const season = /show/i.test(mediaType) ? parseShowSeason(rawTitle) : undefined

    // The <img> is a lazy placeholder (missing_poster.jpg); the real artwork is
    // only ever in the <picture>'s <source srcset>. Read that first and fall
    // back to the img attributes for any older markup that lacks a <picture>.
    const srcset =
      $cell.find('picture source[type="image/webp"]').first().attr('srcset') ||
      $cell.find('picture source').first().attr('srcset') ||
      ''
    const imgEl = $cell.find('img').first()
    const rawThumb =
      srcset.split(',')[0].trim().split(/\s+/)[0] ||
      imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('src') || ''
    const thumbUrl =
      rawThumb.includes('missing_poster') ? ''
      : rawThumb.startsWith('http') ? rawThumb
      : rawThumb ? `${BASE}${rawThumb}` : ''

    const $setLink = firstOf('a.set_poster_count[href*="/set/"]', 'a[href*="/set/"]')
    const setId = $setLink.attr('href')?.match(/\/set\/(\d+)/)?.[1]
    const setSize = parseInt($setLink.text().trim(), 10)
    const uploader = firstOf('p.uploaded-by a[href*="/user/"]', 'a[href*="/user/"]').text().trim()

    cards.push({
      posterId, thumbUrl, title, mediaType, year, season,
      setId,
      setSize: Number.isFinite(setSize) && setSize > 0 ? setSize : undefined,
      uploader: uploader || undefined,
    })
  })

  return cards
}

/**
 * Converts parsed cards into PosterInfo entries.
 *
 * @param cards - Cards from parseCards().
 * @returns Posters with original-quality URLs and display thumbs.
 */
export function cardsToPosters(cards: RawCard[]): PosterInfo[] {
  return cards.map(c => ({
    title: c.title,
    url: posterAssetUrl(c.posterId),
    thumbUrl: c.thumbUrl || posterAssetUrl(c.posterId),
    source: 'posterdb' as const,
    year: c.year,
    season: c.season,
    ...( /collection/i.test(c.mediaType) ? { isCollection: true } : {} ),
  }))
}

/**
 * Folds a title down to something two sites can agree on: case, accents,
 * punctuation and "the/a/an" all vary between Plex and ThePosterDB.
 *
 * @param s - Raw title.
 * @returns The comparable form.
 */
/** Letters NFD cannot decompose, folded to their ASCII spelling. */
const LETTER_FOLD: Record<string, string> = {
  ø: 'o', ß: 'ss', ł: 'l', æ: 'ae', œ: 'oe', đ: 'd', ð: 'd', þ: 'th', ı: 'i',
}

export function normalizeTitle(s: string): string {
  return s
    .normalize('NFD').replace(/\p{M}/gu, '')   // strip accents: "Amélie" -> "amelie"
    .toLowerCase()
    .replace(/[øßłæœđðþı]/g, ch => LETTER_FOLD[ch])
    .replace(/&/g, ' and ')
    // Letters of any script survive; only punctuation and symbols collapse.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    // Trim before dropping the article, or a title starting with punctuation
    // keeps a leading space and the article survives.
    .trim()
    .replace(/^(the|a|an) /, '')
}

/** One row of a ThePosterDB search result page. */
export interface SearchHit { mediaId: string; title: string; year?: number }

/**
 * Tells a search results page from anything else that answered 200 in its
 * place (a challenge or maintenance page), which must not be read as "no
 * such title".
 *
 * @param $ - Cheerio handle over the page HTML.
 * @returns true for a search results page.
 */
export function isSearchPage($: cheerio.CheerioAPI): boolean {
  return /\bsearch\b/i.test($('title').first().text())
}

/** Markup that proves a media page rendered: its poster grid, or the notice an empty one shows instead. */
const MEDIA_PAGE_MARKER = 'div.overlay[data-poster-id], p.h2'

/**
 * Tells a media page, full or empty, from a challenge or maintenance page
 * that answered in its place. An empty page is a real answer (the title has
 * no posters), so it must not send the browse to the headless browser.
 *
 * @param $ - Cheerio handle over the page HTML.
 * @returns true for a media page.
 */
export function isMediaPage($: cheerio.CheerioAPI): boolean {
  return $('div.overlay[data-poster-id]').length > 0 || /no posters have been made/i.test($('p.h2').text())
}

/**
 * Reads the set a poster page belongs to.
 *
 * @param $ - Cheerio handle over the poster page HTML.
 * @returns The set id, or an empty string for a poster uploaded on its own.
 */
export function parentSetId($: cheerio.CheerioAPI): string {
  const href =
    $('a[data-toggle="tooltip"][title="View Set Page"]').first().attr('href') ||
    $('a.rounded.view_all').first().attr('href') ||
    ''
  return /\/set\/(\d+)/.exec(href)?.[1] ?? ''
}

/**
 * Parses the search page's result rows.
 *
 * @param $ - Cheerio handle over the search HTML.
 * @returns Every "/posters/{id}" hit with its title and year.
 */
export function parseSearchHits($: cheerio.CheerioAPI): SearchHit[] {
  const hits: SearchHit[] = []
  $('a[href*="/posters/"]').each((_, el) => {
    const $a = $(el)
    const mediaId = $a.attr('href')?.match(/\/posters\/(\d+)/)?.[1]
    if (!mediaId) return
    // Rows render as "<strong>Title</strong> (Year)"; the year is absent or
    // "N/A" for collections and for titles TPDb has no release date for.
    const title = ($a.find('strong').first().text() || $a.text()).trim()
    if (!title) return
    const year = parseYear($a.text())
    hits.push({ mediaId, title, year })
  })
  return hits
}

/**
 * Normalized titles a hit may carry and still be the thing we asked for, best
 * first. Plex can suffix a title with a country or year ("The Office (US)")
 * that ThePosterDB does not carry, and the two disagree on whether a
 * collection's name ends in "Collection", so those spellings count too.
 *
 * @param title - Plex title.
 * @param type - What kind of item is being browsed.
 * @returns Every acceptable normalized form; empty when the title has no
 *   letters or digits to match on.
 */
export function titleAliases(title: string, type: PosterdbMediaType): string[] {
  const forms = [title]
  const bare = stripSuffix(title, /\([^()]*\)\s*$/).trim()
  if (bare && bare !== title) forms.push(bare)
  const normalized = [...new Set(forms.map(normalizeTitle).filter(Boolean))]
  if (type !== 'collection') return normalized
  return [...new Set(normalized.flatMap(n => {
    const base = n.replace(/ collection$/, '')
    return [n, base, `${base} collection`]
  }))]
}

/**
 * Whether a hit's year agrees with the one Plex holds. Within a year either
 * side counts: Plex and TPDb disagree on late-December and festival-vs-wide
 * release dates often enough to matter.
 *
 * @param hit - A search hit.
 * @param year - Plex release year, when known.
 * @returns true when there is no year to disagree with, or the years agree.
 */
export function yearMatches(hit: SearchHit, year?: number): boolean {
  return year == null || (hit.year != null && Math.abs(hit.year - year) <= 1)
}

/**
 * Picks the search hit that actually is the title we asked for. Earlier
 * aliases win over later ones; among those, the year decides: a row with a
 * different year is another release, while a row with no year may still be
 * the title.
 *
 * @param hits - Rows from parseSearchHits().
 * @param wants - Acceptable normalized titles, from titleAliases().
 * @param year - Plex release year, when known.
 * @returns The best hit, or null when nothing matches.
 */
export function pickSearchHit(hits: SearchHit[], wants: string[], year?: number): SearchHit | null {
  const rank = (h: SearchHit) => wants.indexOf(normalizeTitle(h.title))
  const exact = hits.filter(h => rank(h) >= 0).sort((a, b) => rank(a) - rank(b))
  if (!exact.length) return null
  if (year == null) return exact[0]
  return exact.find(h => h.year === year)
    ?? exact.find(h => yearMatches(h, year))
    ?? exact.find(h => h.year == null)
    ?? null
}

/**
 * Every search hit that is the title we asked for, best first. ThePosterDB
 * holds duplicate entries for many titles, collections above all, and the
 * newest is often an empty shell with the real posters on an older entry, so
 * a browse reads them all. The rest carry the best hit's year, or like it
 * carry none.
 *
 * @param hits - Rows from parseSearchHits().
 * @param wants - Acceptable normalized titles, from titleAliases().
 * @param year - Plex release year, when known.
 * @returns The matching hits, at most MAX_MEDIA_CANDIDATES; empty when nothing matches.
 */
export function pickSearchHits(hits: SearchHit[], wants: string[], year?: number): SearchHit[] {
  const best = pickSearchHit(hits, wants, year)
  if (!best) return []
  const sameYear = (h: SearchHit) => best.year == null ? h.year == null : h.year === best.year
  const rest = hits.filter(h => h !== best && wants.includes(normalizeTitle(h.title)) && sameYear(h))
  return [best, ...rest].slice(0, MAX_MEDIA_CANDIDATES)
}

/** A set discovered on a media page, before its full contents are known. */
export interface SetStub {
  setId: string
  uploader: string
  /** Poster count from the card's badge - how many posters the set holds. */
  size: number
  /** The card as it appeared on the media page (this title's poster). */
  card: RawCard
}

/**
 * Groups a media page's cards into one stub per set, preserving page order
 * (ThePosterDB sorts media pages by downloads, so the best sets come first).
 *
 * @param cards - Cards parsed from a media page.
 * @returns One stub per distinct set, first card wins.
 */
export function stubsFromCards(cards: RawCard[]): SetStub[] {
  const stubs = new Map<string, SetStub>()
  for (const c of cards) {
    if (!c.setId || stubs.has(c.setId)) continue
    stubs.set(c.setId, {
      setId: c.setId,
      uploader: c.uploader ?? 'Unknown',
      size: c.setSize ?? 1,
      card: c,
    })
  }
  return [...stubs.values()]
}

/**
 * Tags a set's posters relative to the title being browsed, mirroring how the
 * MediUX boxset browse classifies them: art for the collection object itself,
 * posters for *this* title, and posters for the other movies in the set.
 *
 * @param posters - Every poster on the set page.
 * @param title - Title being browsed.
 * @param year - Its release year, when known.
 * @param type - What kind of item is being browsed.
 * @returns The same posters with isCollection/isCollectionMember settled.
 */
export function classifySetPosters(
  posters: PosterInfo[],
  title: string,
  year: number | undefined,
  type: PosterdbMediaType,
): PosterInfo[] {
  const want = normalizeTitle(title)
  return posters.map(p => {
    // cardsToPosters already flags collection art from the card's media type.
    if (p.isCollection) return p
    const sameTitle = normalizeTitle(p.title) === want
      && (p.year == null || year == null || Math.abs(p.year - year) <= 1)
    // Browsing a Plex Collection: every movie poster in the set is a member.
    // Browsing a title: anything that isn't this title belongs to a sibling.
    if (type === 'collection' || !sameTitle) return { ...p, isCollectionMember: true }
    return p
  })
}

/** How long a resolved avatar (or the absence of one) is trusted. */
const AVATAR_TTL = 24 * 60 * 60 * 1000
/** Parallel profile-page fetches while resolving avatars. */
const AVATAR_FETCH_CONCURRENCY = 4

/** Resolved avatars by lowercased username; null means "show the generic icon". */
const avatarCache = new Map<string, { url: string | null; at: number }>()

/**
 * Where a custom upload would live: the CDN path is built from the username.
 * Only a fallback for when the profile page can't be read - users who never
 * uploaded an avatar 403 here, and the card then shows its generic icon.
 *
 * @param username - Uploader name as shown on the site.
 * @returns The guessed CDN URL.
 */
export function guessedAvatarUrl(username: string): string {
  return `https://images.theposterdb.com/prod/public/images/users/${encodeURIComponent(username)}/avatar.webp`
}

/**
 * Fetches a page over plain HTTP. ThePosterDB serves its search, media, set
 * and profile pages to a browser-like client without a challenge, which is
 * many times faster than driving the headless browser; callers fall back to
 * the browser when this returns null.
 *
 * @param url - Page to fetch.
 * @returns The HTML, or null on a transport failure or non-2xx status.
 */
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENTS[0],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      Logger.scrape('PosterDB', `HTTP ${res.status} for ${url}`)
      return null
    }
    return await res.text()
  } catch (err) {
    Logger.scrape('PosterDB', `HTTP fetch failed [${url}]: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/**
 * Reads the avatar a profile page actually shows. That is either a custom
 * upload on the image CDN or one of the site's stock pictures, which it
 * assigns per user server-side - so it can only be learned from the page.
 *
 * @param $ - Cheerio handle over the profile HTML.
 * @returns The avatar URL, null for the site's gray "missing avatar"
 *   silhouette (the app's own icon looks the same and fits the theme), or
 *   undefined when the page has no avatar element at all.
 */
export function parseProfileAvatar($: cheerio.CheerioAPI): string | null | undefined {
  const $img = $('img.tpdb-avatar').first()
  if (!$img.length) return undefined
  const raw =
    $img.closest('picture').find('source[type="image/webp"]').first().attr('srcset') ||
    $img.attr('src') ||
    ''
  const src = raw.split(',')[0].trim().split(/\s+/)[0]
  if (!src || src.includes('missing_avatar')) return null
  return src.startsWith('http') ? src : `${BASE}${src}`
}

/**
 * Resolves the avatar for each uploader by reading their profile page over
 * plain HTTP. Results are cached for a day; a failed fetch falls back to the
 * guessed CDN URL without caching, so a hiccup isn't remembered.
 *
 * @param usernames - Uploaders to resolve; duplicates are fine.
 * @returns Lowercased username to avatar URL (null = generic icon).
 */
export async function resolveAvatars(usernames: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const pending: string[] = []
  for (const name of new Set(usernames)) {
    if (!name || name === 'Unknown') continue
    const hit = avatarCache.get(name.toLowerCase())
    if (hit && Date.now() - hit.at < AVATAR_TTL) out.set(name.toLowerCase(), hit.url)
    else pending.push(name)
  }

  await mapPool(pending, AVATAR_FETCH_CONCURRENCY, async name => {
    const key = name.toLowerCase()
    try {
      const html = await fetchHtml(`${BASE}/user/${encodeURIComponent(name)}`)
      if (html === null) throw new Error('profile page did not load')
      const found = parseProfileAvatar(cheerio.load(html))
      if (found === undefined) throw new Error('no avatar element on profile page')
      avatarCache.set(key, { url: found, at: Date.now() })
      out.set(key, found)
    } catch (err) {
      Logger.warn('PosterDB', `Avatar lookup failed for "${name}": ${err instanceof Error ? err.message : err}`)
      out.set(key, guessedAvatarUrl(name))
    }
  })
  return out
}

/**
 * Builds the library-browser summary for one set.
 *
 * @param stub - The set as seen on the media page.
 * @param posters - Its classified posters.
 * @param setName - Display name for the set.
 * @param type - What kind of item is being browsed.
 * @returns The summary the panel renders.
 */
export function stubToSummary(
  stub: SetStub,
  posters: PosterInfo[],
  setName: string,
  type: PosterdbMediaType,
): PosterSetSummary {
  let posterCount = 0, backdropCount = 0, titleCardCount = 0
  for (const p of posters) {
    if (p.season === 'Backdrop') backdropCount++
    else if (p.episode != null) titleCardCount++
    else posterCount++
  }
  return {
    id: stub.setId,
    source: 'posterdb',
    setName,
    uploader: stub.uploader,
    setUrl: `${BASE}/set/${stub.setId}`,
    posterCount,
    backdropCount,
    titleCardCount,
    previewUrl: stub.card.thumbUrl || posterAssetUrl(stub.card.posterId),
    posters,
    ...(type === 'collection' ? {} : { mediaType: type }),
  }
}

/** Resolved media pages, so reopening a title doesn't re-run the search. Empty means the title was not found. */
const mediaIdCache = new Map<string, { hits: SearchHit[]; at: number }>()

export function mediaCacheKey(title: string, year: number | undefined, type: PosterdbMediaType): string {
  return `${type}|${normalizeTitle(title)}|${year ?? ''}`
}

/** Drops every remembered title match and avatar (Settings -> Clear cached data, and tests). */
export function resetPosterdbCaches(): void {
  mediaIdCache.clear()
  avatarCache.clear()
}

/**
 * Only movie, show and collection cards are art for the library; a set can
 * also carry people (a director's poster) that would otherwise be reported as
 * collection members.
 *
 * @param card - A parsed card.
 * @returns true for a card the browser should show.
 */
export function isMediaCard(card: RawCard): boolean {
  return /movie|show|collection/i.test(card.mediaType)
}

/**
 * Set names on set pages carry the title's year ("Breaking Bad (2008)") while
 * card captions do not; strip it so both branches name sets alike.
 *
 * @param name - Name read from the page title.
 * @returns The name without a trailing year.
 */
export function cleanSetName(name: string): string {
  return stripSuffix(name, /\(\d{4}\)\s*$/).trim()
}

/**
 * Reads the set name from a set page's title,
 * "<Set name> Set By <uploader> | The Poster Database (TPDb)".
 *
 * @param pageTitle - Text of the page's title element.
 * @returns The set name without its year.
 */
export function parseSetPageTitle(pageTitle: string): string {
  const by = /\sSet By\s/i.exec(pageTitle)
  return cleanSetName(by ? pageTitle.slice(0, by.index) : pageTitle)
}

/** What the library browser gets back for a title. */
export interface PosterdbBrowseResult {
  sets: PosterSetSummary[]
  /** The site lists more sets than were read. */
  capped: boolean
  /** The title's media page on the site, once resolved. */
  mediaUrl?: string
}

const NO_RESULT: PosterdbBrowseResult = { sets: [], capped: false }

/** Scrapes ThePosterDB set, single-poster, and user-upload pages via a headless browser. */
export class PosterdbScraper extends BaseScraper {
  /**
   * Routes a ThePosterDB URL to the matching scrape strategy.
   *
   * @param url - Set, poster, or user page URL.
   * @returns Posters found, empty for unrecognised URLs.
   */
  async scrape(url: string): Promise<PosterInfo[]> {
    const type = posterdbUrlType(url)
    Logger.scrape('PosterDB', `Scraping ${type}: ${url}`)

    switch (type) {
      case 'set':    return this.scrapeSet(url)
      case 'poster': return this.scrapeSinglePoster(url)
      case 'user':   return this.scrapeUserUploads(url)
      case 'media':
        Logger.warn('PosterDB', `A title page lists many sets; scrape a set or poster link instead: ${url}`)
        return []
      default:
        Logger.warn('PosterDB', `Unrecognised URL pattern: ${url}`)
        return []
    }
  }

  /**
   * Scrapes every poster on a set page.
   *
   * @param url - Set page URL.
   * @returns Posters found, empty on failure.
   */
  async scrapeSet(url: string): Promise<PosterInfo[]> {
    const { context, page } = await this.newContext()
    try {
      await this.navigate(page, url, 'div.overlay[data-poster-id]')
      const html = await page.content()
      const $ = cheerio.load(html)
      const cards = parseCards($)
      const posters = cardsToPosters(cards)
      Logger.scrape('PosterDB', `Set ${url} - ${posters.length} posters found`)
      return posters
    } catch (err) {
      Logger.error('PosterDB', `scrapeSet failed: ${err instanceof Error ? err.message : err}`)
      return []
    } finally {
      await context.close()
    }
  }

  /**
   * Scrapes a single-poster page by locating its parent set, falling back to
   * the poster itself.
   *
   * @param url - Poster page URL.
   * @returns The parent set's posters, or just this poster.
   */
  async scrapeSinglePoster(url: string): Promise<PosterInfo[]> {
    const { context, page } = await this.newContext()
    try {
      await this.navigate(page, url, 'div.overlay[data-poster-id], a[title="View Set Page"]')
      const html = await page.content()
      const $ = cheerio.load(html)

      // "View Set Page" link (new layout), then older fallbacks
      const setHref =
        $('a[data-toggle="tooltip"][title="View Set Page"]').first().attr('href') ||
        $('a.rounded.view_all').first().attr('href') ||
        $('a[href*="/set/"]').first().attr('href')
      if (!setHref) {
        const cards = parseCards($)
        return cardsToPosters(cards)
      }

      const setUrl = setHref.startsWith('http') ? setHref : `${BASE}${setHref}`
      await context.close()
      await sleepConfig('min')
      return this.scrapeSet(setUrl)
    } catch (err) {
      Logger.error('PosterDB', `scrapeSinglePoster failed: ${err instanceof Error ? err.message : err}`)
      return []
    } finally {
      await context.close().catch(() => {})
    }
  }

  /**
   * Scrapes a user's uploads, paginating until a short page or abort.
   *
   * @param url - User profile URL.
   * @returns All posters across the paginated upload pages.
   */
  async scrapeUserUploads(url: string): Promise<PosterInfo[]> {
    const allPosters: PosterInfo[] = []
    let page = 1
    let hasMore = true

    const baseUrl = url.split('?')[0]
    while (hasMore && !this._aborted) {
      const pageUrl = `${baseUrl}?section=uploads&page=${page}`
      const { context, ctx: pageCtx } = await this._newUserPage()

      try {
        await this.navigate(pageCtx, pageUrl, 'div.overlay[data-poster-id]')
        const html = await pageCtx.content()
        const $ = cheerio.load(html)
        const cards = parseCards($)

        if (!cards.length) {
          hasMore = false
        } else {
          allPosters.push(...cardsToPosters(cards))
          // A full page (24 per page) means more may follow; a short page is the last
          hasMore = cards.length >= 24
          page++
          await sleepConfig('batch')
        }
      } catch (err) {
        Logger.error('PosterDB', `scrapeUserUploads page ${page} failed: ${err instanceof Error ? err.message : err}`)
        hasMore = false
      } finally {
        await context.close()
      }
    }

    Logger.scrape('PosterDB', `User uploads ${url} - ${allPosters.length} total posters`)
    return allPosters
  }

  /** Opens a fresh context/page pair with the page aliased to avoid clashing with the loop counter. */
  private async _newUserPage() {
    const { context, page } = await this.newContext()
    return { context, ctx: page }
  }

  /**
   * Loads one page through the headless browser and hands its HTML to a
   * parser. A browser that cannot start propagates, so the caller can say why
   * the site was not searched; a page that fails to load or renders without
   * the expected content yields null.
   *
   * @param url - Page to load.
   * @param waitFor - Selector that signals the content rendered.
   * @param parse - Receives the loaded HTML; may return null to reject the page.
   * @returns The parser's result, or null when the page was unusable.
   */
  private async _withPage<T>(
    url: string,
    waitFor: string,
    parse: ($: cheerio.CheerioAPI) => T | null,
  ): Promise<T | null> {
    const { context, page } = await this.newContext()
    try {
      await context.route('**/*', route =>
        HEAVY_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue())
      await this.navigate(page, url, waitFor)
      const $ = cheerio.load(await page.content())
      if (!$(waitFor).length) {
        Logger.warn('PosterDB', `Page rendered without its content [${url}]`)
        return null
      }
      return parse($)
    } catch (err) {
      Logger.warn('PosterDB', `Page load failed [${url}]: ${err instanceof Error ? err.message : err}`)
      return null
    } finally {
      await context.close().catch(() => {})
    }
  }

  /**
   * Loads one page, over plain HTTP first and through the browser only when
   * the fetch fails or comes back without the expected content.
   *
   * @param url - Page to load.
   * @param waitFor - Selector that proves the content is there.
   * @param parse - Receives the loaded HTML; may return null to reject the page.
   * @returns The parser's result, or null when neither path produced a usable page.
   */
  private async _loadPage<T>(
    url: string,
    waitFor: string,
    parse: ($: cheerio.CheerioAPI) => T | null,
  ): Promise<T | null> {
    const html = await fetchHtml(url)
    if (html !== null) {
      const $ = cheerio.load(html)
      if ($(waitFor).length) {
        const result = parse($)
        if (result !== null) return result
      }
    }
    if (this._aborted) return null
    return this._withPage(url, waitFor, parse)
  }

  /**
   * Resolves a Plex title to its best ThePosterDB media page.
   *
   * @param title - Plex title.
   * @param year - Release year, when known.
   * @param type - Movie, show, or collection.
   * @param fresh - Skip the remembered match (the panel's Refresh button).
   * @returns The matching media page, or null when the title isn't on the site.
   */
  async findMedia(title: string, year: number | undefined, type: PosterdbMediaType, fresh = false): Promise<SearchHit | null> {
    return (await this.findMediaCandidates(title, year, type, fresh))[0] ?? null
  }

  /**
   * Resolves a Plex title to its ThePosterDB media pages. ThePosterDB gates
   * external-id search behind TPDb Pro, so this matches on title and year.
   * Search results are paginated newest-first, so a title whose name recurs
   * in newer releases sits a few pages in; the walk stops at the first row
   * whose year agrees, and takes that page's duplicate entries along.
   *
   * @param title - Plex title.
   * @param year - Release year, when known.
   * @param type - Movie, show, or collection.
   * @param fresh - Skip the remembered match (the panel's Refresh button).
   * @returns The matching media pages, best first; empty when the title isn't on the site.
   */
  async findMediaCandidates(title: string, year: number | undefined, type: PosterdbMediaType, fresh = false): Promise<SearchHit[]> {
    const wants = titleAliases(title, type)
    if (!wants.length) return []

    const cacheKey = mediaCacheKey(title, year, type)
    const cached = mediaIdCache.get(cacheKey)
    if (cached && !fresh && Date.now() - cached.at < (cached.hits.length ? MEDIA_ID_TTL : MEDIA_MISS_TTL)) return cached.hits

    const label = `${type} "${title}"${year ? ` (${year})` : ''}`
    let fallback: SearchHit[] = []
    let rows = 0
    for (let page = 1; page <= MAX_SEARCH_PAGES && !this._aborted; page++) {
      const url = `${BASE}/search?term=${encodeURIComponent(title)}&section=${SEARCH_SECTION[type]}${page > 1 ? `&page=${page}` : ''}`
      const hits = await this._loadPage(url, 'a[href*="/posters/"]', $ => isSearchPage($) ? parseSearchHits($) : null)
      // A page that failed to load, or that was not a results page at all,
      // says nothing about the title: leave the cache alone so the next open
      // retries instead of showing an empty panel for hours.
      if (hits === null) return fallback

      rows += hits.length
      const found = pickSearchHits(hits, wants, year)
      if (found.length && yearMatches(found[0], year)) {
        mediaIdCache.set(cacheKey, { hits: found, at: Date.now() })
        return found
      }
      if (!fallback.length) fallback = found
      if (hits.length < SEARCH_PAGE_SIZE) break
      await sleepConfig('min')
    }
    if (this._aborted) return fallback

    mediaIdCache.set(cacheKey, { hits: fallback, at: Date.now() })
    if (!fallback.length) Logger.scrape('PosterDB', `No match for ${label} among ${rows} result(s)`)
    return fallback
  }

  /**
   * Lists ThePosterDB sets for a title (library browser). Resolves the title
   * to its media pages, then reads them.
   *
   * @param title - Plex title.
   * @param year - Release year, when known.
   * @param type - Movie, show, or collection.
   * @param fresh - Skip the remembered title match.
   * @returns Set summaries, most-downloaded first, with a flag when the site has more.
   */
  async browseSets(title: string, year: number | undefined, type: PosterdbMediaType, fresh = false): Promise<PosterdbBrowseResult> {
    const media = await this.findMediaCandidates(title, year, type, fresh)
    if (!media.length || this._aborted) return NO_RESULT
    return this.browseMediaPages(media.map(m => m.mediaId), title, year, type)
  }

  /**
   * Walks one media page's listing for the sets on it.
   *
   * @param mediaUrl - The media page.
   * @returns Its sets in page order, how many posters it listed, and whether the last page read was full.
   */
  private async _collectStubs(mediaUrl: string): Promise<{ stubs: SetStub[]; cards: number; full: boolean }> {
    const stubs: SetStub[] = []
    const seen = new Set<string>()
    let cards = 0
    let full = false
    for (let page = 1; page <= MAX_BROWSE_PAGES && !this._aborted; page++) {
      const url = page > 1 ? `${mediaUrl}?page=${page}` : mediaUrl
      const found = await this._loadPage(url, MEDIA_PAGE_MARKER, $ => isMediaPage($) ? parseCards($) : null)
      if (!found?.length) {
        full = false
        break
      }
      cards += found.length
      for (const stub of stubsFromCards(found)) {
        if (seen.has(stub.setId)) continue
        seen.add(stub.setId)
        stubs.push(stub)
      }
      full = found.length >= MEDIA_PAGE_SIZE
      if (!full) break
      if (page < MAX_BROWSE_PAGES) await sleepConfig('min')
    }
    return { stubs, cards, full }
  }

  /**
   * Lists the sets on a title's media pages. Each page is walked for the sets
   * it lists, then every multi-poster set is expanded from its own page so
   * seasons, backdrops and collection siblings come through - a media page
   * only ever shows one poster per set. Duplicate pages are merged, the
   * fullest first, so a title whose newest entry is an empty shell still
   * shows everything the site has.
   *
   * @param mediaIds - The media pages, best first.
   * @param title - Plex title the posters are classified against.
   * @param year - Its release year, when known.
   * @param type - Movie, show, or collection.
   * @returns Set summaries, most-downloaded first, with a flag when the site has more.
   */
  async browseMediaPages(mediaIds: string[], title: string, year: number | undefined, type: PosterdbMediaType): Promise<PosterdbBrowseResult> {
    const pages: Array<{ url: string; stubs: SetStub[]; cards: number; full: boolean }> = []
    for (const [i, id] of mediaIds.entries()) {
      if (this._aborted) return NO_RESULT
      if (i > 0) await sleepConfig('min')
      const url = `${BASE}/posters/${id}`
      pages.push({ url, ...(await this._collectStubs(url)) })
    }
    if (this._aborted || !pages.length) return NO_RESULT

    // The fullest page is the title's real entry; the rest add what it lacks.
    pages.sort((a, b) => b.cards - a.cards)
    const mediaUrl = pages[0].url
    const stubs: SetStub[] = []
    const seen = new Set<string>()
    for (const page of pages) {
      for (const stub of page.stubs) {
        if (seen.has(stub.setId)) continue
        seen.add(stub.setId)
        stubs.push(stub)
      }
    }

    const capped = pages.some(p => p.full) || stubs.length > MAX_BROWSE_SETS
    const wanted = stubs.slice(0, MAX_BROWSE_SETS)

    // Avatars resolve alongside the set expansion, so they add no wait of
    // their own.
    const avatarsP = resolveAvatars(wanted.map(s => s.uploader))

    const concurrency = Math.max(1, Math.min(SET_FETCH_CONCURRENCY, ConfigService.get().maxWorkers))
    const summaries = await mapPool(wanted, concurrency, async stub => {
      // A one-poster set is fully described by the card we already have, so the
      // common movie case costs no extra page loads at all.
      if (stub.size <= 1) {
        const posters = classifySetPosters(cardsToPosters([stub.card]), title, year, type)
        return stubToSummary(stub, posters, stub.card.title, type)
      }
      if (this._aborted) return null
      const setUrl = `${BASE}/set/${stub.setId}`
      const parsed = await this._loadPage(setUrl, 'div.overlay[data-poster-id]', $ => ({
        cards: parseCards($).filter(isMediaCard),
        name: parseSetPageTitle($('title').first().text()),
      }))
      if (!parsed?.cards.length) return null
      const posters = classifySetPosters(cardsToPosters(parsed.cards), title, year, type)
      return stubToSummary(stub, posters, parsed.name || stub.card.title, type)
    })

    const avatars = await avatarsP
    // mapPool keeps input order, so the index is the set's place on the
    // downloads-sorted media page.
    const sets = summaries
      .map((s, i): PosterSetSummary | null => (s ? { ...s, popularityRank: i } : null))
      .filter((s): s is PosterSetSummary => s !== null && s.posters.length > 0)
      .map(s => {
        const avatar = avatars.get(s.uploader.toLowerCase())
        return avatar ? { ...s, uploaderAvatar: avatar } : s
      })
    Logger.scrape(
      'PosterDB',
      `Browse ${type} "${title}"${year ? ` (${year})` : ''} - ${sets.length} set(s) from ${mediaUrl}`
        + `${pages.length > 1 ? ` and ${pages.length - 1} duplicate page(s)` : ''}${capped ? ' (more on the site)' : ''}`,
    )
    return { sets, capped, mediaUrl }
  }

  /**
   * Reads the sets behind a link the user attached to a title: a set page,
   * a poster page (its set), or a media page (every set listed there).
   *
   * @param url - ThePosterDB link.
   * @param title - Plex title the posters are classified against.
   * @param year - Its release year, when known.
   * @param type - Movie, show, or collection.
   * @returns The sets, ready for the Library Browser.
   * @throws When the link is a profile or not a page the app reads, or the page cannot be read.
   */
  async linkSets(url: string, title: string, year: number | undefined, type: PosterdbMediaType): Promise<PosterSetSummary[]> {
    switch (posterdbUrlType(url)) {
      case 'set': {
        const set = await this._linkSet(/\/set\/(\d+)/.exec(url)![1], title, year, type)
        return set ? [set] : []
      }
      case 'poster': {
        const setId = await this._loadPage(url, 'a[title="View Set Page"], #main_poster_container, div.overlay[data-poster-id]', parentSetId)
        if (setId === null) throw new Error('The poster page could not be read')
        if (!setId) throw new Error('This poster is not part of a set; link a set or a title page instead')
        const set = await this._linkSet(setId, title, year, type)
        return set ? [set] : []
      }
      case 'media':
        return (await this.browseMediaPages([/\/posters\/(\d+)/.exec(url)![1]], title, year, type)).sets
      case 'user':
        throw new Error('A profile lists every upload; link a set, a poster, or a title page instead')
      default:
        throw new Error('Not a ThePosterDB set, poster, or title page link')
    }
  }

  /**
   * Builds the summary for one set from its own page.
   *
   * @param setId - The set's id on the site.
   * @param title - Plex title the posters are classified against.
   * @param year - Its release year, when known.
   * @param type - Movie, show, or collection.
   * @returns The summary, or null when the set has no movie, show, or collection posters.
   * @throws When the page cannot be read.
   */
  private async _linkSet(setId: string, title: string, year: number | undefined, type: PosterdbMediaType): Promise<PosterSetSummary | null> {
    const parsed = await this._loadPage(`${BASE}/set/${setId}`, 'div.overlay[data-poster-id]', $ => ({
      cards: parseCards($).filter(isMediaCard),
      name: parseSetPageTitle($('title').first().text()),
    }))
    if (!parsed) throw new Error('The set page could not be read')
    if (!parsed.cards.length) return null
    const stub: SetStub = stubsFromCards(parsed.cards).find(s => s.setId === setId)
      ?? { setId, uploader: parsed.cards[0].uploader ?? 'Unknown', size: parsed.cards.length, card: parsed.cards[0] }
    const posters = classifySetPosters(cardsToPosters(parsed.cards), title, year, type)
    const summary = stubToSummary(stub, posters, parsed.name || stub.card.title, type)
    const avatar = (await resolveAvatars([summary.uploader])).get(summary.uploader.toLowerCase())
    return avatar ? { ...summary, uploaderAvatar: avatar } : summary
  }
}
