import * as cheerio from 'cheerio'
import { stripSuffix } from '../../services/titleParse'
import type { PosterInfo, PosterSetSummary } from '../../ipc/types'
import type { PosterdbMediaType } from './posterdbTypes'
import { BASE, posterAssetUrl } from './posterdbSite'
import type { RawCard } from './cards'
import { normalizeTitle } from './titleMatch'

/**
 * Reads the set a poster page belongs to.
 *
 * @param $ - Cheerio handle over the poster page HTML.
 * @returns The set id, or an empty string for a poster uploaded on its own.
 */
export function parentSetId($: cheerio.CheerioAPI): string
{
  const href =
    $('a[data-toggle="tooltip"][title="View Set Page"]').first().attr('href') ||
    $('a.rounded.view_all').first().attr('href') ||
    ''
  return /\/set\/(\d+)/.exec(href)?.[1] ?? ''
}

/** A set discovered on a media page, before its full contents are known. */
export interface SetStub
{
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
export function stubsFromCards(cards: RawCard[]): SetStub[]
{
  const stubs = new Map<string, SetStub>()
  for (const c of cards)
  {
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
): PosterInfo[]
{
  const want = normalizeTitle(title)
  return posters.map(p =>
  {
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
): PosterSetSummary
{
  let posterCount = 0, backdropCount = 0, titleCardCount = 0
  for (const p of posters)
  {
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

/**
 * Set names on set pages carry the title's year ("Breaking Bad (2008)") while
 * card captions do not; strip it so both branches name sets alike.
 *
 * @param name - Name read from the page title.
 * @returns The name without a trailing year.
 */
export function cleanSetName(name: string): string
{
  return stripSuffix(name, /\(\d{4}\)\s*$/).trim()
}

/**
 * Reads the set name from a set page's title,
 * "<Set name> Set By <uploader> | The Poster Database (TPDb)".
 *
 * @param pageTitle - Text of the page's title element.
 * @returns The set name without its year.
 */
export function parseSetPageTitle(pageTitle: string): string
{
  const by = /\sSet By\s/i.exec(pageTitle)
  return cleanSetName(by ? pageTitle.slice(0, by.index) : pageTitle)
}
