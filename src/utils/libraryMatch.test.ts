import { describe, it, expect } from 'vitest'
import { mappedPlexTitle, normTitle, pickLibraryMatch, pickMappedItem } from '../../electron/services/libraryMatch'

const c = (title: string, year?: number, tmdbId?: string) => ({ title, year, tmdbId })

describe('normTitle', () =>
{
  it('ignores case, accents, and punctuation', () =>
  {
    expect(normTitle('The Librarian: Quest for the Spear')).toBe(normTitle('the librarian - quest for the spear'))
    expect(normTitle('Amélie')).toBe('amelie')
  })
})

describe('pickLibraryMatch', () =>
{
  const franchise = [
    c('Battlestar Galactica', 1978),
    c('Battlestar Galactica', 2003),
    c('Battlestar Galactica (2003)', 2004),
    c('Battlestar Galactica: Blood & Chrome', 2012),
  ]

  it('prefers the TMDB id over any title', () =>
  {
    const pool = [c('Something Else', 2004, '1'), c('Battlestar Galactica (2003)', 2004, '1972')]
    expect(pickLibraryMatch(pool, { title: 'Battlestar Galactica', year: 2004, tmdbId: '1972' })).toBe(pool[1])
  })

  it('keeps a set on the entry whose year it names, not a lookalike a year off', () =>
  {
    expect(pickLibraryMatch(franchise, { title: 'Battlestar Galactica', year: 2004 })).toBe(franchise[2])
    expect(pickLibraryMatch(franchise, { title: 'Battlestar Galactica', year: 2003 })).toBe(franchise[1])
    expect(pickLibraryMatch(franchise, { title: 'Battlestar Galactica', year: 1978 })).toBe(franchise[0])
  })

  it('treats a Plex title that carries a year as an exact title', () =>
  {
    const pool = [c('Battlestar Galactica', 1978), c('Battlestar Galactica (2003)', 2003), c('Battlestar Galactica: Blood & Chrome', 2012)]
    expect(pickLibraryMatch(pool, { title: 'Battlestar Galactica', year: 2004 })).toBe(pool[1])
    expect(pickLibraryMatch(pool, { title: 'Battlestar Galactica', year: 2003 })).toBe(pool[1])

    const who = [c('Doctor Who', 1963), c('Doctor Who (2005)', 2005)]
    expect(pickLibraryMatch(who, { title: 'Doctor Who', year: 2005 })).toBe(who[1])
    expect(pickLibraryMatch(who, { title: 'Doctor Who', year: 1963 })).toBe(who[0])
    expect(pickLibraryMatch([c('Doctor Who (2005)', 2005)], { title: 'Doctor Who' })).toEqual(c('Doctor Who (2005)', 2005))
  })

  it('falls back to a title a year off when nothing shares the year', () =>
  {
    const pool = [c('Battlestar Galactica (2003)', 2003)]
    expect(pickLibraryMatch(pool, { title: 'Battlestar Galactica', year: 2004 })).toBe(pool[0])
    expect(pickLibraryMatch([c('Battlestar Galactica', 1978)], { title: 'Battlestar Galactica', year: 2004 })).toBeNull()
  })

  it('matches exact titles across punctuation, and by title alone without a year', () =>
  {
    const pool = [c('The Librarian - Quest for the Spear', 2004)]
    expect(pickLibraryMatch(pool, { title: 'The Librarian: Quest for the Spear', year: 2004 })).toBe(pool[0])
    expect(pickLibraryMatch([c('Sugar', 2008), c('Sugar', 2024)], { title: 'Sugar' })).toEqual(c('Sugar', 2008))
  })

  it('never fuzzy-matches a sequel years away', () =>
  {
    expect(pickLibraryMatch([c('Toy Story 2', 1999)], { title: 'Toy Story', year: 1995 })).toBeNull()
  })
})

describe('title mappings', () =>
{
  const mappings = { 'Avengers: Endgame': 'Avengers Endgame', 'Shōgun': 'Shogun (2024)' }

  it('finds the Plex title for a poster-site title, with or without a year', () =>
  {
    expect(mappedPlexTitle(mappings, 'Avengers Endgame')).toBe('Avengers: Endgame')
    expect(mappedPlexTitle(mappings, 'avengers - endgame (2019)')).toBe('Avengers: Endgame')
    expect(mappedPlexTitle(mappings, 'Shogun')).toBe('Shōgun')
    expect(mappedPlexTitle(mappings, 'Avengers')).toBeNull()
    expect(mappedPlexTitle(undefined, 'Avengers Endgame')).toBeNull()
  })

  it('picks only an exact title, preferring the poster year', () =>
  {
    const pool = [c('Shōgun', 1980), c('Shōgun', 2024), c('Shogun Assassin', 1980)]
    expect(pickMappedItem(pool, 'Shōgun', 2024)).toBe(pool[1])
    expect(pickMappedItem(pool, 'Shōgun')).toBe(pool[0])
    expect(pickMappedItem(pool, 'Shōgun', 1999)).toBe(pool[0])
    expect(pickMappedItem([c('Shogun Assassin', 1980)], 'Shōgun')).toBeNull()
  })
})
