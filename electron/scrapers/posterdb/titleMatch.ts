import * as cheerio from 'cheerio'
import { stripSuffix } from '../../services/titleParse'
import type { PosterdbMediaType } from './posterdbTypes'
import { parseYear } from './cards'

/**
 * Same-titled media pages read for one title. The site holds duplicate
 * entries for many titles, collections above all, and the newest is often an
 * empty shell, so the browse reads them all and merges their sets.
 */
const MAX_MEDIA_CANDIDATES = 6

/** Letters NFD cannot decompose, folded to their ASCII spelling. */
const LETTER_FOLD: Record<string, string> = {
  ø: 'o', ß: 'ss', ł: 'l', æ: 'ae', œ: 'oe', đ: 'd', ð: 'd', þ: 'th', ı: 'i',
}

/**
 * Folds a title down to something two sites can agree on: case, accents,
 * punctuation and "the/a/an" all vary between Plex and ThePosterDB.
 *
 * @param s - Raw title.
 * @returns The comparable form.
 */

export function normalizeTitle(s: string): string
{
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
export function isSearchPage($: cheerio.CheerioAPI): boolean
{
  return /\bsearch\b/i.test($('title').first().text())
}

/**
 * Parses the search page's result rows.
 *
 * @param $ - Cheerio handle over the search HTML.
 * @returns Every "/posters/{id}" hit with its title and year.
 */
export function parseSearchHits($: cheerio.CheerioAPI): SearchHit[]
{
  const hits: SearchHit[] = []
  $('a[href*="/posters/"]').each((_, el) =>
  {
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
export function titleAliases(title: string, type: PosterdbMediaType): string[]
{
  const forms = [title]
  const bare = stripSuffix(title, /\([^()]*\)\s*$/).trim()
  if (bare && bare !== title) forms.push(bare)
  const normalized = [...new Set(forms.map(normalizeTitle).filter(Boolean))]
  if (type !== 'collection') return normalized
  return [...new Set(normalized.flatMap(n =>
  {
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
export function yearMatches(hit: SearchHit, year?: number): boolean
{
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
export function pickSearchHit(hits: SearchHit[], wants: string[], year?: number): SearchHit | null
{
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
export function pickSearchHits(hits: SearchHit[], wants: string[], year?: number): SearchHit[]
{
  const best = pickSearchHit(hits, wants, year)
  if (!best) return []
  const sameYear = (h: SearchHit) => best.year == null ? h.year == null : h.year === best.year
  const rest = hits.filter(h => h !== best && wants.includes(normalizeTitle(h.title)) && sameYear(h))
  return [best, ...rest].slice(0, MAX_MEDIA_CANDIDATES)
}
