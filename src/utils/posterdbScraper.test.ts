import { describe, it, expect, afterEach, vi } from 'vitest'
import * as cheerio from 'cheerio'
import type { PosterInfo } from '../../electron/ipc/types'
import type { RawCard, SearchHit, SetStub } from '../../electron/scrapers/posterdbScraper'

vi.mock('../../electron/services/config', () => ({
  ConfigService: {
    get: () => ({
      mediuxFilters: ['poster', 'backdrop', 'title_card'],
      scraperMinDelay: 0, scraperMaxDelay: 0, scraperInitialDelay: 0, scraperBatchDelay: 0,
      scraperPageWaitMin: 0, scraperPageWaitMax: 0, maxWorkers: 4,
    }),
  },
}))

vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), session: vi.fn(), scrape: vi.fn(), debug: vi.fn() },
}))

const mod = await import('../../electron/scrapers/posterdbScraper')
const {
  PosterdbScraper, parseYear, parseCardTitle, parseCards, cardsToPosters, normalizeTitle, isSearchPage, parseSearchHits,
  titleAliases, pickSearchHit, stubsFromCards, classifySetPosters, parseProfileAvatar, resolveAvatars, guessedAvatarUrl,
  stubToSummary, isMediaCard, cleanSetName,
} = mod

type Scraper = InstanceType<typeof PosterdbScraper>

const BASE = 'https://theposterdb.com'
const CUSTOM_AVATAR_URL = 'https://images.theposterdb.com/prod/public/images/users/alice/avatar.webp'
const CUSTOM_AVATAR = `<picture><source type="image/webp" srcset="${CUSTOM_AVATAR_URL} 1x"><img class="tpdb-avatar" src="https://images.theposterdb.com/prod/public/images/users/alice/avatar.png"></picture>`
const STOCK_AVATAR = '<img class="tpdb-avatar" src="/images/users/avatars/avatar-01.webp">'
const MISSING_AVATAR = '<img class="tpdb-avatar" src="/images/defaults/missing_avatar.png">'

interface CardSpec
{
  id: string
  caption: string
  type?: 'movie' | 'show' | 'collection' | 'person'
  uploader?: string
  setId?: string
  size?: number
  /** Older markup: no <picture>, only the lazy placeholder image. */
  placeholderOnly?: boolean
  /** An older "View Set Page" anchor placed before the poster-count badge. */
  decoySetId?: string
  /** Leave the poster-count badge out even though decoySetId is set. */
  noBadge?: boolean
}

/** One grid cell as a ThePosterDB media or set page renders it. */
function cardHtml(spec: CardSpec): string
{
  const type = spec.type ?? 'movie'
  const user = spec.uploader ?? 'alice'
  const picture = spec.placeholderOnly
    ? '<img src="/assets/images/missing_poster.jpg">'
    : `<picture><source type="image/webp" srcset="https://images.theposterdb.com/x/${spec.id}.webp 1x, https://images.theposterdb.com/x/${spec.id}@2x.webp 2x"><img src="/assets/images/missing_poster.jpg"></picture>`
  const decoy = spec.decoySetId ? `<a href="/set/${spec.decoySetId}" title="View Set Page">View</a>` : ''
  const badge = spec.setId && !spec.noBadge ? `<a class="set_poster_count" href="/set/${spec.setId}">${spec.size ?? 1}</a>` : ''
  return `<div class="col-6">${picture}<div class="overlay" data-poster-id="${spec.id}" data-poster-type="${type}">` +
    `<a href="/user/${user}"><img src="/av.png"></a>${decoy}${badge}</div>` +
    `<p class="text-break">${spec.caption}</p><p class="uploaded-by">by <a href="/user/${user}">${user}</a></p></div>`
}

function mediaPage(cards: CardSpec[]): string
{
  return `<html><head><title>Dune (2021) | The Poster Database (TPDb)</title></head><body>${cards.map(cardHtml).join('')}</body></html>`
}

function setPage(name: string, uploader: string, cards: CardSpec[]): string
{
  return `<html><head><title>${name} Set By ${uploader} | The Poster Database (TPDb)</title></head><body>${cards.map(cardHtml).join('')}</body></html>`
}

const hit = (mediaId: string, title: string, year?: number): SearchHit => ({ mediaId, title, year })

/** A search results page; `full` pads it to the 36 rows that make the scraper look for a next page. */
function searchPage(term: string, rows: SearchHit[], full = false): string
{
  const filler = full ? Array.from({ length: 36 - rows.length }, (_, i) => hit(String(9000 + i), `Filler ${i}`, 1999)) : []
  const list = [...rows, ...filler].map(r => `<a href="/posters/${r.mediaId}"><strong>${r.title}</strong> (${r.year ?? 'N/A'})</a>`).join('')
  return `<html><head><title>${term} - Search | The Poster Database (TPDb)</title></head><body><nav><a href="/posters/requests">Requests</a></nav>${list}</body></html>`
}

function profilePage(avatar: string): string
{
  return `<html><head><title>alice | The Poster Database (TPDb)</title></head><body>${avatar}</body></html>`
}

function searchUrl(term: string, section: string, page = 1): string
{
  return `${BASE}/search?term=${encodeURIComponent(term)}&section=${section}${page > 1 ? `&page=${page}` : ''}`
}

const profileUrl = (name: string) => `${BASE}/user/${name}`

/** Stubs global fetch with pages keyed by URL; an Error value rejects, an unknown URL answers 404. */
function serve(pages: Record<string, string | Error>)
{
  const fetchMock = vi.fn(async (url: string) =>
  {
    if (!(url in pages)) return { ok: false, status: 404, text: async () => '' }
    const body = pages[url]
    if (body instanceof Error) throw body
    return { ok: true, status: 200, text: async () => body }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requests(fetchMock: ReturnType<typeof serve>, url: string): number
{
  return fetchMock.mock.calls.filter(([u]) => u === url).length
}

/** Replaces the scraper's headless browser with one that serves the given HTML for whatever page it is sent to. */
function fakeBrowser(scraper: Scraper, htmlFor: (url: string) => string)
{
  let current = ''
  const page = {
    goto: vi.fn(async (url: string) =>
    {
      current = url
    }),
    waitForSelector: vi.fn(async () => {}),
    content: async () => htmlFor(current),
  }
  const newContext = vi.fn(async () => ({ context: { route: vi.fn(), close: vi.fn(async () => {}) }, page }))
  ;(scraper as unknown as { newContext: () => Promise<unknown> }).newContext = newContext
  return newContext
}

const raw = (posterId: string, mediaType: string, extra: Partial<RawCard> = {}): RawCard =>
  ({ posterId, thumbUrl: '', title: 'Dune', mediaType, ...extra })

const poster = (title: string, year?: number, extra: Partial<PosterInfo> = {}): PosterInfo =>
  ({ title, url: `https://theposterdb.com/api/assets/${title}`, source: 'posterdb', year, ...extra })

afterEach(() =>
{
  vi.unstubAllGlobals()
  mod.resetPosterdbCaches()
})

describe('parseYear and parseCardTitle', () =>
{
  it('takes the last (YYYY) in a caption', () =>
  {
    expect(parseYear('Dune (2021)')).toBe(2021)
    expect(parseYear('Breaking Bad (2008) - Season 1')).toBe(2008)
    expect(parseYear('Dune (1984): The Alternative Edition Redux 4K Remaster (2021)')).toBe(2021)
    expect(parseYear('Harry Potter Collection')).toBeUndefined()
  })

  it('strips only the trailing year and season suffix', () =>
  {
    expect(parseCardTitle('Dune (2021)')).toBe('Dune')
    expect(parseCardTitle('Breaking Bad (2008) - Season 1')).toBe('Breaking Bad')
    expect(parseCardTitle('Breaking Bad (2008) - Specials')).toBe('Breaking Bad')
    expect(parseCardTitle('Breaking Bad - Season 2')).toBe('Breaking Bad')
    expect(parseCardTitle('Harry Potter Collection')).toBe('Harry Potter Collection')
    expect(parseCardTitle('Birds of Prey (and the Fantabulous Emancipation of One Harley Quinn) (2020)'))
      .toBe('Birds of Prey (and the Fantabulous Emancipation of One Harley Quinn)')
    expect(parseCardTitle('Dune (1984): The Alternative Edition Redux 4K Remaster (2021)'))
      .toBe('Dune (1984): The Alternative Edition Redux 4K Remaster')
  })
})

describe('parseCards and cardsToPosters', () =>
{
  it('reads the thumbnail from the srcset and blanks the lazy placeholder', () =>
  {
    const cards = parseCards(cheerio.load(mediaPage([
      { id: 'a1', caption: 'Dune (2021)', setId: '10', size: 3 },
      { id: 'k1', caption: 'Harry Potter Collection', type: 'collection', setId: '11', placeholderOnly: true },
    ])))
    expect(cards[0]).toEqual({
      posterId: 'a1', thumbUrl: 'https://images.theposterdb.com/x/a1.webp', title: 'Dune', mediaType: 'movie',
      year: 2021, season: undefined, setId: '10', setSize: 3, uploader: 'alice',
    })
    expect(cards[1]).toMatchObject({ posterId: 'k1', thumbUrl: '', title: 'Harry Potter Collection', mediaType: 'collection', year: undefined })
  })

  it('prefers the poster-count badge and the uploaded-by line over earlier anchors', () =>
  {
    const [badged, legacy, loose] = parseCards(cheerio.load(mediaPage([
      { id: 'a1', caption: 'Dune (2021)', setId: '123', size: 3, decoySetId: '999' },
      { id: 'a2', caption: 'Dune (2021)', setId: '123', decoySetId: '999', noBadge: true },
      { id: 'a3', caption: 'Dune (2021)' },
    ])))
    expect(badged).toMatchObject({ setId: '123', setSize: 3, uploader: 'alice' })
    expect(legacy).toMatchObject({ setId: '999', setSize: undefined, uploader: 'alice' })
    expect(loose).toMatchObject({ setId: undefined, setSize: undefined })
  })

  it('parses seasons for show cards only', () =>
  {
    const cards = parseCards(cheerio.load(mediaPage([
      { id: 's0', caption: 'Breaking Bad (2008)', type: 'show', setId: '1' },
      { id: 's1', caption: 'Breaking Bad (2008) - Season 1', type: 'show', setId: '1' },
      { id: 's2', caption: 'Breaking Bad (2008) - Specials', type: 'show', setId: '1' },
      { id: 'm1', caption: 'Dune (2021)', setId: '2' },
    ])))
    expect(cards.map(c => [c.title, c.year, c.season])).toEqual([
      ['Breaking Bad', 2008, 'Cover'], ['Breaking Bad', 2008, 1], ['Breaking Bad', 2008, 0], ['Dune', 2021, undefined],
    ])
  })

  it('converts cards to posters with asset URLs and collection flags', () =>
  {
    const posters = cardsToPosters(parseCards(cheerio.load(mediaPage([
      { id: 'a1', caption: 'Dune (2021)', setId: '10' },
      { id: 'k1', caption: 'Harry Potter Collection', type: 'collection', setId: '11', placeholderOnly: true },
    ]))))
    expect(posters[0]).toEqual({
      title: 'Dune', url: `${BASE}/api/assets/a1`, thumbUrl: 'https://images.theposterdb.com/x/a1.webp', source: 'posterdb', year: 2021, season: undefined,
    })
    expect(posters[0]).not.toHaveProperty('isCollection')
    expect(posters[1]).toMatchObject({ title: 'Harry Potter Collection', url: `${BASE}/api/assets/k1`, thumbUrl: `${BASE}/api/assets/k1`, isCollection: true })
  })
})

describe('normalizeTitle and titleAliases', () =>
{
  it('folds accents, ampersands, articles, and special letters', () =>
  {
    expect(normalizeTitle('Amélie')).toBe('amelie')
    expect(normalizeTitle('Fast & Furious')).toBe('fast and furious')
    expect(normalizeTitle('The Matrix')).toBe('matrix')
    expect(normalizeTitle('A Quiet Place')).toBe('quiet place')
    expect(normalizeTitle('An American Tail')).toBe('american tail')
    expect(normalizeTitle('Brødre')).toBe('brodre')
    expect(normalizeTitle('Straße')).toBe('strasse')
    expect(normalizeTitle('Łódź')).toBe('lodz')
    expect(normalizeTitle('Æon Flux')).toBe('aeon flux')
    expect(normalizeTitle('  (The) Office  ')).toBe('office')
  })

  it('keeps non-Latin letters', () =>
  {
    expect(normalizeTitle('君の名は。')).toBe('君の名は')
  })

  it('lists the forms a Plex title may appear under', () =>
  {
    expect(titleAliases('The Office (US)', 'show')).toEqual(['office us', 'office'])
    expect(titleAliases('Dune', 'movie')).toEqual(['dune'])
    expect(titleAliases('Harry Potter Collection', 'collection')).toEqual(['harry potter collection', 'harry potter'])
    expect(titleAliases('Harry Potter', 'collection')).toEqual(['harry potter', 'harry potter collection'])
  })

  it('returns nothing for a title without letters or digits', () =>
  {
    expect(normalizeTitle('???')).toBe('')
    expect(titleAliases('???', 'movie')).toEqual([])
    expect(titleAliases('***', 'collection')).toEqual([])
  })
})

describe('search page parsing', () =>
{
  it('tells a results page from anything else', () =>
  {
    expect(isSearchPage(cheerio.load(searchPage('dune', [])))).toBe(true)
    expect(isSearchPage(cheerio.load('<html><head><title>Just a moment...</title></head></html>'))).toBe(false)
    expect(isSearchPage(cheerio.load('<html><head><title>Research | The Poster Database (TPDb)</title></head></html>'))).toBe(false)
    expect(isSearchPage(cheerio.load('<html><head></head><body></body></html>'))).toBe(false)
  })

  it('reads result rows and skips the requests link', () =>
  {
    const hits = parseSearchHits(cheerio.load(searchPage('dune', [hit('1', 'Dune', 1984), hit('2', 'Harry Potter Collection')])))
    expect(hits).toEqual([{ mediaId: '1', title: 'Dune', year: 1984 }, { mediaId: '2', title: 'Harry Potter Collection', year: undefined }])
  })
})

describe('pickSearchHit', () =>
{
  const dune = [hit('1', 'Dune', 1984), hit('2', 'Dune', 2021), hit('3', 'Dune: Part Two', 2024), hit('4', 'Dune')]
  const wants = titleAliases('Dune', 'movie')

  it('prefers the exact year, then a year within one', () =>
  {
    expect(pickSearchHit(dune, wants, 2021)?.mediaId).toBe('2')
    expect(pickSearchHit(dune, wants, 1984)?.mediaId).toBe('1')
    expect(pickSearchHit(dune, wants, 2022)?.mediaId).toBe('2')
    expect(pickSearchHit(dune, wants, 1985)?.mediaId).toBe('1')
  })

  it('accepts a year-less row only as a last resort', () =>
  {
    expect(pickSearchHit(dune, wants, 2010)?.mediaId).toBe('4')
  })

  it('returns null when every year is off by more than one', () =>
  {
    expect(pickSearchHit(dune.filter(h => h.year != null), wants, 2010)).toBeNull()
  })

  it('takes the first match when the Plex year is unknown', () =>
  {
    expect(pickSearchHit(dune, wants, undefined)?.mediaId).toBe('1')
  })

  it('prefers the full title over the bare alias', () =>
  {
    const office = [hit('uk', 'The Office', 2001), hit('us', 'The Office (US)', 2005)]
    const aliases = titleAliases('The Office (US)', 'show')
    expect(pickSearchHit(office, aliases, undefined)?.mediaId).toBe('us')
    expect(pickSearchHit(office, aliases, 2005)?.mediaId).toBe('us')
    expect(pickSearchHit([office[0]], aliases, undefined)?.mediaId).toBe('uk')
  })

  it('never takes a sequel for the original', () =>
  {
    expect(pickSearchHit([hit('3', 'Dune: Part Two', 2024)], wants, 2024)).toBeNull()
    expect(pickSearchHit([hit('3', 'Dune: Part Two', 2024)], wants, undefined)).toBeNull()
  })
})

describe('classifySetPosters', () =>
{
  const movies = [poster('Dune', 2021), poster('Dune', 2020), poster('Dune: Part Two', 2024), poster('Dune Collection', undefined, { isCollection: true })]

  it('flags siblings of a movie and leaves collection art alone', () =>
  {
    const out = classifySetPosters(movies, 'Dune', 2021, 'movie')
    expect(out.map(p => p.isCollectionMember)).toEqual([undefined, undefined, true, undefined])
    expect(out[3].isCollection).toBe(true)
  })

  it('flags every movie poster when browsing a collection', () =>
  {
    const out = classifySetPosters(movies, 'Dune Collection', undefined, 'collection')
    expect(out.map(p => p.isCollectionMember)).toEqual([true, true, true, undefined])
  })

  it('keeps a show\'s season posters unflagged', () =>
  {
    const seasons = [
      poster('Breaking Bad', 2008, { season: 'Cover' }), poster('Breaking Bad', 2008, { season: 1 }),
      poster('Breaking Bad', 2008, { season: 0 }), poster('Breaking Bad', undefined, { season: 'Backdrop' }),
    ]
    expect(classifySetPosters(seasons, 'Breaking Bad', 2008, 'show').map(p => p.isCollectionMember)).toEqual([undefined, undefined, undefined, undefined])
    expect(classifySetPosters([poster('Better Call Saul', 2015)], 'Breaking Bad', 2008, 'show')[0].isCollectionMember).toBe(true)
  })
})

describe('set summaries', () =>
{
  const stub: SetStub = { setId: '30', uploader: 'alice', size: 3, card: raw('c1', 'movie', { thumbUrl: 'https://images.theposterdb.com/x/c1.webp' }) }
  const posters = [
    poster('Breaking Bad', 2008, { season: 'Cover' }), poster('Breaking Bad', 2008, { season: 1 }),
    poster('Breaking Bad', 2008, { season: 'Backdrop' }), poster('Breaking Bad', 2008, { season: 1, episode: 1 }),
  ]

  it('counts posters, backdrops, and title cards', () =>
  {
    const summary = stubToSummary(stub, posters, 'Breaking Bad', 'show')
    expect(summary).toMatchObject({
      id: '30', source: 'posterdb', setName: 'Breaking Bad', uploader: 'alice', setUrl: `${BASE}/set/30`,
      posterCount: 2, backdropCount: 1, titleCardCount: 1, previewUrl: 'https://images.theposterdb.com/x/c1.webp', mediaType: 'show',
    })
    expect(summary.posters).toBe(posters)
  })

  it('omits the media type for collections and falls back to the asset URL for the preview', () =>
  {
    const summary = stubToSummary({ ...stub, card: raw('c1', 'collection') }, [], 'Harry Potter Collection', 'collection')
    expect(summary).not.toHaveProperty('mediaType')
    expect(summary.previewUrl).toBe(`${BASE}/api/assets/c1`)
    expect(stubToSummary(stub, [], 'Dune', 'movie').mediaType).toBe('movie')
  })

  it('groups cards into one stub per set in page order', () =>
  {
    const cards = [
      raw('a1', 'movie', { setId: '10', setSize: 3, uploader: 'alice' }),
      raw('b1', 'movie', { setId: '20' }),
      raw('x1', 'movie'),
      raw('a2', 'movie', { setId: '10', setSize: 3, uploader: 'alice' }),
    ]
    expect(stubsFromCards(cards)).toEqual([
      { setId: '10', uploader: 'alice', size: 3, card: cards[0] },
      { setId: '20', uploader: 'Unknown', size: 1, card: cards[1] },
    ])
  })

  it('keeps only movie, show, and collection cards', () =>
  {
    expect(['movie', 'show', 'collection', 'Movie', 'TV Show'].map(t => isMediaCard(raw('p', t)))).toEqual([true, true, true, true, true])
    expect(isMediaCard(raw('p', 'person'))).toBe(false)
  })

  it('strips the trailing year from a set name', () =>
  {
    expect(cleanSetName('Breaking Bad (2008)')).toBe('Breaking Bad')
    expect(cleanSetName('Dune')).toBe('Dune')
    expect(cleanSetName('Birds of Prey (and the Fantabulous Emancipation of One Harley Quinn) (2020)'))
      .toBe('Birds of Prey (and the Fantabulous Emancipation of One Harley Quinn)')
  })
})

describe('avatars', () =>
{
  it('reads custom, stock, missing, and absent avatars', () =>
  {
    expect(parseProfileAvatar(cheerio.load(profilePage(CUSTOM_AVATAR)))).toBe(CUSTOM_AVATAR_URL)
    expect(parseProfileAvatar(cheerio.load(profilePage(STOCK_AVATAR)))).toBe(`${BASE}/images/users/avatars/avatar-01.webp`)
    expect(parseProfileAvatar(cheerio.load(profilePage(MISSING_AVATAR)))).toBeNull()
    expect(parseProfileAvatar(cheerio.load(profilePage('')))).toBeUndefined()
  })

  it('caches a resolved avatar', async () =>
  {
    const fetchMock = serve({ [profileUrl('alice')]: profilePage(CUSTOM_AVATAR), [profileUrl('bob')]: profilePage(MISSING_AVATAR) })

    const first = await resolveAvatars(['alice', 'bob', 'alice'])
    expect(first.get('alice')).toBe(CUSTOM_AVATAR_URL)
    expect(first.get('bob')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const second = await resolveAvatars(['ALICE', 'bob'])
    expect(second.get('alice')).toBe(CUSTOM_AVATAR_URL)
    expect(second.get('bob')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('guesses the CDN URL when the profile page fails and does not cache it', async () =>
  {
    const fetchMock = serve({})
    expect(guessedAvatarUrl('carol')).toBe('https://images.theposterdb.com/prod/public/images/users/carol/avatar.webp')
    expect((await resolveAvatars(['carol'])).get('carol')).toBe(guessedAvatarUrl('carol'))
    expect((await resolveAvatars(['carol'])).get('carol')).toBe(guessedAvatarUrl('carol'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('skips unknown uploaders', async () =>
  {
    const fetchMock = serve({})
    expect((await resolveAvatars(['Unknown', ''])).size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('PosterdbScraper.findMedia', () =>
{
  const SEARCH = searchUrl('Dune', 'movies')
  const CHALLENGE = '<html><head><title>Just a moment...</title></head><body><a href="/posters/requests">Requests</a></body></html>'

  it('walks to the page whose row carries the right year', async () =>
  {
    const fetchMock = serve({
      [SEARCH]: searchPage('Dune', [hit('1', 'Dune', 1984), hit('2', 'Dune', 2000)], true),
      [searchUrl('Dune', 'movies', 2)]: searchPage('Dune', [hit('3', 'Dune', 2021)]),
    })
    const scraper = new PosterdbScraper()
    const browser = fakeBrowser(scraper, () => CHALLENGE)

    expect(await scraper.findMedia('Dune', 2021, 'movie')).toEqual({ mediaId: '3', title: 'Dune', year: 2021 })
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([SEARCH, searchUrl('Dune', 'movies', 2)])
    expect(browser).not.toHaveBeenCalled()
  })

  it('stops at the first page when the title is on it and remembers the match', async () =>
  {
    const fetchMock = serve({ [SEARCH]: searchPage('Dune', [hit('1', 'Dune', 1984), hit('2', 'Dune', 2021)], true) })
    const scraper = new PosterdbScraper()
    const browser = fakeBrowser(scraper, () => CHALLENGE)

    expect(await scraper.findMedia('Dune', 2021, 'movie')).toEqual({ mediaId: '2', title: 'Dune', year: 2021 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await new PosterdbScraper().findMedia('Dune', 2021, 'movie')).toEqual({ mediaId: '2', title: 'Dune', year: 2021 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(browser).not.toHaveBeenCalled()
  })

  it('does not cache a page that is not a search results page', async () =>
  {
    const fetchMock = serve({ [SEARCH]: CHALLENGE })
    const scraper = new PosterdbScraper()
    const browser = fakeBrowser(scraper, () => CHALLENGE)

    expect(await scraper.findMedia('Dune', 2021, 'movie')).toBeNull()
    expect(browser).toHaveBeenCalledTimes(1)
    expect(await scraper.findMedia('Dune', 2021, 'movie')).toBeNull()
    expect(requests(fetchMock, SEARCH)).toBe(2)
  })

  it('caches a miss until asked for a fresh search', async () =>
  {
    const fetchMock = serve({ [SEARCH]: searchPage('Dune', [hit('3', 'Dune: Part Two', 2024)]) })
    const scraper = new PosterdbScraper()
    const browser = fakeBrowser(scraper, () => CHALLENGE)

    expect(await scraper.findMedia('Dune', 2021, 'movie')).toBeNull()
    expect(await scraper.findMedia('Dune', 2021, 'movie')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await scraper.findMedia('Dune', 2021, 'movie', true)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(browser).not.toHaveBeenCalled()
  })

  it('searches nothing for a title with no letters or digits', async () =>
  {
    const fetchMock = serve({})
    expect(await new PosterdbScraper().findMedia('???', undefined, 'movie')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('PosterdbScraper.browseSets', () =>
{
  const SEARCH = searchUrl('Dune', 'movies')
  const MEDIA = `${BASE}/posters/500`
  const MEDIA_PAGE_2 = `${MEDIA}?page=2`
  const SET_30 = `${BASE}/set/30`
  const DUNE_SEARCH = searchPage('Dune', [hit('500', 'Dune', 2021), hit('501', 'Dune: Part Two', 2024)])
  const DUNE_CARDS: CardSpec[] = [
    { id: 'a1', caption: 'Dune (2021)', uploader: 'alice', setId: '10' },
    { id: 'b1', caption: 'Dune (2021)', uploader: 'bob', setId: '20' },
    { id: 'c1', caption: 'Dune (2021)', uploader: 'alice', setId: '30', size: 3 },
  ]
  const DUNE_SET_30 = setPage('Dune (2021)', 'alice', [
    { id: 'c1', caption: 'Dune (2021)', uploader: 'alice', setId: '30', size: 3 },
    { id: 'c2', caption: 'Dune: Part Two (2024)', uploader: 'alice', setId: '30', size: 3 },
    { id: 'c3', caption: 'Denis Villeneuve', type: 'person', uploader: 'alice', setId: '30', size: 3 },
  ])

  function dunePages(): Record<string, string>
  {
    return {
      [SEARCH]: DUNE_SEARCH,
      [MEDIA]: mediaPage(DUNE_CARDS),
      [SET_30]: DUNE_SET_30,
      [profileUrl('alice')]: profilePage(CUSTOM_AVATAR),
      [profileUrl('bob')]: profilePage(STOCK_AVATAR),
    }
  }

  function singleSets(from: number, count: number): CardSpec[]
  {
    return Array.from({ length: count }, (_, i) => ({ id: `p${from + i}`, caption: 'Dune (2021)', setId: String(from + i) }))
  }

  it('expands only multi-poster sets and attaches avatars', async () =>
  {
    const fetchMock = serve(dunePages())
    const scraper = new PosterdbScraper()
    const browser = fakeBrowser(scraper, () => '')

    const result = await scraper.browseSets('Dune', 2021, 'movie')

    expect(result.capped).toBe(false)
    expect(result.mediaUrl).toBe(MEDIA)
    expect(result.sets.map(s => [s.id, s.setName, s.uploader, s.posters.length])).toEqual([
      ['10', 'Dune', 'alice', 1], ['20', 'Dune', 'bob', 1], ['30', 'Dune', 'alice', 2],
    ])
    expect(result.sets[0]).toMatchObject({
      source: 'posterdb', setUrl: `${BASE}/set/10`, mediaType: 'movie', uploaderAvatar: CUSTOM_AVATAR_URL,
      previewUrl: 'https://images.theposterdb.com/x/a1.webp', posterCount: 1, backdropCount: 0, titleCardCount: 0,
    })
    expect(result.sets[0].posters[0]).not.toHaveProperty('isCollectionMember')
    expect(result.sets[1].uploaderAvatar).toBe(`${BASE}/images/users/avatars/avatar-01.webp`)
    expect(result.sets[2].posters.map(p => [p.title, p.year, p.isCollectionMember])).toEqual([['Dune', 2021, undefined], ['Dune: Part Two', 2024, true]])
    expect(result.sets[2].posterCount).toBe(2)

    expect(requests(fetchMock, SET_30)).toBe(1)
    expect(requests(fetchMock, MEDIA_PAGE_2)).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(browser).not.toHaveBeenCalled()
  })

  it('reports more on the site after two full pages', async () =>
  {
    const fetchMock = serve({
      [SEARCH]: DUNE_SEARCH,
      [MEDIA]: mediaPage(singleSets(100, 24)),
      [MEDIA_PAGE_2]: mediaPage(singleSets(200, 24)),
      [profileUrl('alice')]: profilePage(CUSTOM_AVATAR),
    })
    const scraper = new PosterdbScraper()
    const browser = fakeBrowser(scraper, () => '')

    const result = await scraper.browseSets('Dune', 2021, 'movie')

    expect(result.sets).toHaveLength(48)
    expect(result.sets[0].id).toBe('100')
    expect(result.sets[47].id).toBe('223')
    expect(result.capped).toBe(true)
    expect(requests(fetchMock, MEDIA_PAGE_2)).toBe(1)
    expect(requests(fetchMock, profileUrl('alice'))).toBe(1)
    expect(browser).not.toHaveBeenCalled()
  })

  it('stops at a short second page', async () =>
  {
    const fetchMock = serve({
      [SEARCH]: DUNE_SEARCH,
      [MEDIA]: mediaPage(singleSets(100, 24)),
      [MEDIA_PAGE_2]: mediaPage(singleSets(200, 2)),
      [profileUrl('alice')]: profilePage(CUSTOM_AVATAR),
    })
    const scraper = new PosterdbScraper()
    fakeBrowser(scraper, () => '')

    const result = await scraper.browseSets('Dune', 2021, 'movie')

    expect(result.sets).toHaveLength(26)
    expect(result.capped).toBe(false)
    expect(requests(fetchMock, MEDIA_PAGE_2)).toBe(1)
  })

  it('returns nothing after abort', async () =>
  {
    const fetchMock = serve(dunePages())
    const scraper = new PosterdbScraper()
    const browser = fakeBrowser(scraper, () => '')
    scraper.abort()

    expect(await scraper.browseSets('Dune', 2021, 'movie')).toEqual({ sets: [], capped: false })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(browser).not.toHaveBeenCalled()
  })

  it('falls back to the browser when the media page fails to fetch', async () =>
  {
    const pages = dunePages()
    const fetchMock = serve({ ...pages, [MEDIA]: new Error('ECONNRESET') })
    const scraper = new PosterdbScraper()
    const content = vi.fn((url: string) => pages[url])
    const browser = fakeBrowser(scraper, content)

    const result = await scraper.browseSets('Dune', 2021, 'movie')

    expect(result.sets.map(s => s.id)).toEqual(['10', '20', '30'])
    expect(result.mediaUrl).toBe(MEDIA)
    expect(browser).toHaveBeenCalledTimes(1)
    expect(content).toHaveBeenCalledWith(MEDIA)
    expect(requests(fetchMock, MEDIA)).toBe(1)
    expect(requests(fetchMock, SET_30)).toBe(1)
  })

  it('propagates a browser that cannot start', async () =>
  {
    serve({ ...dunePages(), [MEDIA]: new Error('ECONNRESET') })
    const scraper = new PosterdbScraper()
    const newContext = vi.fn(async () =>
    {
      throw new Error('Chromium browser is not installed')
    })
    ;(scraper as unknown as { newContext: () => Promise<unknown> }).newContext = newContext

    await expect(scraper.browseSets('Dune', 2021, 'movie')).rejects.toThrow('Chromium browser is not installed')
    expect(newContext).toHaveBeenCalledTimes(1)
  })
})

describe('pickSearchHits', () =>
{
  const wants = titleAliases('Marvel Cinematic Universe', 'collection')

  it('takes every duplicate entry of a title along, best first', () =>
  {
    const hits = [
      hit('1', 'Marvel Cinematic universe'), hit('2', 'Marvel Cinematic Universe'), hit('3', 'Marvel Knights'),
      hit('4', 'Marvel Cinematic Universe (Collection)'), hit('5', 'Marvel Cinematic Universe Collection'),
    ]
    expect(mod.pickSearchHits(hits, wants).map(h => h.mediaId)).toEqual(['1', '2', '4', '5'])
  })

  it('keeps only duplicates that share the chosen year', () =>
  {
    const dune = titleAliases('Dune', 'movie')
    const hits = [hit('1', 'Dune', 1984), hit('2', 'Dune', 2021), hit('3', 'Dune', 2021), hit('4', 'Dune')]
    expect(mod.pickSearchHits(hits, dune, 2021).map(h => h.mediaId)).toEqual(['2', '3'])
    expect(mod.pickSearchHits(hits, dune, 1984).map(h => h.mediaId)).toEqual(['1'])
    expect(mod.pickSearchHits([hit('3', 'Dune: Part Two', 2024)], dune)).toEqual([])
  })

  it('caps how many entries are read', () =>
  {
    const hits = Array.from({ length: 9 }, (_, i) => hit(String(i), 'Marvel Cinematic Universe'))
    expect(mod.pickSearchHits(hits, wants)).toHaveLength(6)
  })
})

describe('page markers and link types', () =>
{
  const EMPTY_MEDIA = '<html><head><title>Marvel Cinematic universe | The Poster Database (TPDb)</title></head><body>' +
    '<p class="h2 text-center pt-4">Either no posters have been made for this item, or they\'ve all been filtered out.</p></body></html>'

  it('tells an empty media page from a challenge page', () =>
  {
    expect(mod.isMediaPage(cheerio.load(EMPTY_MEDIA))).toBe(true)
    expect(mod.isMediaPage(cheerio.load(mediaPage([{ id: 'a', caption: 'Dune (2021)' }])))).toBe(true)
    expect(mod.isMediaPage(cheerio.load('<html><head><title>Just a moment...</title></head><body></body></html>'))).toBe(false)
  })

  it('reads the parent set of a poster page', () =>
  {
    expect(mod.parentSetId(cheerio.load('<a class="btn" href="https://theposterdb.com/set/4475" data-toggle="tooltip" title="View Set Page">Set</a>'))).toBe('4475')
    expect(mod.parentSetId(cheerio.load('<a class="rounded view_all" href="/set/77">all</a>'))).toBe('77')
    expect(mod.parentSetId(cheerio.load('<div id="main_poster_container"></div>'))).toBe('')
  })

  it('classifies title pages apart from the requests listing', () =>
  {
    expect(mod.posterdbUrlType('https://theposterdb.com/posters/1993')).toBe('media')
    expect(mod.posterdbUrlType('https://theposterdb.com/posters/requests')).toBe('unknown')
    expect(mod.posterdbUrlType('https://theposterdb.com/poster/9772')).toBe('poster')
  })
})

describe('PosterdbScraper.browseSets across duplicate entries', () =>
{
  const SEARCH = searchUrl('Marvel Cinematic Universe', 'collections')
  const EMPTY = `${BASE}/posters/2711312`
  const FULL = `${BASE}/posters/1993`
  const OTHER = `${BASE}/posters/3233991`
  const EMPTY_PAGE = '<html><head><title>Marvel Cinematic universe | The Poster Database (TPDb)</title></head><body>' +
    '<p class="h2 text-center pt-4">Either no posters have been made for this item, or they\'ve all been filtered out.</p></body></html>'
  const mcu = (id: string, uploader: string, setId: string): CardSpec =>
    ({ id, caption: 'Marvel Cinematic Universe', type: 'collection', uploader, setId })

  it('merges the sets of every same-titled entry and names the fullest page', async () =>
  {
    const fetchMock = serve({
      [SEARCH]: searchPage('Marvel Cinematic Universe', [hit('2711312', 'Marvel Cinematic universe'), hit('1993', 'Marvel Cinematic Universe'), hit('5', 'Marvel Knights')]),
      [EMPTY]: EMPTY_PAGE,
      [FULL]: mediaPage([mcu('r1', 'red', '4475')]),
      [profileUrl('red')]: profilePage(CUSTOM_AVATAR),
    })
    const scraper = new PosterdbScraper()
    const browser = fakeBrowser(scraper, () => '')

    const result = await scraper.browseSets('Marvel Cinematic Universe', undefined, 'collection')

    expect(result.sets.map(s => s.id)).toEqual(['4475'])
    expect(result.sets[0].posters[0].isCollection).toBe(true)
    expect(result.mediaUrl).toBe(FULL)
    expect(result.capped).toBe(false)
    expect(requests(fetchMock, EMPTY)).toBe(1)
    expect(requests(fetchMock, FULL)).toBe(1)
    // An entry with no posters is a real answer, not a page that failed to render.
    expect(browser).not.toHaveBeenCalled()
  })

  it('lists a set that two entries share once', async () =>
  {
    serve({
      [SEARCH]: searchPage('Marvel Cinematic Universe', [hit('3233991', 'Marvel Cinematic Universe'), hit('1993', 'Marvel Cinematic Universe')]),
      [OTHER]: mediaPage([mcu('o1', 'alice', '10')]),
      [FULL]: mediaPage([mcu('f1', 'alice', '10'), mcu('f2', 'bob', '20')]),
      [profileUrl('alice')]: profilePage(CUSTOM_AVATAR),
      [profileUrl('bob')]: profilePage(STOCK_AVATAR),
    })
    const scraper = new PosterdbScraper()
    fakeBrowser(scraper, () => '')

    const result = await scraper.browseSets('Marvel Cinematic Universe', undefined, 'collection')

    expect(result.sets.map(s => s.id)).toEqual(['10', '20'])
    expect(result.mediaUrl).toBe(FULL)
  })
})

describe('PosterdbScraper.linkSets', () =>
{
  const SET = `${BASE}/set/4475`
  const POSTER = `${BASE}/poster/9772`
  const POSTER_PAGE = `<html><head><title>Marvel Cinematic Universe - RedHeadJedi | The Poster Database (TPDb)</title></head><body>` +
    `<a href="${BASE}/api/assets/9772/view" id="main_poster_container"></a>` +
    `<a class="btn" href="${SET}" data-toggle="tooltip" title="View Set Page">View Set Page</a></body></html>`
  const SET_PAGE = setPage('Marvel Cinematic Universe', 'red', [
    { id: 'r1', caption: 'Marvel Cinematic Universe', type: 'collection', uploader: 'red', setId: '4475', size: 3 },
    { id: 'r2', caption: 'Iron Man (2008)', uploader: 'red', setId: '4475', size: 3 },
    { id: 'r3', caption: 'Robert Downey Jr.', type: 'person', uploader: 'red', setId: '4475', size: 3 },
  ])

  it('reads a set page and classifies it against the title', async () =>
  {
    serve({ [SET]: SET_PAGE, [profileUrl('red')]: profilePage(CUSTOM_AVATAR) })
    const scraper = new PosterdbScraper()
    fakeBrowser(scraper, () => '')

    const sets = await scraper.linkSets(SET, 'Marvel Cinematic Universe', undefined, 'collection')

    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({ id: '4475', source: 'posterdb', setName: 'Marvel Cinematic Universe', uploader: 'red', setUrl: SET, uploaderAvatar: CUSTOM_AVATAR_URL, posterCount: 2 })
    expect(sets[0].posters.map(p => [p.title, p.isCollection, p.isCollectionMember])).toEqual([
      ['Marvel Cinematic Universe', true, undefined], ['Iron Man', undefined, true],
    ])
  })

  it('follows a poster page to its set', async () =>
  {
    const fetchMock = serve({ [POSTER]: POSTER_PAGE, [SET]: SET_PAGE, [profileUrl('red')]: profilePage(CUSTOM_AVATAR) })
    const scraper = new PosterdbScraper()
    fakeBrowser(scraper, () => '')

    const sets = await scraper.linkSets(POSTER, 'Iron Man', 2008, 'movie')

    expect(sets.map(s => s.id)).toEqual(['4475'])
    expect(sets[0].posters.map(p => [p.title, p.isCollectionMember])).toEqual([['Marvel Cinematic Universe', undefined], ['Iron Man', undefined]])
    expect(requests(fetchMock, POSTER)).toBe(1)
  })

  it('refuses a poster that is in no set, a profile, and pages it does not read', async () =>
  {
    serve({ [POSTER]: `<html><head><title>x | TPDb</title></head><body><a href="${BASE}/api/assets/9772/view" id="main_poster_container"></a></body></html>` })
    const scraper = new PosterdbScraper()
    fakeBrowser(scraper, () => '')

    await expect(scraper.linkSets(POSTER, 'X', undefined, 'movie')).rejects.toThrow(/not part of a set/)
    await expect(scraper.linkSets(`${BASE}/user/red`, 'X', undefined, 'movie')).rejects.toThrow(/profile/)
    await expect(scraper.linkSets(`${BASE}/about`, 'X', undefined, 'movie')).rejects.toThrow(/Not a ThePosterDB/)
  })

  it('reads every set on a title page', async () =>
  {
    serve({
      [`${BASE}/posters/1993`]: mediaPage([
        { id: 'a1', caption: 'Marvel Cinematic Universe', type: 'collection', uploader: 'alice', setId: '10' },
        { id: 'b1', caption: 'Marvel Cinematic Universe', type: 'collection', uploader: 'bob', setId: '20' },
      ]),
      [profileUrl('alice')]: profilePage(CUSTOM_AVATAR),
      [profileUrl('bob')]: profilePage(STOCK_AVATAR),
    })
    const scraper = new PosterdbScraper()
    fakeBrowser(scraper, () => '')

    const sets = await scraper.linkSets(`${BASE}/posters/1993`, 'Marvel Cinematic Universe', undefined, 'collection')
    expect(sets.map(s => s.id)).toEqual(['10', '20'])
  })
})
