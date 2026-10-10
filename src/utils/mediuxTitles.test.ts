import { describe, it, expect, vi } from 'vitest'

vi.mock('../../electron/services/config', () => ({
  ConfigService: { get: () => ({ mediuxFilters: ['poster', 'backdrop', 'title_card'] }) },
}))
vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), session: vi.fn(), scrape: vi.fn(), debug: vi.fn() },
}))

const { deriveSetFallback, parseNameYear, stripFileSuffix } = await import('../../electron/scrapers/mediuxScraper')

type RawSet = Parameters<typeof deriveSetFallback>[0]
const file = (fileType: string, title: string) => ({ id: title, fileType, title })

describe('stripFileSuffix and parseNameYear', () =>
{
  it('removes the per-file suffixes MediUX appends', () =>
  {
    expect(stripFileSuffix('Battlestar Galactica (2004) - S1 E1')).toBe('Battlestar Galactica (2004)')
    expect(stripFileSuffix('Show (2020) - Season 2')).toBe('Show (2020)')
    expect(stripFileSuffix('Show (2020) - Specials')).toBe('Show (2020)')
    expect(stripFileSuffix('300 (2007) - Backdrop')).toBe('300 (2007)')
    expect(stripFileSuffix('Plain (2020)')).toBe('Plain (2020)')
  })

  it('reads a name and year with trailing words allowed', () =>
  {
    expect(parseNameYear('Battlestar Galactica (2004) Title Cards')).toEqual({ title: 'Battlestar Galactica', year: 2004 })
    expect(parseNameYear('Veep (2012) Set')).toEqual({ title: 'Veep', year: 2012 })
    expect(parseNameYear('The Big Door Prize (Willtong set completion)')).toBeNull()
    expect(parseNameYear('(2004) Title Cards')).toBeNull()
  })
})

describe('deriveSetFallback', () =>
{
  it('prefers the set\'s own show or movie metadata', () =>
  {
    const set = { id: 1, show: { name: 'Veep', first_air_date: '2012-04-22' }, files: [file('title_card', 'Other (1999) - S1 E1')] } as RawSet
    expect(deriveSetFallback(set)).toEqual({ title: 'Veep', year: 2012 })
  })

  it('names the show from a title card when the set has no poster', () =>
  {
    const set = { id: 21031, set_name: 'Battlestar Galactica (2004) Title Cards', files: [
      file('title_card', 'Battlestar Galactica (2004) - S1 E1'),
      file('title_card', 'Battlestar Galactica (2004) - S1 E2'),
    ] } as RawSet
    expect(deriveSetFallback(set)).toEqual({ title: 'Battlestar Galactica', year: 2004 })
  })

  it('still prefers a poster title over other files', () =>
  {
    const set = { id: 2, set_name: 'Anything', files: [file('title_card', 'Wrong (2001) - S1 E1'), file('poster', 'Right (2002)')] } as RawSet
    expect(deriveSetFallback(set)).toEqual({ title: 'Right', year: 2002 })
  })

  it('reads a season poster title without the season suffix', () =>
  {
    const set = { id: 3, files: [file('poster', 'Show (2020) - Season 1')] } as RawSet
    expect(deriveSetFallback(set)).toEqual({ title: 'Show', year: 2020 })
  })

  it('falls back to the set name, with or without a year', () =>
  {
    expect(deriveSetFallback({ id: 4, set_name: 'Battlestar Galactica Miniseries (2003) Title Cards', files: [] } as RawSet))
      .toEqual({ title: 'Battlestar Galactica Miniseries', year: 2003 })
    expect(deriveSetFallback({ id: 5, set_name: 'The Big Door Prize Title Cards', files: [] } as RawSet))
      .toEqual({ title: 'The Big Door Prize' })
    expect(deriveSetFallback({ id: 6, set_name: 'The Big Door Prize (Willtong set completion)', files: [file('title_card', 'The Big Door Prize (2023) - S2 E1')] } as RawSet))
      .toEqual({ title: 'The Big Door Prize', year: 2023 })
    expect(deriveSetFallback({ id: 7, files: [] } as RawSet)).toEqual({})
  })
})
