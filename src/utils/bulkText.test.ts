import { describe, it, expect } from 'vitest'
import { displayName, resultNote, urlLines, withTxt } from '../features/bulk/bulkText'

describe('bulk file helpers', () =>
{
  it('shows a file without its .txt extension', () =>
  {
    expect(displayName('favorites.txt')).toBe('favorites')
    expect(displayName('notes.txt.bak')).toBe('notes.txt.bak')
  })

  it('adds .txt only when it is missing', () =>
  {
    expect(withTxt('shows')).toBe('shows.txt')
    expect(withTxt('shows.txt')).toBe('shows.txt')
  })

  it('reads one URL per non-blank line', () =>
  {
    expect(urlLines('  https://a/1\n\n https://a/2  \n   ')).toEqual(['https://a/1', 'https://a/2'])
    expect(urlLines('')).toEqual([])
  })

  it('notes what each URL of a run did', () =>
  {
    const base = { url: 'https://a/1', posterCount: 4, uploadedCount: 3 }
    expect(resultNote({ ...base, status: 'done' })).toBe('3/4 uploaded')
    expect(resultNote({ ...base, status: 'no_match' })).toBe('no posters found')
    expect(resultNote({ ...base, status: 'error', error: 'x'.repeat(60) })).toBe('x'.repeat(50))
    expect(resultNote({ ...base, status: 'error' })).toBeUndefined()
  })
})
