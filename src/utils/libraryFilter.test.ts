import { describe, it, expect } from 'vitest'
import type { AppliedRecord, ScheduledJob } from '../../electron/ipc/types'
import { appliedByItem, appliedUploaders, artFilterMatches } from '../../electron/services/schedule/appliedArt'
import { creatorSyncUrl, scheduleCoverage } from '../../electron/services/schedule/coverage'

function rec(itemKey: string, overrides: Partial<AppliedRecord> = {}): AppliedRecord
{
  return { itemKey, title: 'Show', type: 'show', source: 'mediux', appliedAt: '2026-10-01T00:00:00.000Z', ...overrides }
}

function job(urls: string[], enabled = true): ScheduledJob
{
  return { id: urls.join('|'), name: 'job', urls, cronExpr: '0 3 * * *', enabled }
}

describe('appliedByItem and appliedUploaders', () =>
{
  it('groups records per item and counts items per creator', () =>
  {
    const records = [
      rec('1', { uploader: 'Willtong93', setId: 'a' }),
      rec('1', { uploader: 'tallinex', setId: 'b' }),
      rec('2', { uploader: 'willtong93', setId: 'c' }),
      rec('3'),
    ]
    expect([...appliedByItem(records).keys()]).toEqual(['1', '2', '3'])
    expect(appliedByItem(records).get('1')).toHaveLength(2)
    expect(appliedUploaders(records)).toEqual([
      { uploader: 'Willtong93', source: 'mediux', count: 2 },
      { uploader: 'tallinex', source: 'mediux', count: 1 },
    ])
  })

  it('keeps the same name on MediUX and ThePosterDB as two creators', () =>
  {
    const records = [
      rec('1', { uploader: 'alice', setId: 'a' }),
      rec('2', { uploader: 'Alice', setId: 'b', source: 'posterdb' }),
      rec('3', { uploader: 'alice', setId: 'c', source: 'posterdb' }),
    ]
    expect(appliedUploaders(records)).toEqual([
      { uploader: 'Alice', source: 'posterdb', count: 2 },
      { uploader: 'alice', source: 'mediux', count: 1 },
    ])
  })
})

describe('artFilterMatches', () =>
{
  const coverage = scheduleCoverage([job([creatorSyncUrl('willtong93')]), job(['https://mediux.pro/sets/55']), job([creatorSyncUrl('paused')], false)])

  it('separates titles with and without applied art', () =>
  {
    expect(artFilterMatches({ kind: 'none' }, [], coverage)).toBe(true)
    expect(artFilterMatches({ kind: 'none' }, [rec('1')], coverage)).toBe(false)
    expect(artFilterMatches({ kind: 'applied' }, [rec('1')], coverage)).toBe(true)
    expect(artFilterMatches({ kind: 'applied' }, [], coverage)).toBe(false)
  })

  it('matches a creator without regard to case', () =>
  {
    expect(artFilterMatches({ kind: 'uploader', uploader: 'WILLTONG93' }, [rec('1', { uploader: 'willtong93' })], coverage)).toBe(true)
    expect(artFilterMatches({ kind: 'uploader', uploader: 'tallinex' }, [rec('1', { uploader: 'willtong93' })], coverage)).toBe(false)
    expect(artFilterMatches({ kind: 'uploader', uploader: 'tallinex' }, [rec('1')], coverage)).toBe(false)
  })

  it('narrows a creator to one site when the filter names it', () =>
  {
    const fromTpdb = [rec('1', { uploader: 'alice', source: 'posterdb' })]
    expect(artFilterMatches({ kind: 'uploader', uploader: 'alice', source: 'posterdb' }, fromTpdb, coverage)).toBe(true)
    expect(artFilterMatches({ kind: 'uploader', uploader: 'alice', source: 'mediux' }, fromTpdb, coverage)).toBe(false)
    expect(artFilterMatches({ kind: 'uploader', uploader: 'alice' }, fromTpdb, coverage)).toBe(true)
  })

  it('finds applied art that no enabled job keeps updated', () =>
  {
    const unscheduled = { kind: 'unscheduled' } as const
    expect(artFilterMatches(unscheduled, [rec('1', { uploader: 'other', setId: '9' })], coverage)).toBe(true)
    expect(artFilterMatches(unscheduled, [rec('1', { uploader: 'paused', setId: '9' })], coverage)).toBe(true)
    expect(artFilterMatches(unscheduled, [rec('1')], coverage)).toBe(true)
    expect(artFilterMatches(unscheduled, [rec('1', { uploader: 'Willtong93', setId: '9' })], coverage)).toBe(false)
    expect(artFilterMatches(unscheduled, [rec('1', { setId: '55' })], coverage)).toBe(false)
    expect(artFilterMatches(unscheduled, [rec('1', { uploader: 'other' }), rec('1', { setId: '55' })], coverage)).toBe(false)
    expect(artFilterMatches(unscheduled, [], coverage)).toBe(false)
  })
})
