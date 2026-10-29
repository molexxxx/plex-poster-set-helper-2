import { describe, it, expect, vi } from 'vitest'
import { splitTrailingYear, stripSuffix } from '../../electron/services/titleParse'
import { urlKey } from '../../electron/services/scheduleUtils'
import { pickLibraryMatch } from '../../electron/services/libraryMatch'

vi.mock('../../electron/services/config', () => ({
  ConfigService: { get: () => ({ mediuxFilters: ['poster', 'backdrop', 'title_card'] }) },
}))
vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), session: vi.fn(), scrape: vi.fn(), debug: vi.fn() },
}))

const { parseCardTitle, titleAliases, cleanSetName, parseSetPageTitle } = await import('../../electron/scrapers/posterdbScraper')
const { deriveSetFallback, parseNameYear, stripFileSuffix } = await import('../../electron/scrapers/mediuxScraper')

type RawSet = Parameters<typeof deriveSetFallback>[0]

describe('stripSuffix', () =>
{
  it('removes the suffix and the whitespace before it', () =>
  {
    expect(stripSuffix('300 (2007) - Backdrop  ', /-\s*Backdrop\s*$/i)).toBe('300 (2007)')
    expect(stripSuffix('Dune (2021)', /\(\d{4}\)\s*$/)).toBe('Dune')
  })

  it('returns the input unchanged when there is no suffix', () =>
  {
    expect(stripSuffix('Dune  ', /\(\d{4}\)\s*$/)).toBe('Dune  ')
  })

  it('requires whitespace before the suffix when spaced', () =>
  {
    expect(stripSuffix('Veep Set', /Set$/i, true)).toBe('Veep')
    expect(stripSuffix('Sunset', /Set$/i, true)).toBe('Sunset')
  })
})

describe('splitTrailingYear', () =>
{
  it('splits a trailing year off the name', () =>
  {
    expect(splitTrailingYear('Toy Story 2 (1999)')).toEqual({ title: 'Toy Story 2', year: 1999 })
    expect(splitTrailingYear('  Toy Story 2   (1999)  ')).toEqual({ title: 'Toy Story 2', year: 1999 })
  })

  it('returns null without a trailing year', () =>
  {
    expect(splitTrailingYear('Toy Story 2')).toBeNull()
    expect(splitTrailingYear('Toy Story (1999) Set')).toBeNull()
  })
})

describe('title parsers keep their results', () =>
{
  it('reads the set name from a ThePosterDB set page title', () =>
  {
    expect(parseSetPageTitle('Breaking Bad (2008) Set By alice | The Poster Database (TPDb)')).toBe('Breaking Bad')
    expect(parseSetPageTitle('Sunset Boulevard')).toBe('Sunset Boulevard')
  })

  it('takes the first year that ends the caption or precedes a dash', () =>
  {
    expect(parseCardTitle('A (1999) (2000)')).toBe('A (1999)')
    expect(parseCardTitle('A (1999) -  Season 2')).toBe('A')
    expect(parseCardTitle('Title (2020)  ')).toBe('Title (2020)')
    expect(parseCardTitle('Breaking Bad  -  Specials ')).toBe('Breaking Bad')
    expect(parseCardTitle('Half-Life')).toBe('Half-Life')
  })

  it('strips set-name words only when they stand alone', () =>
  {
    expect(deriveSetFallback({ id: 1, set_name: 'Foo Title Cards', files: [] } as RawSet)).toEqual({ title: 'Foo' })
    expect(deriveSetFallback({ id: 2, set_name: 'Sunset', files: [] } as RawSet)).toEqual({ title: 'Sunset' })
  })
})

describe('title and URL parsing runs in linear time', () =>
{
  const n = 100_000
  const spaces = ' '.repeat(n)
  const slashes = '/'.repeat(n)

  function expectFast(run: () => unknown): void
  {
    const start = performance.now()
    run()
    expect(performance.now() - start).toBeLessThan(250)
  }

  it('handles long whitespace runs in titles', () =>
  {
    const inputs = [`a${spaces}x`, `a${spaces}(x`, `a${spaces}-x`, `a${spaces}`, `season ${spaces}!`]
    for (const s of inputs)
    {
      expectFast(() => titleAliases(s, 'show'))
      expectFast(() => cleanSetName(s))
      expectFast(() => parseSetPageTitle(s))
      expectFast(() => parseCardTitle(s))
      expectFast(() => stripFileSuffix(s))
      expectFast(() => parseNameYear(s))
      expectFast(() => deriveSetFallback({ id: 1, set_name: s, files: [] } as RawSet))
      expectFast(() => splitTrailingYear(s))
    }
    expectFast(() => pickLibraryMatch([{ title: `a${spaces}b (2020)` }], { title: 'a b', year: 2020 }))
  })

  it('handles long slash runs in job URLs', () =>
  {
    expectFast(() => urlKey(`https://mediux.pro/sets/1${slashes}x`))
    expect(urlKey(`https://mediux.pro/sets/1${slashes}`)).toBe('mediux.pro/sets/1')
  })
})
