import * as cheerio from 'cheerio'
import { BaseScraper, sleepConfig } from './baseScraper'
import { Logger } from '../services/logger'
import type { PosterInfo } from '../ipc/types'

// --- URL helpers --------------------------------------------------------------

const BASE = 'https://theposterdb.com'

export function posterdbUrlType(url: string): 'set' | 'poster' | 'user' | 'unknown' {
  if (/theposterdb\.com\/set\/\d+/.test(url)) return 'set'
  if (/theposterdb\.com\/poster\/\d+/.test(url)) return 'poster'
  if (/theposterdb\.com\/user\//.test(url)) return 'user'
  return 'unknown'
}

function posterAssetUrl(posterId: string): string {
  // Original-quality image endpoint (matches the Python scraper: /api/assets/{id})
  return `${BASE}/api/assets/${posterId}`
}

// --- Metadata parsing ---------------------------------------------------------

interface RawCard {
  posterId: string
  thumbUrl: string
  title: string
  mediaType: string
  year?: number
  season?: number | 'Cover' | 'Backdrop'
}

function parseYear(text: string): number | undefined {
  const m = text.match(/\((\d{4})\)/)
  return m ? parseInt(m[1]) : undefined
}

// Season for a TV show poster, derived from the title suffix the way ThePosterDB
// formats it: "Title (Year) - Season N" / "- Specials" → 0, otherwise the show
// cover poster. Movies/collections have no season.
function parseShowSeason(text: string): number | 'Cover' | undefined {
  if (text.includes(' - ')) {
    const last = text.split(' - ').pop()!.trim()
    if (/specials/i.test(last)) return 0
    const m = last.match(/season\s+(\d+)/i)
    if (m) return parseInt(m[1])
  }
  return 'Cover'
}

// ThePosterDB renders each poster as a grid cell containing a `div.overlay` that
// carries `data-poster-id`, a tooltip anchor whose `title` is the media type
// (Movie / Show / Collection), and a `p.text-break` title. We anchor on the
// overlay (the most stable hook) and read the rest from its grid cell.
function parseCards($: cheerio.CheerioAPI): RawCard[] {
  const cards: RawCard[] = []

  $('div.overlay[data-poster-id]').each((_, el) => {
    const $overlay = $(el)
    const posterId = $overlay.attr('data-poster-id')
    if (!posterId) return

    // The column wrapper that holds this poster's title + type label.
    let $cell = $overlay.closest('div[class*="col-"]')
    if (!$cell.length) $cell = $overlay.parent()

    // The overlay exposes data-poster-type (movie/show/collection) directly; fall
    // back to the tooltip anchor's title for older markup.
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

    const title = rawTitle.split(' (')[0].trim()
    const year = parseYear(rawTitle)
    const season = /show/i.test(mediaType) ? parseShowSeason(rawTitle) : undefined

    const imgEl = $cell.find('img').first()
    const rawThumb = imgEl.attr('src') ?? imgEl.attr('data-src') ?? imgEl.attr('data-lazy-src') ?? ''
    const thumbUrl = rawThumb.startsWith('http') ? rawThumb : rawThumb ? `${BASE}${rawThumb}` : ''

    cards.push({ posterId, thumbUrl, title, mediaType, year, season })
  })

  return cards
}

function cardsToPosters(cards: RawCard[]): PosterInfo[] {
  return cards.map(c => ({
    title: c.title,
    url: posterAssetUrl(c.posterId),
    thumbUrl: c.thumbUrl || posterAssetUrl(c.posterId),
    source: 'posterdb' as const,
    year: c.year,
    season: c.season,
  }))
}

// --- Scraper ------------------------------------------------------------------

export class PosterdbScraper extends BaseScraper {
  async scrape(url: string): Promise<PosterInfo[]> {
    const type = posterdbUrlType(url)
    Logger.scrape('PosterDB', `Scraping ${type}: ${url}`)

    switch (type) {
      case 'set':    return this.scrapeSet(url)
      case 'poster': return this.scrapeSinglePoster(url)
      case 'user':   return this.scrapeUserUploads(url)
      default:
        Logger.warn('PosterDB', `Unrecognised URL pattern: ${url}`)
        return []
    }
  }

  // -- Set page --------------------------------------------------------------

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

  // -- Single poster → find parent set, recurse ------------------------------

  async scrapeSinglePoster(url: string): Promise<PosterInfo[]> {
    const { context, page } = await this.newContext()
    try {
      await this.navigate(page, url, 'div.overlay[data-poster-id], a[title="View Set Page"]')
      const html = await page.content()
      const $ = cheerio.load(html)

      // Find the "View Set Page" link (new layout), then older fallbacks.
      const setHref =
        $('a[data-toggle="tooltip"][title="View Set Page"]').first().attr('href') ||
        $('a.rounded.view_all').first().attr('href') ||
        $('a[href*="/set/"]').first().attr('href')
      if (!setHref) {
        // Fall back to parsing just this poster's detail page
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

  // -- User uploads - paginate through all pages -----------------------------

  async scrapeUserUploads(url: string): Promise<PosterInfo[]> {
    const allPosters: PosterInfo[] = []
    let page = 1
    let hasMore = true

    const baseUrl = url.split('?')[0]
    while (hasMore && !this._aborted) {
      // ThePosterDB user uploads live under the "uploads" section, paginated.
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
          // Keep going while the page is full (24 per page); a short page is the last.
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

  // Private helper to avoid duplicate context/page naming
  private async _newUserPage() {
    const { context, page } = await this.newContext()
    return { context, ctx: page }
  }
}
