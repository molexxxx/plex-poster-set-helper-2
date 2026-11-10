import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PosterInfo } from '../../electron/ipc/types'
import { filterByTypes, singleFileTypes, toggleFileType, type FileType } from './posterGroups'
import { applyPosters } from '../features/library/libraryShared'
import { artworkOverride } from '../../electron/services/scheduleUtils'

const uploadPoster = vi.fn()

const SET: PosterInfo[] = [
  { title: 'Friends', year: 1994, url: 'main', source: 'mediux' },
  { title: 'Friends', year: 1994, url: 's1', source: 'mediux', season: 1 },
  { title: 'Friends', year: 1994, url: 'bg', source: 'mediux', season: 'Backdrop' },
  { title: 'Friends', year: 1994, url: 'e1', source: 'mediux', season: 1, episode: 1 },
  { title: 'Friends', year: 1994, url: 'e2', source: 'mediux', season: 1, episode: 2 },
]

const types = (...t: FileType[]) => new Set<FileType>(t)

beforeEach(() =>
{
  uploadPoster.mockReset()
  uploadPoster.mockResolvedValue({ success: true })
  vi.stubGlobal('window', { api: { plex: { uploadPoster } } })
})

describe('filterByTypes', () =>
{
  it('keeps the picked types in order and counts the rest as hidden', () =>
  {
    const { shown, hidden } = filterByTypes(SET, types('poster', 'backdrop'))
    expect(shown.map(p => p.url)).toEqual(['main', 's1', 'bg'])
    expect(hidden).toBe(2)
  })

  it('hides nothing when every type is picked', () =>
  {
    expect(filterByTypes(SET, types('poster', 'backdrop', 'title_card'))).toEqual({ shown: SET, hidden: 0 })
  })

  it('shows only title cards when they are the only type picked', () =>
  {
    expect(filterByTypes(SET, types('title_card')).shown.map(p => p.url)).toEqual(['e1', 'e2'])
  })
})

describe('toggleFileType', () =>
{
  it('switches a type off and back on', () =>
  {
    const off = toggleFileType(['poster', 'backdrop', 'title_card'], 'title_card')
    expect(off && [...off]).toEqual(['poster', 'backdrop'])
    const on = toggleFileType(off!, 'title_card')
    expect(on && [...on].sort()).toEqual(['backdrop', 'poster', 'title_card'])
  })

  it('keeps the last type on', () =>
  {
    expect(toggleFileType(['poster'], 'poster')).toBeNull()
  })

  it('turns a type on from an empty Settings choice', () =>
  {
    expect([...toggleFileType([], 'backdrop')!]).toEqual(['backdrop'])
  })
})

describe('applyPosters with picked types', () =>
{
  it('uploads only the picked types from a set', async () =>
  {
    const res = await applyPosters('10', SET, types('poster', 'backdrop'), () => {})
    expect(uploadPoster.mock.calls.map(c => c[1])).toEqual(['main', 's1', 'bg'])
    expect(res).toMatchObject({ done: 3, failed: 0, total: 3, appliedUrls: ['main', 's1', 'bg'] })
  })

  it('reports progress against the picked types only', async () =>
  {
    const progress: Array<[number, number]> = []
    await applyPosters('10', SET, types('title_card'), (done, total) => progress.push([done, total]))
    expect(progress).toEqual([[1, 2], [2, 2]])
  })

  it('applies a hand-picked title card even when title cards are off elsewhere', async () =>
  {
    const card = SET[3]
    const settings = types('poster', 'backdrop')
    expect((await applyPosters('10', [card], settings, () => {})).done).toBe(0)

    const res = await applyPosters('10', [card], singleFileTypes(card), () => {})
    expect(res.done).toBe(1)
    expect(uploadPoster).toHaveBeenCalledWith('10', 'e1', 'mediux', 1, 1, undefined, 'Friends (1994)')
  })

  it('sends episode numbers so a title card lands on its episode', async () =>
  {
    await applyPosters('10', SET, types('title_card'), () => {})
    expect(uploadPoster.mock.calls.map(c => [c[3], c[4]])).toEqual([[1, 1], [1, 2]])
  })
})

describe('the choice a job or a scheduled set stores', () =>
{
  const settings: FileType[] = ['poster', 'backdrop', 'title_card']

  it('stores nothing while the toggles still match Settings', () =>
  {
    expect(artworkOverride(types('poster', 'backdrop', 'title_card'), settings)).toBeUndefined()
  })

  it('stores the toggles once title cards are switched off', () =>
  {
    const picked = toggleFileType(settings, 'title_card')!
    expect(artworkOverride(picked, settings)).toEqual(['poster', 'backdrop'])
  })

  it('goes back to following Settings when the toggles are switched back', () =>
  {
    const off = toggleFileType(settings, 'title_card')!
    const back = toggleFileType(off, 'title_card')!
    expect(artworkOverride(back, settings)).toBeUndefined()
  })
})
