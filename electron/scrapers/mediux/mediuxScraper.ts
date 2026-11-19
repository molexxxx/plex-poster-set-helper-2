import { BaseScraper, USER_AGENTS, pick, sleep, sleepConfig, mapPool, withTimeout } from '../baseScraper'
import { Logger } from '../../services/logger'
import { errorWithCause, isTimeoutError } from '../../services/readableError'
import { splitTrailingYear } from '../../services/titleParse'
import { ConfigService } from '../../services/config'
import { sitePageUrl, MEDIUX_SITE } from '../siteUrl'
import type { PosterInfo, PosterSetSummary, MediuxUserSet } from '../../ipc/types'
import type { Page } from 'playwright'
import type { MediuxSet, Fallback } from './mediuxTypes'
import { hasFlightData, setsFromScripts, parseOgTitle } from './flightPayload'
import { parseTitleYear, memberIdIndex, fileToInfo } from './posterFiles'
import { normalizeCollectionName, setToSummary, setDownloads, keepDownloads, rankByDownloads, deriveSetFallback } from './setSummaries'

/*
 * MediUX embeds set data inside the Next.js App Router RSC flight payload
 * (self.__next_f.push([...]) inline <script> tags) - NOT in __NEXT_DATA__ and
 * NOT in the public Directus API (which is now 403). The data is server-rendered
 * into the raw HTML, so a plain fetch works; a browser is only a fallback.
 *
 * Approach ported from the Python project:
 * github.com/tonywied17/plex-poster-set-helper-2 (src/scrapers/mediux_scraper.py)
 */

/** Creator pages server-render up to 10 MB of set data, so they get a longer fetch budget. */
const USER_PAGE_TIMEOUT_MS = 60_000
const USER_PAGE_RETRY_MS = 2_000
/**
 * Set and title pages MediUX has not rendered lately take 20 to 40 seconds to
 * build on its side. The render fills MediUX's cache, so a second request
 * usually answers in a few seconds.
 */
const PAGE_TIMEOUT_MS = 60_000
const PAGE_RETRY_TIMEOUT_MS = 30_000
/** Longest wait for a loaded browser page to hand over its script tags. */
const SCRIPTS_READ_TIMEOUT_MS = 20_000
/** Creator pages fetched concurrently during a catalog crawl. */
const USER_CRAWL_BATCH = 4
/**
 * Pages of already-seen sets a resumed crawl walks before it calls the catalog
 * finished. Sets added since the checkpoint push known sets onto later pages,
 * so the pages just past the resume point can hold nothing new mid-catalog.
 */
const RESUME_SLACK_PAGES = 12

/**
 * Rebuilds a MediUX page URL on https://mediux.pro (see sitePageUrl).
 *
 * @param url - Page URL to check; a missing scheme is treated as https.
 * @returns The page on the site's origin, or null when it is not a MediUX page.
 */
export function mediuxPageUrl(url: string): string | null
{
  return sitePageUrl(url, MEDIUX_SITE)
}

/** A page's sets as plain HTTP read them, with whether the page was MediUX's own. */
interface PageSets { sets: MediuxSet[]; fallback: Fallback; flight: boolean }

/** Shown after "MediUX could not be searched:" when a title page never answered. */
const SLOW_TITLE_MESSAGE = 'it took more than a minute to answer. A second try is usually quick, so use Refresh in a moment.'
/** Shown for a scraped link that never answered. */
const SLOW_PAGE_MESSAGE = 'MediUX took more than a minute to answer. A second try is usually quick, so run it again in a moment.'

/** Scrapes MediUX set, boxset, and creator pages via the server-rendered RSC payload. */
export class MediuxScraper extends BaseScraper
{

  /**
   * Scrapes a MediUX URL into posters, using plain HTTP first and a browser
   * as fallback.
   *
   * @param url - Set, boxset, show, or creator page URL.
   * @param types - File types to keep; unset keeps the types picked in Settings.
   * @returns Posters of the allowed file types.
   */
  async scrape(url: string, types?: readonly string[]): Promise<PosterInfo[]>
  {
    Logger.scrape('MediUX', `Scraping: ${url}`)
    const allowed = new Set<string>(types ?? ConfigService.get().mediuxFilters)

    let result: PageSets | null = null
    try
    {
      result = await this._fetchPage(url)
    }
    catch (err)
    {
      // MediUX renders the page for the browser just as slowly.
      if (isTimeoutError(err)) throw errorWithCause(SLOW_PAGE_MESSAGE, err)
    }
    if (result?.sets.length)
    {
      // Boxset pages strip per-file metadata (no movie_id / file titles), so a
      // collection set's posters can't be told apart. Re-fetch each collection
      // set's own /sets/{id} page, which carries the full per-movie metadata.
      const sets = /\/boxsets\//i.test(url)
        ? await this._enrichCollectionSets(result.sets)
        : result.sets
      return this._emit(sets, allowed, url, result.fallback)
    }
    if (result?.flight)
    {
      Logger.warn('MediUX', `No set data found for: ${url}`)
      return []
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
  private async _enrichCollectionSets(sets: MediuxSet[]): Promise<MediuxSet[]>
  {
    // Each set's /sets/{id} re-fetch is independent, so fan them out with a small
    // concurrency cap instead of one slow round-trip after another.
    return mapPool(sets, 4, async s =>
    {
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
      try
      {
        const full = await this._fetchPage(`https://mediux.pro/sets/${s.id}`)
        const found = full.sets.find(x => String(x.id) === String(s.id))
        const fullSet = found && keepDownloads(found, s)
        if (fullSet?.files?.some(f => f.movie_id))
        {
          Logger.scrape('MediUX', `Enriched collection set ${s.id} (${s.collection?.collection_name}) via /sets/${s.id}`)
          return fullSet
        }
        return fullSet ?? s
      }
      catch (err)
      {
        Logger.warn('MediUX', `Could not read collection set ${s.id} for its per-movie details, so its posters may not match the right movies: ${err instanceof Error ? err.message : err}`)
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
  async browseSets(tmdbId: string, type: 'movie' | 'show'): Promise<PosterSetSummary[]>
  {
    const url = `https://mediux.pro/${type === 'movie' ? 'movies' : 'shows'}/${tmdbId}`
    Logger.scrape('MediUX', `Browsing sets: ${url}`)

    const allTypes = new Set(['poster', 'backdrop', 'title_card'])
    let result: PageSets | null = null
    try
    {
      result = await this._fetchPage(url)
    }
    catch (err)
    {
      if (isTimeoutError(err)) throw errorWithCause(SLOW_TITLE_MESSAGE, err)
    }
    let sets = result?.sets ?? []
    const fallback = result?.fallback ?? {}

    // A real title page without sets has none to find; only a block or
    // challenge page is worth a browser load.
    if (!sets.length && !result?.flight)
    {
      const { context, page } = await this.newContext()
      try
      {
        await sleepConfig('initial')
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await page.waitForSelector('script', { timeout: 5_000 }).catch(() => {})
        await page.waitForTimeout(1500)
        const scripts = await this._readScripts(page)
        sets = setsFromScripts(scripts)
      }
      finally
      {
        await this.closeContext(context)
      }
    }

    if (!sets?.length)
    {
      Logger.warn('MediUX', `No sets found for ${type} ${tmdbId}`)
      return []
    }

    // Recover per-movie metadata for any collection set that came back stripped,
    // so its posters can be told apart and routed to the right movie. No-op for
    // ordinary sets and for collection sets that already carry movie_id.
    sets = await this._enrichCollectionSets(sets)

    const summaries = rankByDownloads(sets.map(s => ({ ...setToSummary(s, allTypes, fallback), downloads: setDownloads(s) })))
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
  ): Promise<PosterSetSummary[]>
  {
    const allTypes = new Set(['poster', 'backdrop', 'title_card'])
    const collNorm = normalizeCollectionName(collectionTitle)

    const matchesTitle = (name: string) =>
    {
      const n = normalizeCollectionName(name)
      return n === collNorm || n.includes(collNorm) || collNorm.includes(n)
    }

    const hasCollectionArt = (s: PosterSetSummary) =>
      s.posters.some(p => p.isCollection)
      || (/\bcollection\b/i.test(s.setName) && matchesTitle(s.setName))

    const filterSummaries = (raw: MediuxSet[]) =>
      raw
        .map(s => setToSummary(s, allTypes, deriveSetFallback(s)))
        .filter(s =>
        {
          if (!hasCollectionArt(s)) return false
          if (matchesTitle(s.setName)) return true
          return s.posters.some(p => p.isCollection && matchesTitle(p.title))
        })

    const rawById = new Map<string, MediuxSet>()
    const fetchInto = async (url: string, timeoutMs: number) =>
    {
      try
      {
        const result = await this._fetchSets(url, timeoutMs)
        for (const s of result?.sets ?? []) rawById.set(String(s.id), s)
      }
      catch (err)
      {
        Logger.warn('MediUX', `Collection fetch failed for ${url}: ${err instanceof Error ? err.message : err}`)
      }
    }

    // Cache enrichment so the member-movie fallback loop, which calls finalize()
    // after every fetch, only re-fetches /sets/{id} for sets it hasn't enriched
    // yet instead of re-enriching the whole accumulated pile each pass.
    const enrichedById = new Map<string, MediuxSet>()
    const finalize = async (): Promise<PosterSetSummary[]> =>
    {
      const pending = [...rawById.values()].filter(s => !enrichedById.has(String(s.id)))
      for (const s of await this._enrichCollectionSets(pending)) enrichedById.set(String(s.id), s)
      if (!enrichedById.size) return []
      return filterSummaries([...enrichedById.values()])
    }

    Logger.scrape('MediUX', `Browsing collection sets: "${collectionTitle}"`)

    // TMDB collection pages can be very large (multi-MB); use a longer timeout and
    // skip member-movie scans when this page already yields matches.
    if (tmdbCollectionId)
    {
      await fetchInto(`https://mediux.pro/collections/${tmdbCollectionId}`, 90_000)
      const fromCollection = await finalize()
      if (fromCollection.length)
      {
        Logger.scrape('MediUX', `Collection browse: ${fromCollection.length} matching set(s) for "${collectionTitle}"`)
        return fromCollection
      }
    }

    // Fall back to member movies (cap scans — franchise pages are also huge).
    const maxChildScans = tmdbCollectionId ? 2 : 3
    for (const id of childTmdbIds.slice(0, maxChildScans))
    {
      if (this._aborted) break
      await fetchInto(`https://mediux.pro/movies/${id}`, 60_000)
      const partial = await finalize()
      if (partial.length)
      {
        Logger.scrape('MediUX', `Collection browse: ${partial.length} matching set(s) for "${collectionTitle}"`)
        return partial
      }
    }

    if (!rawById.size)
    {
      Logger.warn('MediUX', `No raw sets found for collection "${collectionTitle}"`)
      return []
    }

    const summaries = await finalize()
    Logger.scrape('MediUX', `Collection browse: ${summaries.length} matching set(s) for "${collectionTitle}"`)
    return summaries
  }

  /**
   * Reads the sets behind a link the user attached to a title: one set, a
   * boxset's sets, or every set on a movie or show page.
   *
   * @param url - MediUX link.
   * @returns The sets, ready for the Library Browser.
   * @throws When the link is a creator page or not a page the app reads, or the page has no set data.
   */
  async linkSets(url: string): Promise<PosterSetSummary[]>
  {
    const titlePage = /\/(movies|shows)\/(\d+)/.exec(url)
    if (titlePage) return this.browseSets(titlePage[2], titlePage[1] === 'movies' ? 'movie' : 'show')
    if (/\/user\//.test(url)) throw new Error('A creator page lists every set they made; open it from the Creators tab, or link one set, a boxset, or a title page here')
    const set = /\/sets\/(\d+)/.exec(url)
    if (!set && !/\/boxsets\/\d+/.test(url)) throw new Error('Not a MediUX set, boxset, movie, or show page link')

    let result: PageSets
    try
    {
      result = await this._fetchPage(url)
    }
    catch (err)
    {
      throw isTimeoutError(err) ? errorWithCause(SLOW_PAGE_MESSAGE, err) : err
    }
    if (!result.sets.length) throw new Error('No set data found at that link')
    const own = set ? result.sets.filter(s => String(s.id) === set[1]) : result.sets
    const sets = await this._enrichCollectionSets(own.length ? own : result.sets)
    const allTypes = new Set(['poster', 'backdrop', 'title_card'])
    return sets.map(s => ({
      ...setToSummary(s, allTypes, { ...result.fallback, ...deriveSetFallback(s) }),
      downloads: setDownloads(s),
    }))
  }

  /**
   * Lists one page of a creator's sets with a parsed title/year per set so the
   * caller can match them against the Plex library. matchedKey is filled in
   * later by the library handler.
   *
   * NOTE: MediUX's `?page=N` is NOT cumulative. Each page server-renders a
   * ~24-set sliding window that advances ~12 new sets per page (page N shares
   * ~12 sets with page N-1). To collect a creator's full catalog you must walk
   * every page and dedupe by set id - see browseAllUserSets().
   *
   * @param username - Creator to browse.
   * @param page - 1-based page; each page is a 24-set window, +12 new per page.
   * @returns The creator's own sets from that page.
   */
  async browseUserSets(username: string, page = 1): Promise<MediuxUserSet[]>
  {
    const base = `https://mediux.pro/user/${encodeURIComponent(username)}/sets`
    const url = page > 1 ? `${base}?page=${page}` : base
    // No per-page log here: a full catalog crawl walks hundreds of pages, so the
    // batch/summary lines in browseAllUserSets carry the progress instead.

    const allTypes = new Set(['poster', 'backdrop', 'title_card'])

    // A page that loaded with no sets is the end of the catalog; a page that
    // could not be loaded is an error. Conflating the two made a slow connection
    // look like a short catalog, so transport failures retry once, then fall
    // back to the browser, then throw.
    let sets: MediuxSet[] | null = null
    let flight = false
    let lastError: unknown
    for (let attempt = 0; attempt < 2 && sets === null; attempt++)
    {
      try
      {
        const result = await this._fetchSets(url, USER_PAGE_TIMEOUT_MS, true)
        sets = result?.sets ?? []
        flight = !!result?.flight
      }
      catch (err)
      {
        lastError = err
        if (attempt === 0) await sleep(USER_PAGE_RETRY_MS)
      }
    }

    // A real page with no sets is past the end of the catalog, and a browser
    // load would find none either.
    if (!sets?.length && !flight)
    {
      const { context, page: pg } = await this.newContext()
      try
      {
        await sleepConfig('initial')
        await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await pg.waitForSelector('script', { timeout: 5_000 }).catch(() => {})
        await pg.waitForTimeout(1500)
        const found = setsFromScripts(await this._readScripts(pg))
        if (found.length) sets = found
      }
      finally
      {
        await this.closeContext(context)
      }
      if (sets === null)
      {
        throw new Error(`Could not load page ${page} of @${username}'s sets: ${lastError instanceof Error ? lastError.message : lastError}`)
      }
    }

    // An empty page is normal at the end of a crawl; stay quiet and let the
    // caller detect the end of the catalog.
    if (!sets?.length) return []

    // The page can include other creators' sets (recommendations) - keep only this
    // creator's own (plus any set lacking a denormalised username, to be safe)
    const target = username.toLowerCase()
    const owned = sets.filter(s =>
    {
      const u = s.user_created?.username?.toLowerCase()
      return !u || u === target
    })

    const out = owned.map(s =>
    {
      const fb = deriveSetFallback(s)
      const summary = setToSummary(s, allTypes, fb)
      return {
        ...summary,
        title: fb.title ?? summary.setName,
        year: fb.year,
        dateUpdated: s.date_updated,
      } as MediuxUserSet
    })
    return out
  }

  /**
   * Walks a creator's entire set catalog by paging through browseUserSets() and
   * deduping by set id, returning every set the creator owns.
   *
   * MediUX serves a ~24-set sliding window per page (+12 new each page), so the
   * old "fetch page N for the first N*12" shortcut no longer works - a single
   * page only ever yields ~24 sets. Pages are independent and deterministic, so
   * each batch of pages is fetched concurrently (mapPool); the crawl stops when
   * a whole batch contributes no new ids (past the end of the catalog) or the
   * page cap is hit.
   *
   * When `onBatch` is supplied, each deduped batch is emitted as it lands (and a
   * final `done: true` batch), so a caller can stream results instead of waiting
   * for the whole crawl. A `signal` overrides the shared abort flag so a
   * background crawl survives a foreground scrape cancel (and vice-versa).
   *
   * A page that cannot be loaded rejects the crawl rather than ending it, so a
   * caller never mistakes a partial catalog for a complete one.
   *
   * @param username - Creator to browse.
   * @param opts.batchSize - Pages fetched concurrently per round (default 4;
   *   each page is several MB, so more parallel fetches start timing out).
   * @param opts.maxPages - Safety bound on total pages crawled (default 400 ~=
   *   4800 sets at +12/page).
   * @param opts.signal - Per-crawl abort token; when present it replaces the
   *   scraper's shared `_aborted` flag for this crawl's loop guard.
   * @param opts.onBatch - Called with each batch's new sets, then once with an
   *   empty `done: true` batch.
   * @param opts.startPage - First page to fetch, to resume a checkpointed crawl.
   * @param opts.seen - Set ids collected before the resume point; they are
   *   skipped, and pages holding only them do not end the crawl at once.
   * @returns The deduped sets (newest-first) and whether the page cap stopped it.
   */
  async browseAllUserSets(
    username: string,
    opts: {
      batchSize?: number
      maxPages?: number
      signal?: { aborted: boolean }
      onBatch?: (newSets: MediuxUserSet[], info: { page: number; done: boolean; capped: boolean }) => void | Promise<void>
      startPage?: number
      seen?: ReadonlySet<string>
    } = {},
  ): Promise<{ sets: MediuxUserSet[]; capped: boolean }>
  {
    const batchSize = Math.max(1, opts.batchSize ?? USER_CRAWL_BATCH)
    const maxPages  = Math.max(batchSize, opts.maxPages ?? 400)
    const { signal, onBatch } = opts
    // A per-crawl signal takes over abort control entirely, decoupling a
    // background creator crawl from the shared foreground-scrape abort flag.
    const aborted = () => (signal ? signal.aborted : this._aborted)

    const seen = new Set<string>(opts.seen ?? [])
    const all: MediuxUserSet[] = []
    let reachedEnd = false
    let lastPage = 0
    let resumeSlack = seen.size > 0 ? RESUME_SLACK_PAGES : 0

    // When streaming, fetch a small first batch so the first sets render almost
    // immediately, then ramp up to the full concurrent batch size.
    let start = Math.max(1, opts.startPage ?? 1)
    let curBatch = onBatch ? Math.min(2, batchSize) : batchSize
    while (start <= maxPages && !aborted())
    {
      const pages: number[] = []
      for (let p = start; p < start + curBatch && p <= maxPages; p++) pages.push(p)
      lastPage = pages[pages.length - 1]

      // Pages are independent, so fetch the whole batch concurrently.
      const batch = await mapPool(pages, curBatch, p => this.browseUserSets(username, p))
      if (aborted()) break

      const fresh: MediuxUserSet[] = []
      // Merge in page order so the accumulated list stays newest-first.
      for (const pageSets of batch)
      {
        for (const s of pageSets)
        {
          if (seen.has(s.id)) continue
          seen.add(s.id)
          all.push(s)
          fresh.push(s)
        }
      }

      // A full batch with no new ids means we've gone past the catalog's end,
      // unless a resumed crawl is still inside sets it collected before.
      if (fresh.length === 0)
      {
        const empty = batch.every(pageSets => pageSets.length === 0)
        if (empty || resumeSlack <= 0) { reachedEnd = true; break }
        resumeSlack -= pages.length
      }
      else
      {
        resumeSlack = 0
      }

      await onBatch?.(fresh, { page: lastPage, done: false, capped: false })

      const more = start + curBatch <= maxPages
      start += curBatch
      curBatch = batchSize   // ramp to full batches after the fast first pull

      // Be polite to MediUX between concurrent batches.
      if (more && !aborted()) await sleepConfig('batch')
    }

    const capped = !reachedEnd && !aborted() && all.length > 0
    Logger.scrape('MediUX', `Creator "${username}": ${all.length} total set(s)${capped ? ' (page cap hit)' : ''}`)
    await onBatch?.([], { page: lastPage, done: true, capped })
    return { sets: all, capped }
  }

  /**
   * Fetches a page over plain HTTP, extracts its script blocks, and parses the
   * RSC payload into sets.
   *
   * @param url - Page to fetch.
   * @param timeoutMs - Fetch budget.
   * @param strict - Throw on a transport failure or empty body instead of
   *   returning null, for callers that must tell a failed page from one with
   *   no sets. Such a caller retries or reports the failure, so it is logged
   *   here only at scrape level.
   * @returns The sets (empty when the page has none), an og:title fallback, and
   *   whether the page carried MediUX's data payload; null when the page could
   *   not be read or the URL is not a MediUX page.
   */
  private async _fetchSets(
    url: string,
    timeoutMs = 25_000,
    strict = false,
  ): Promise<PageSets | null>
  {
    const page = mediuxPageUrl(url)
    if (!page)
    {
      Logger.warn('MediUX', `Refused to fetch a URL outside mediux.pro: ${url}`)
      if (strict) throw new Error(`Not a MediUX page: ${url}`)
      return null
    }
    try
    {
      const res = await fetch(page, {
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
      if (!html || html.length < 500)
      {
        if (strict) throw new Error(`HTTP ${res.status} with an empty page`)
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
      return { sets, fallback, flight: hasFlightData(scripts) }
    }
    catch (err)
    {
      const failure = `HTTP fetch failed for ${url}: ${err instanceof Error ? err.message : err}`
      if (strict)
      {
        Logger.scrape('MediUX', failure)
        throw err instanceof Error ? err : new Error(String(err))
      }
      Logger.warn('MediUX', failure)
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
  private async _scrapeViaBrowser(url: string, allowed: Set<string>): Promise<PosterInfo[]>
  {
    const pageUrl = mediuxPageUrl(url)
    if (!pageUrl)
    {
      Logger.warn('MediUX', `Refused to load a URL outside mediux.pro: ${url}`)
      return []
    }
    Logger.scrape('MediUX', `Browser: ${pageUrl}`)
    const { context, page } = await this.newContext()

    try
    {
      await sleepConfig('initial')
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.waitForSelector('script', { timeout: 5_000 }).catch(() => {})
      await page.waitForTimeout(1500)

      const ogTitle = page.evaluate((): { title?: string } =>
      {
        const doc = (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(a: string): string | null } | null } }).document
        const c = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
        return { title: c ?? undefined }
      })
      const fallback = await withTimeout(ogTitle, SCRIPTS_READ_TIMEOUT_MS, 'the page did not answer').then((r): Fallback =>
      {
        if (!r.title) return {}
        return splitTrailingYear(r.title) ?? { title: r.title }
      }).catch(() => ({} as Fallback))

      const scripts = await this._readScripts(page)
      Logger.scrape('MediUX', `Browser: ${scripts.length} script tag(s)`)

      const sets = setsFromScripts(scripts)
      Logger.scrape('MediUX', `Browser: extracted ${sets.length} set(s)`)

      if (sets.length) return this._emit(sets, allowed, url, fallback)

      Logger.warn('MediUX', `No set data found for: ${url}`)
      return []
    }
    catch (err)
    {
      Logger.error('MediUX', `Browser scrape failed: ${err instanceof Error ? err.message : err}`)
      return []
    }
    finally
    {
      await this.closeContext(context)
    }
  }

  /**
   * Reads the text content of every script tag on the page.
   *
   * @param page - Loaded page.
   * @returns Non-empty script bodies.
   */
  private async _readScripts(page: Page): Promise<string[]>
  {
    const reading = page.$$eval('script', (els: Array<{ textContent: string | null }>) =>
      els.map(e => e.textContent ?? '').filter(Boolean),
    )
    return withTimeout(reading, SCRIPTS_READ_TIMEOUT_MS, 'the page did not hand over its scripts').catch(() => [])
  }

  /**
   * Reads a set or title page over plain HTTP, asking twice. A page MediUX has
   * not rendered lately can take most of a minute to build, and the build
   * fills MediUX's cache, so the second request is usually quick.
   *
   * @param url - Page to read.
   * @returns The page's sets, its og:title fallback, and whether it carried MediUX's data payload.
   * @throws The second request's error when neither is answered.
   */
  private async _fetchPage(url: string): Promise<PageSets>
  {
    try
    {
      return await this._fetchRequired(url, PAGE_TIMEOUT_MS)
    }
    catch (err)
    {
      if (this._aborted || !mediuxPageUrl(url)) throw err
      Logger.scrape('MediUX', `Asking again for ${url}`)
    }
    return this._fetchRequired(url, PAGE_RETRY_TIMEOUT_MS)
  }

  /**
   * Reads a page over plain HTTP, failing instead of returning nothing.
   *
   * @param url - Page to read.
   * @param timeoutMs - Fetch budget.
   * @returns The page's sets, fallback, and payload flag.
   */
  private async _fetchRequired(url: string, timeoutMs: number): Promise<PageSets>
  {
    const result = await this._fetchSets(url, timeoutMs, true)
    if (!result) throw new Error(`Could not read ${url}`)
    return result
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
  private _emit(sets: MediuxSet[], allowed: Set<string>, url: string, fallback: Fallback = {}): PosterInfo[]
  {
    const out: PosterInfo[] = []
    for (const set of sets)
    {
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
