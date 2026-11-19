import * as cheerio from 'cheerio'
import { stripSuffix } from '../../services/titleParse'
import type { PosterInfo } from '../../ipc/types'
import { BASE, posterAssetUrl } from './posterdbSite'

export interface RawCard
{
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
export function parseYear(text: string): number | undefined
{
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
export function parseCardTitle(rawTitle: string): string
{
  const years = /\(\d{4}\)/g
  for (let m = years.exec(rawTitle); m; m = years.exec(rawTitle))
  {
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
function parseShowSeason(text: string): number | 'Cover' | undefined
{
  if (text.includes(' - '))
  {
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
export function parseCards($: cheerio.CheerioAPI): RawCard[]
{
  const cards: RawCard[] = []

  $('div.overlay[data-poster-id]').each((_, el) =>
  {
    const $overlay = $(el)
    const posterId = $overlay.attr('data-poster-id')
    if (!posterId) return

    let $cell = $overlay.closest('div[class*="col-"]')
    if (!$cell.length) $cell = $overlay.parent()

    // The specific selector wins; a comma-joined union with .first() would
    // return whichever match comes first in the markup.
    const firstOf = (...selectors: string[]) =>
    {
      for (const sel of selectors)
      {
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
export function cardsToPosters(cards: RawCard[]): PosterInfo[]
{
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

/** Markup that proves a media page rendered: its poster grid, or the notice an empty one shows instead. */
export const MEDIA_PAGE_MARKER = 'div.overlay[data-poster-id], p.h2'

/**
 * Tells a media page, full or empty, from a challenge or maintenance page
 * that answered in its place. An empty page is a real answer (the title has
 * no posters), so it must not send the browse to the headless browser.
 *
 * @param $ - Cheerio handle over the page HTML.
 * @returns true for a media page.
 */
export function isMediaPage($: cheerio.CheerioAPI): boolean
{
  return $('div.overlay[data-poster-id]').length > 0 || /no posters have been made/i.test($('p.h2').text())
}

/**
 * Only movie, show and collection cards are art for the library; a set can
 * also carry people (a director's poster) that would otherwise be reported as
 * collection members.
 *
 * @param card - A parsed card.
 * @returns true for a card the browser should show.
 */
export function isMediaCard(card: RawCard): boolean
{
  return /movie|show|collection/i.test(card.mediaType)
}
