import * as cheerio from 'cheerio'
import { BaseScraper, sleepConfig, mapPool, waitAtMost } from '../baseScraper'
import { Logger } from '../../services/logger'
import { ConfigService } from '../../services/config'
import type { PosterInfo, PosterSetSummary } from '../../ipc/types'
import type { PosterdbMediaType, PosterdbBrowseResult } from './posterdbTypes'
import { BASE, posterdbPageUrl, posterdbUrlType, fetchHtml } from './posterdbSite'
import { parseCards, cardsToPosters, MEDIA_PAGE_MARKER, isMediaPage, isMediaCard } from './cards'
import { normalizeTitle, type SearchHit, isSearchPage, parseSearchHits, titleAliases, yearMatches, pickSearchHits } from './titleMatch'
import { parentSetId, type SetStub, stubsFromCards, classifySetPosters, stubToSummary, parseSetPageTitle } from './setStubs'
import { AVATAR_WAIT_MS, clearAvatarCache, lookUpAvatars } from './avatars'

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

/** Parallel set-page fetches; the Max Workers setting caps it further. */
const SET_FETCH_CONCURRENCY = 4
/** How long a resolved title -> media-page id mapping stays good. */
const MEDIA_ID_TTL = 6 * 60 * 60 * 1000
/** A miss is remembered only briefly: a new upload or a site hiccup must not hide a title for hours. */
const MEDIA_MISS_TTL = 10 * 60 * 1000

/** Request types a browse page never needs; only its DOM is read. */
const HEAVY_RESOURCES = new Set(['image', 'media', 'font', 'stylesheet'])

/** Resolved media pages, so reopening a title doesn't re-run the search. Empty means the title was not found. */
const mediaIdCache = new Map<string, { hits: SearchHit[]; at: number }>()

/**
 * Builds the key a title's media-page match is remembered under.
 *
 * @param title - Plex title.
 * @param year - Release year, when known.
 * @param type - Movie, show, or collection.
 * @returns The cache key.
 */
export function mediaCacheKey(title: string, year: number | undefined, type: PosterdbMediaType): string
{
  return `${type}|${normalizeTitle(title)}|${year ?? ''}`
}

/** Drops every remembered title match and avatar (Settings -> Clear cached data, and tests). */
export function resetPosterdbCaches(): void
{
  mediaIdCache.clear()
  clearAvatarCache()
}

const NO_RESULT: PosterdbBrowseResult = { sets: [], capped: false }

/** Scrapes ThePosterDB set, single-poster, and user-upload pages via a headless browser. */
export class PosterdbScraper extends BaseScraper
{
  /**
   * Routes a ThePosterDB URL to the matching scrape strategy.
   *
   * @param url - Set, poster, or user page URL.
   * @returns Posters found, empty for unrecognised URLs.
   */
  async scrape(url: string): Promise<PosterInfo[]>
  {
    const type = posterdbUrlType(url)
    Logger.scrape('PosterDB', `Scraping ${type}: ${url}`)

    switch (type)
    {
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
  async scrapeSet(url: string): Promise<PosterInfo[]>
  {
    const setUrl = posterdbPageUrl(url)
    if (!setUrl)
    {
      Logger.warn('PosterDB', `Refused to load a URL outside theposterdb.com: ${url}`)
      return []
    }
    const { context, page } = await this.newContext()
    try
    {
      await this.navigate(page, setUrl, 'div.overlay[data-poster-id]')
      const html = await page.content()
      const $ = cheerio.load(html)
      const cards = parseCards($)
      const posters = cardsToPosters(cards)
      Logger.scrape('PosterDB', `Set ${url} - ${posters.length} posters found`)
      return posters
    }
    catch (err)
    {
      Logger.error('PosterDB', `scrapeSet failed: ${err instanceof Error ? err.message : err}`)
      return []
    }
    finally
    {
      await this.closeContext(context)
    }
  }

  /**
   * Scrapes a single-poster page by locating its parent set, falling back to
   * the poster itself.
   *
   * @param url - Poster page URL.
   * @returns The parent set's posters, or just this poster.
   */
  async scrapeSinglePoster(url: string): Promise<PosterInfo[]>
  {
    const posterUrl = posterdbPageUrl(url)
    if (!posterUrl)
    {
      Logger.warn('PosterDB', `Refused to load a URL outside theposterdb.com: ${url}`)
      return []
    }
    const { context, page } = await this.newContext()
    try
    {
      await this.navigate(page, posterUrl, 'div.overlay[data-poster-id], a[title="View Set Page"]')
      const html = await page.content()
      const $ = cheerio.load(html)

      // "View Set Page" link (new layout), then older fallbacks
      const setHref =
        $('a[data-toggle="tooltip"][title="View Set Page"]').first().attr('href') ||
        $('a.rounded.view_all').first().attr('href') ||
        $('a[href*="/set/"]').first().attr('href')
      if (!setHref)
      {
        const cards = parseCards($)
        return cardsToPosters(cards)
      }

      const setUrl = setHref.startsWith('http') ? setHref : `${BASE}${setHref}`
      await this.closeContext(context)
      await sleepConfig('min')
      return this.scrapeSet(setUrl)
    }
    catch (err)
    {
      Logger.error('PosterDB', `scrapeSinglePoster failed: ${err instanceof Error ? err.message : err}`)
      return []
    }
    finally
    {
      await this.closeContext(context)
    }
  }

  /**
   * Scrapes a user's uploads, paginating until a short page or abort.
   *
   * @param url - User profile URL.
   * @returns All posters across the paginated upload pages.
   */
  async scrapeUserUploads(url: string): Promise<PosterInfo[]>
  {
    const profileUrl = posterdbPageUrl(url)
    if (!profileUrl)
    {
      Logger.warn('PosterDB', `Refused to load a URL outside theposterdb.com: ${url}`)
      return []
    }
    const allPosters: PosterInfo[] = []
    let page = 1
    let hasMore = true

    const baseUrl = profileUrl.split('?')[0]
    while (hasMore && !this._aborted)
    {
      const pageUrl = `${baseUrl}?section=uploads&page=${page}`
      const { context, ctx: pageCtx } = await this._newUserPage()

      try
      {
        await this.navigate(pageCtx, pageUrl, 'div.overlay[data-poster-id]')
        const html = await pageCtx.content()
        const $ = cheerio.load(html)
        const cards = parseCards($)

        if (!cards.length)
        {
          hasMore = false
        }
        else
        {
          allPosters.push(...cardsToPosters(cards))
          // A full page (24 per page) means more may follow; a short page is the last
          hasMore = cards.length >= 24
          page++
          await sleepConfig('batch')
        }
      }
      catch (err)
      {
        Logger.error('PosterDB', `scrapeUserUploads page ${page} failed: ${err instanceof Error ? err.message : err}`)
        hasMore = false
      }
      finally
      {
        await this.closeContext(context)
      }
    }

    Logger.scrape('PosterDB', `User uploads ${url} - ${allPosters.length} total posters`)
    return allPosters
  }

  /** Opens a fresh context/page pair with the page aliased to avoid clashing with the loop counter. */
  private async _newUserPage()
  {
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
  ): Promise<T | null>
  {
    const { context, page } = await this.newContext()
    try
    {
      await context.route('**/*', route =>
        HEAVY_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue())
      await this.navigate(page, url, waitFor)
      const $ = cheerio.load(await page.content())
      if (!$(waitFor).length)
      {
        Logger.warn('PosterDB', `Page rendered without its content [${url}]`)
        return null
      }
      return parse($)
    }
    catch (err)
    {
      Logger.warn('PosterDB', `Page load failed [${url}]: ${err instanceof Error ? err.message : err}`)
      return null
    }
    finally
    {
      await this.closeContext(context)
    }
  }

  /**
   * Loads one page, over plain HTTP first and through the browser only when
   * the fetch fails or comes back without the expected content.
   *
   * @param url - Page to load.
   * @param waitFor - Selector that proves the content is there.
   * @param parse - Receives the loaded HTML; may return null to reject the page.
   * @returns The parser's result, or null when neither path produced a usable page
   *   or the URL is not a ThePosterDB page.
   */
  private async _loadPage<T>(
    url: string,
    waitFor: string,
    parse: ($: cheerio.CheerioAPI) => T | null,
  ): Promise<T | null>
  {
    const page = posterdbPageUrl(url)
    if (!page)
    {
      Logger.warn('PosterDB', `Refused to load a URL outside theposterdb.com: ${url}`)
      return null
    }
    const html = await fetchHtml(page)
    if (html !== null)
    {
      const $ = cheerio.load(html)
      if ($(waitFor).length)
      {
        const result = parse($)
        if (result !== null) return result
      }
    }
    if (this._aborted) return null
    return this._withPage(page, waitFor, parse)
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
  async findMedia(title: string, year: number | undefined, type: PosterdbMediaType, fresh = false): Promise<SearchHit | null>
  {
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
  async findMediaCandidates(title: string, year: number | undefined, type: PosterdbMediaType, fresh = false): Promise<SearchHit[]>
  {
    const wants = titleAliases(title, type)
    if (!wants.length) return []

    const cacheKey = mediaCacheKey(title, year, type)
    const cached = mediaIdCache.get(cacheKey)
    if (cached && !fresh && Date.now() - cached.at < (cached.hits.length ? MEDIA_ID_TTL : MEDIA_MISS_TTL)) return cached.hits

    const label = `${type} "${title}"${year ? ` (${year})` : ''}`
    let fallback: SearchHit[] = []
    let rows = 0
    for (let page = 1; page <= MAX_SEARCH_PAGES && !this._aborted; page++)
    {
      const url = `${BASE}/search?term=${encodeURIComponent(title)}&section=${SEARCH_SECTION[type]}${page > 1 ? `&page=${page}` : ''}`
      const hits = await this._loadPage(url, 'a[href*="/posters/"]', $ => isSearchPage($) ? parseSearchHits($) : null)
      // A page that failed to load, or that was not a results page at all,
      // says nothing about the title: leave the cache alone so the next open
      // retries instead of showing an empty panel for hours.
      if (hits === null) return fallback

      rows += hits.length
      const found = pickSearchHits(hits, wants, year)
      if (found.length && yearMatches(found[0], year))
      {
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
  async browseSets(title: string, year: number | undefined, type: PosterdbMediaType, fresh = false): Promise<PosterdbBrowseResult>
  {
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
  private async _collectStubs(mediaUrl: string): Promise<{ stubs: SetStub[]; cards: number; full: boolean }>
  {
    const stubs: SetStub[] = []
    const seen = new Set<string>()
    let cards = 0
    let full = false
    for (let page = 1; page <= MAX_BROWSE_PAGES && !this._aborted; page++)
    {
      const url = page > 1 ? `${mediaUrl}?page=${page}` : mediaUrl
      const found = await this._loadPage(url, MEDIA_PAGE_MARKER, $ => isMediaPage($) ? parseCards($) : null)
      if (!found?.length)
      {
        full = false
        break
      }
      cards += found.length
      for (const stub of stubsFromCards(found))
      {
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
  async browseMediaPages(mediaIds: string[], title: string, year: number | undefined, type: PosterdbMediaType): Promise<PosterdbBrowseResult>
  {
    const pages: Array<{ url: string; stubs: SetStub[]; cards: number; full: boolean }> = []
    for (const [i, id] of mediaIds.entries())
    {
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
    for (const page of pages)
    {
      for (const stub of page.stubs)
      {
        if (seen.has(stub.setId)) continue
        seen.add(stub.setId)
        stubs.push(stub)
      }
    }

    const capped = pages.some(p => p.full) || stubs.length > MAX_BROWSE_SETS
    const wanted = stubs.slice(0, MAX_BROWSE_SETS)

    const avatars = lookUpAvatars(wanted.map(s => s.uploader))

    const concurrency = Math.max(1, Math.min(SET_FETCH_CONCURRENCY, ConfigService.get().maxWorkers))
    const summaries = await mapPool(wanted, concurrency, async stub =>
    {
      // A one-poster set is fully described by the card we already have, so the
      // common movie case costs no extra page loads at all.
      if (stub.size <= 1)
      {
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

    await waitAtMost(avatars.done, AVATAR_WAIT_MS)
    // mapPool keeps input order, so the index is the set's place on the
    // downloads-sorted media page.
    const sets = summaries
      .map((s, i): PosterSetSummary | null => (s ? { ...s, popularityRank: i } : null))
      .filter((s): s is PosterSetSummary => s !== null && s.posters.length > 0)
      .map(s =>
      {
        const avatar = avatars.avatarOf(s.uploader)
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
  async linkSets(url: string, title: string, year: number | undefined, type: PosterdbMediaType): Promise<PosterSetSummary[]>
  {
    switch (posterdbUrlType(url))
    {
      case 'set':
      {
        const set = await this._linkSet(/\/set\/(\d+)/.exec(url)![1], title, year, type)
        return set ? [set] : []
      }
      case 'poster':
      {
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
  private async _linkSet(setId: string, title: string, year: number | undefined, type: PosterdbMediaType): Promise<PosterSetSummary | null>
  {
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
    const avatars = lookUpAvatars([summary.uploader])
    await waitAtMost(avatars.done, AVATAR_WAIT_MS)
    const avatar = avatars.avatarOf(summary.uploader)
    return avatar ? { ...summary, uploaderAvatar: avatar } : summary
  }
}
