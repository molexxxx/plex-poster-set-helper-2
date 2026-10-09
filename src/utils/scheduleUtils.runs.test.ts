import { describe, it, expect } from 'vitest'
import type { AppliedRecord, ScheduledJob } from '../../electron/ipc/types'
import {
  MAX_RUN_DETAIL,
  addSlotCoverage,
  describeRun,
  emptyTally,
  finishRun,
  isSlotCovered,
  mergeAppliedRecords,
  normalizeJob,
  posterKind,
  posterSlot,
  reorderJobs,
  runDetails,
  slotCoverage,
  titleLabel,
} from '../../electron/services/scheduleUtils'

const START = new Date('2026-10-11T03:00:00.000Z')
const END = new Date('2026-10-11T03:05:00.000Z')

function rec(overrides: Partial<AppliedRecord>): AppliedRecord
{
  return { itemKey: '1', title: 'Show', type: 'show', source: 'mediux', appliedAt: '2026-10-01T00:00:00.000Z', ...overrides }
}

function job(id: string): ScheduledJob
{
  return { id, name: id.toUpperCase(), urls: ['https://mediux.pro/sets/1'], cronExpr: '0 3 * * *', enabled: true }
}

describe('posterSlot and posterKind', () =>
{
  it('names the slot each kind of art fills', () =>
  {
    expect(posterSlot({})).toBe('poster')
    expect(posterSlot({ season: 2 })).toBe('s2')
    expect(posterSlot({ season: 0 })).toBe('s0')
    expect(posterSlot({ season: 1, episode: 3 })).toBe('s1e3')
    expect(posterSlot({ season: 'Backdrop' })).toBe('backdrop')
    expect(posterSlot({ season: 'Cover' })).toBe('poster')
  })

  it('classifies art by the MediUX file type filter', () =>
  {
    expect(posterKind({})).toBe('poster')
    expect(posterKind({ season: 2 })).toBe('poster')
    expect(posterKind({ season: 1, episode: 3 })).toBe('title_card')
    expect(posterKind({ season: 'Backdrop' })).toBe('backdrop')
  })
})

describe('slot coverage', () =>
{
  it('treats a record without slots as covering the whole item, except for its own set', () =>
  {
    const coverage = slotCoverage([rec({ setId: 'A' })])
    expect(isSlotCovered(coverage, '1', 's1e1', 'B')).toBe(true)
    expect(isSlotCovered(coverage, '1', 'poster', 'B')).toBe(true)
    expect(isSlotCovered(coverage, '1', 's1e1', 'A')).toBe(false)
    expect(isSlotCovered(coverage, '2', 's1e1', 'B')).toBe(false)
  })

  it('covers only the slots a slot-tracked record lists', () =>
  {
    const coverage = slotCoverage([rec({ setId: 'A', slots: ['s1e1', 'poster'] })])
    expect(isSlotCovered(coverage, '1', 's1e1', 'B')).toBe(true)
    expect(isSlotCovered(coverage, '1', 'poster', 'B')).toBe(true)
    expect(isSlotCovered(coverage, '1', 's1e2', 'B')).toBe(true === false)
    expect(isSlotCovered(coverage, '1', 's1e1', 'A')).toBe(false)
  })

  it('counts art applied by hand against every set', () =>
  {
    const coverage = slotCoverage([rec({ slots: ['s1e1'] })])
    expect(isSlotCovered(coverage, '1', 's1e1', 'A')).toBe(true)
    expect(isSlotCovered(coverage, '1', 's1e1')).toBe(false)
  })

  it('sees slots filled earlier in the same run', () =>
  {
    const coverage = slotCoverage([])
    addSlotCoverage(coverage, '1', 's1e1', 'A')
    expect(isSlotCovered(coverage, '1', 's1e1', 'B')).toBe(true)
    expect(isSlotCovered(coverage, '1', 's1e1', 'A')).toBe(false)
  })
})

describe('run details', () =>
{
  it('lists applied, failed, and unmatched titles and counts covered posters', () =>
  {
    const tally = emptyTally(1)
    tally.uploaded = 3
    tally.covered = 2
    tally.failed = 1
    tally.unmatched = 1
    tally.appliedTitles.set('9-1-1 (2018)', 3)
    tally.unmatchedTitles.add('FBI (2018)')
    tally.failedTitles.set('X (2020)', 'Image download failed: 404')

    const run = finishRun(tally, START, END, 'manual')
    expect(run.status).toBe('partial')
    expect(run.covered).toBe(2)
    expect(run.details).toEqual({
      applied: ['9-1-1 (2018) · 3 posters'],
      unmatched: ['FBI (2018)'],
      failed: ['X (2020) · Image download failed: 404'],
    })
    expect(describeRun(run)).toBe('3 posters applied · 2 left to other art · 1 title not in library · 1 failed')
  })

  it('omits details and the covered count when nothing was recorded', () =>
  {
    expect(runDetails(emptyTally(0))).toBeUndefined()
    const run = finishRun(emptyTally(1), START, END, 'schedule')
    expect(run.details).toBeUndefined()
    expect(run.covered).toBeUndefined()
  })

  it('cuts long lists off with a count of the rest', () =>
  {
    const tally = emptyTally(1)
    for (let i = 0; i < MAX_RUN_DETAIL + 50; i++) tally.unmatchedTitles.add(`Show ${i}`)
    const details = runDetails(tally)!
    expect(details.unmatched).toHaveLength(MAX_RUN_DETAIL + 1)
    expect(details.unmatched.at(-1)).toBe('and 50 more')
  })

  it('labels titles with their year when known', () =>
  {
    expect(titleLabel('X', 2020)).toBe('X (2020)')
    expect(titleLabel('X')).toBe('X')
  })
})

describe('mergeAppliedRecords slots', () =>
{
  it('unions slots per item and set', () =>
  {
    const merged = mergeAppliedRecords([rec({ setId: 'A', slots: ['s1e1'] })], [rec({ setId: 'A', slots: ['s1e2', 's1e1'] })])
    expect(merged).toHaveLength(1)
    expect(merged[0].slots).toEqual(['s1e1', 's1e2'])
  })

  it('leaves records without slots as they are', () =>
  {
    const merged = mergeAppliedRecords([rec({ setId: 'A' })], [rec({ setId: 'A', posterUrls: ['u'] })])
    expect(merged[0].slots).toBeUndefined()
  })
})

describe('reorderJobs', () =>
{
  it('orders by the ids given and keeps the rest at the end', () =>
  {
    const ordered = reorderJobs([job('a'), job('b'), job('c')], ['c', 'nope', 'a'])
    expect(ordered.map(j => j.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('normalizeJob fillGaps', () =>
{
  const base = { name: 'A', urls: ['https://mediux.pro/sets/1'], cronExpr: '0 3 * * *' }
  const makeId = () => 'id'

  it('keeps fill gaps only when explicitly on', () =>
  {
    expect(normalizeJob({ ...base, fillGaps: true }, undefined, { makeId }).fillGaps).toBe(true)
    expect(normalizeJob(base, undefined, { makeId }).fillGaps).toBeUndefined()
    expect(normalizeJob({ ...base, fillGaps: 'yes' }, undefined, { makeId }).fillGaps).toBeUndefined()
  })
})
