import { describe, it, expect, afterEach, vi } from 'vitest'
import cron from 'node-cron'
import type { AppliedRecord, JobRun, ScheduledJob } from '../../electron/ipc/types'
import {
  DEFAULT_QUICK_CRON,
  INTERRUPTED_MESSAGE,
  MAX_JOB_HISTORY,
  ScheduleValidationError,
  analyzeUrls,
  appliedUrlIndex,
  creatorOfUrl,
  creatorSyncUrl,
  cronExpressionError,
  cronToForm,
  coveringJob,
  describeCron,
  describeQuickSync,
  describeRun,
  emptyTally,
  failedRun,
  finishRun,
  formToCron,
  mediuxSetId,
  mergeAppliedRecords,
  nextCronRuns,
  normalizeJob,
  planQuickSync,
  previewCron,
  recordRun,
  recoverInterrupted,
  relativeTime,
  scheduleCoverage,
  urlKey,
  withNextRun,
  type ScheduleForm,
} from '../../electron/services/scheduleUtils'

/** Friday, October 9 2026, 12:00 local time. */
const FRI_NOON = new Date(2026, 9, 9, 12, 0, 0)

function local(d: Date): string
{
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function runs(expr: string, from: Date = FRI_NOON, count = 1): string[]
{
  return nextCronRuns(expr, from, count).map(local)
}

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob
{
  return {
    id: 'job-1',
    name: 'Nightly',
    urls: ['https://mediux.pro/sets/100'],
    cronExpr: '0 3 * * *',
    enabled: true,
    ...overrides,
  }
}

let ids = 0
const makeId = () => `generated-${++ids}`

describe('nextCronRuns', () =>
{
  it('finds the next daily firing and the ones after it', () =>
  {
    expect(runs('0 3 * * *', FRI_NOON, 2)).toEqual(['2026-10-10 03:00:00', '2026-10-11 03:00:00'])
  })

  it('returns a later time on the same day', () =>
  {
    expect(runs('30 14 * * *')).toEqual(['2026-10-09 14:30:00'])
  })

  it('only returns firings strictly after the reference time', () =>
  {
    expect(runs('0 3 * * *', new Date(2026, 9, 10, 3, 0, 0))).toEqual(['2026-10-11 03:00:00'])
  })

  it('handles weekly schedules and weekday lists', () =>
  {
    expect(runs('0 9 * * 1')).toEqual(['2026-10-12 09:00:00'])
    expect(runs('0 9 * * 1,3,5', FRI_NOON, 3)).toEqual(['2026-10-12 09:00:00', '2026-10-14 09:00:00', '2026-10-16 09:00:00'])
  })

  it('accepts weekday names, wrap-around ranges, and 7 as Sunday', () =>
  {
    expect(runs('0 22 * * fri-mon', FRI_NOON, 5)).toEqual([
      '2026-10-09 22:00:00', '2026-10-10 22:00:00', '2026-10-11 22:00:00', '2026-10-12 22:00:00', '2026-10-16 22:00:00',
    ])
    expect(runs('0 0 * * 7')).toEqual(['2026-10-11 00:00:00'])
    expect(runs('0 0 * * SUNDAY')).toEqual(['2026-10-11 00:00:00'])
  })

  it('handles minute and hour steps', () =>
  {
    expect(runs('*/15 * * * *', new Date(2026, 9, 9, 12, 7), 2)).toEqual(['2026-10-09 12:15:00', '2026-10-09 12:30:00'])
    expect(runs('0 */6 * * *', FRI_NOON, 2)).toEqual(['2026-10-09 18:00:00', '2026-10-10 00:00:00'])
    expect(runs('0 0-12/4 * * *', FRI_NOON, 2)).toEqual(['2026-10-10 00:00:00', '2026-10-10 04:00:00'])
  })

  it('handles month names and crosses into the next year', () =>
  {
    expect(runs('0 0 1 jan *')).toEqual(['2027-01-01 00:00:00'])
  })

  it('requires both day fields to match, as node-cron does', () =>
  {
    // Classic cron would fire on Tuesday the 13th; node-cron waits for Friday the 13th.
    expect(runs('0 0 13 * 5')).toEqual(['2026-11-13 00:00:00'])
  })

  it('supports the L, W, and # day tokens', () =>
  {
    expect(runs('0 0 L * *')).toEqual(['2026-10-31 00:00:00'])
    expect(runs('0 0 L-2 * *')).toEqual(['2026-10-29 00:00:00'])
    expect(runs('0 0 17W * *')).toEqual(['2026-10-16 00:00:00'])
    expect(runs('0 0 * * 5L')).toEqual(['2026-10-30 00:00:00'])
    expect(runs('0 0 * * 1#2')).toEqual(['2026-10-12 00:00:00'])
  })

  it('resolves nicknames and six-field expressions', () =>
  {
    expect(runs('@daily')).toEqual(['2026-10-10 00:00:00'])
    expect(runs('@hourly')).toEqual(['2026-10-09 13:00:00'])
    expect(runs('30 0 3 * * *')).toEqual(['2026-10-10 03:00:30'])
  })

  it('returns nothing for a schedule that never fires', () =>
  {
    expect(nextCronRuns('0 0 31 2 *', FRI_NOON, 1)).toEqual([])
  })

  it('matches node-cron for the next firings', () =>
  {
    vi.useFakeTimers()
    vi.setSystemTime(FRI_NOON)
    try
    {
      for (const expr of ['0 3 * * *', '15 9 * * 1-5', '0 */4 * * *', '0 0 L * *', '0 0 13 * 5', '0 22 * * fri-mon', '0 0 * * 1#2', '*/20 8-10 * * *'])
      {
        const task = cron.createTask(expr, () => {})
        const expected = task.getNextRuns(3).map(local)
        void task.destroy()
        expect(runs(expr, FRI_NOON, 3), expr).toEqual(expected)
      }
    }
    finally
    {
      vi.useRealTimers()
    }
  })
})

describe('cronExpressionError', () =>
{
  it('explains malformed expressions', () =>
  {
    expect(cronExpressionError('')).toBe('Enter a cron expression')
    expect(cronExpressionError('0 3 * *')).toBe('Expected 5 fields (minute hour day month weekday) but found 4')
    expect(cronExpressionError('61 * * * *')).toBe('"61" is not a valid minute')
    expect(cronExpressionError('0 0 * * funday')).toBe('"funday" is not a valid weekday')
    expect(cronExpressionError('*/0 * * * *')).toBe('"0" is not a valid step in the minute field')
    expect(cronExpressionError('5/15 * * * *')).toBe('A step needs * or a range, as in */15 or 0-30/15')
    expect(cronExpressionError('0 0 31 2 *', FRI_NOON)).toBe('This schedule never fires')
  })

  it('agrees with node-cron on which expressions are valid', () =>
  {
    const samples = [
      '0 3 * * *', '*/5 * * * *', '0 9 * * mon-fri', '0 0 1 jan,jul *', '0 0 L * *', '0 0 15W * *', '0 0 * * 5L',
      '0 0 * * 1#3', '@weekly', '30 0 3 * * *', '0 22-2 * * *', '0 0 ? * 1',
      '60 * * * *', '0 24 * * *', '0 0 0 * *', '0 0 * 13 *', '0 0 * * 8', '5/15 * * * *', 'a b c d e', '0 3 * *',
      '0 0 31 2 *', '*/0 * * * *',
    ]
    for (const expr of samples)
    {
      expect(cronExpressionError(expr, FRI_NOON) === null, expr).toBe(cron.validate(expr))
    }
  })
})

describe('describeCron', () =>
{
  it('describes the common shapes in plain words', () =>
  {
    expect(describeCron('0 3 * * *')).toBe('Every day at 03:00')
    expect(describeCron('0 9 * * 1')).toBe('Every Monday at 09:00')
    expect(describeCron('0 9 * * 1,3,5')).toBe('Mon, Wed and Fri at 09:00')
    expect(describeCron('30 7 * * 1-5')).toBe('Weekdays at 07:30')
    expect(describeCron('0 10 * * sat,sun')).toBe('Weekends at 10:00')
    expect(describeCron('0 3 1 * *')).toBe('Monthly on the 1st at 03:00')
    expect(describeCron('0 3 22 * *')).toBe('Monthly on the 22nd at 03:00')
    expect(describeCron('0 3 L * *')).toBe('Monthly on the last day at 03:00')
    expect(describeCron('0 */6 * * *')).toBe('Every 6 hours')
    expect(describeCron('15 */2 * * *')).toBe('Every 2 hours at :15')
    expect(describeCron('0 * * * *')).toBe('Every hour')
    expect(describeCron('*/10 * * * *')).toBe('Every 10 minutes')
    expect(describeCron('@daily')).toBe('Every day at 00:00')
    expect(describeCron(DEFAULT_QUICK_CRON)).toBe('Every Sunday at 03:00')
  })

  it('falls back to the expression for shapes without a description', () =>
  {
    expect(describeCron('0 3 * 6 *')).toBe('0 3 * 6 *')
    expect(describeCron('0 0 * * 5L')).toBe('0 0 * * 5L')
    expect(describeCron('not a cron')).toBe('not a cron')
  })
})

describe('previewCron and withNextRun', () =>
{
  it('previews a valid expression with its next firings', () =>
  {
    const preview = previewCron('0 9 * * 1', FRI_NOON, 'America/New_York', 2)
    expect(preview.valid).toBe(true)
    expect(preview.description).toBe('Every Monday at 09:00')
    expect(preview.timeZone).toBe('America/New_York')
    expect(preview.nextRuns.map(r => local(new Date(r)))).toEqual(['2026-10-12 09:00:00', '2026-10-19 09:00:00'])
  })

  it('reports why an expression is invalid', () =>
  {
    const preview = previewCron('0 25 * * *', FRI_NOON, 'UTC')
    expect(preview).toMatchObject({ valid: false, error: '"25" is not a valid hour', nextRuns: [] })
  })

  it('sets nextRun only on enabled jobs and never keeps a stale value', () =>
  {
    const [on, off] = withNextRun([
      job({ id: 'a' }),
      job({ id: 'b', enabled: false, nextRun: '2020-01-01T00:00:00.000Z' }),
    ], FRI_NOON)
    expect(local(new Date(on.nextRun!))).toBe('2026-10-10 03:00:00')
    expect(off.nextRun).toBeUndefined()
  })
})

describe('formToCron and cronToForm', () =>
{
  const base: ScheduleForm = { preset: 'daily', hour: 3, minute: 0, days: [0], dayOfMonth: 1, everyHours: 6, custom: '' }

  it('builds an expression for each preset', () =>
  {
    expect(formToCron({ ...base, preset: 'hourly', everyHours: 1, minute: 15 })).toBe('15 * * * *')
    expect(formToCron({ ...base, preset: 'hourly', everyHours: 6 })).toBe('0 */6 * * *')
    expect(formToCron({ ...base, preset: 'daily', hour: 4, minute: 30 })).toBe('30 4 * * *')
    expect(formToCron({ ...base, preset: 'weekly', days: [5, 1, 3, 1] })).toBe('0 3 * * 1,3,5')
    expect(formToCron({ ...base, preset: 'weekly', days: [] })).toBe('0 3 * * *')
    expect(formToCron({ ...base, preset: 'monthly', dayOfMonth: 15 })).toBe('0 3 15 * *')
    expect(formToCron({ ...base, preset: 'custom', custom: '  0 0 L * * ' })).toBe('0 0 L * *')
  })

  it('round-trips every preset', () =>
  {
    for (const expr of ['15 * * * *', '0 */6 * * *', '30 4 * * *', '0 9 * * 1,3,5', '0 3 15 * *'])
    {
      expect(formToCron(cronToForm(expr))).toBe(expr)
    }
  })

  it('reads weekday ranges into the weekly picker', () =>
  {
    expect(cronToForm('0 8 * * 1-5')).toMatchObject({ preset: 'weekly', hour: 8, minute: 0, days: [1, 2, 3, 4, 5] })
  })

  it('keeps anything the picker cannot show as custom', () =>
  {
    for (const expr of ['0 0 L * *', '0 3 * 6 *', '0 */5 * * *', '0 0 13 * 5', '30 0 3 * * *'])
    {
      expect(cronToForm(expr)).toMatchObject({ preset: 'custom', custom: expr })
    }
  })
})

describe('analyzeUrls', () =>
{
  it('trims, drops blanks and duplicates, and flags unsupported sites', () =>
  {
    const result = analyzeUrls('  https://mediux.pro/sets/1 \n\nmediux.pro/sets/1/\nhttps://example.com/x\nhttps://theposterdb.com/set/9')
    expect(result.urls).toEqual(['https://mediux.pro/sets/1', 'https://example.com/x', 'https://theposterdb.com/set/9'])
    expect(result.duplicates).toBe(1)
    expect(result.unsupported).toEqual(['https://example.com/x'])
  })

  it('compares URLs without case, scheme, www, or trailing slashes', () =>
  {
    expect(urlKey('HTTPS://www.MediUX.pro/sets/5//')).toBe(urlKey('mediux.pro/sets/5'))
  })
})

describe('normalizeJob', () =>
{
  it('assigns an id when the client sends none', () =>
  {
    const saved = normalizeJob({ name: 'A', urls: ['https://mediux.pro/sets/1'], cronExpr: '0 3 * * *' }, undefined, { makeId: () => 'new-id' })
    expect(saved).toEqual({
      id: 'new-id', name: 'A', urls: ['https://mediux.pro/sets/1'], cronExpr: '0 3 * * *', enabled: true, skipApplied: true,
    })
  })

  it('cleans up the name, URLs, and cron spacing', () =>
  {
    const saved = normalizeJob({
      id: 'abc', name: '  Weekly  ', cronExpr: ' 0  9 * *   1 ', enabled: false, skipApplied: false, creator: ' alice ',
      urls: [' https://mediux.pro/sets/1 ', 'https://mediux.pro/sets/1/', '', 42],
    }, undefined, { makeId })
    expect(saved).toMatchObject({
      id: 'abc', name: 'Weekly', urls: ['https://mediux.pro/sets/1'], cronExpr: '0 9 * * 1', enabled: false, skipApplied: false, creator: 'alice',
    })
  })

  it('keeps run status and history from the stored job, not the payload', () =>
  {
    const history: JobRun[] = [failedRun('boom', FRI_NOON, FRI_NOON, 'manual')]
    const stored = job({ lastRun: 'stored-run', lastStatus: 'error', lastError: 'boom', history })
    const saved = normalizeJob({ ...job(), lastRun: 'forged', lastStatus: 'success', history: [] }, stored, { makeId })
    expect(saved).toMatchObject({ lastRun: 'stored-run', lastStatus: 'error', lastError: 'boom', history })
  })

  it('rejects payloads it cannot store', () =>
  {
    const valid = { name: 'A', urls: ['https://mediux.pro/sets/1'], cronExpr: '0 3 * * *' }
    const reject = (input: unknown, message: string, isValidCron?: (expr: string) => boolean) =>
    {
      expect(() => normalizeJob(input, undefined, { makeId, isValidCron })).toThrow(new ScheduleValidationError(message))
    }
    reject(null, 'Job data is missing')
    reject({ ...valid, name: '   ' }, 'Give the job a name')
    reject({ ...valid, name: 'x'.repeat(121) }, 'Job names are limited to 120 characters')
    reject({ ...valid, urls: [] }, 'Add at least one ThePosterDB or MediUX URL')
    reject({ ...valid, urls: ['https://evil.com/?mediux.pro'] }, 'Unsupported URL: https://evil.com/?mediux.pro (use theposterdb.com or mediux.pro links)')
    reject({ ...valid, cronExpr: '0 3 * *' }, 'Expected 5 fields (minute hour day month weekday) but found 4')
    reject({ ...valid, id: '../etc' }, 'Invalid job id')
    reject(valid, '"0 3 * * *" is not a supported cron expression', () => false)
  })

  it('sets a 400 status code for the web API', () =>
  {
    expect(new ScheduleValidationError('x').statusCode).toBe(400)
  })
})

describe('creator and set URL helpers', () =>
{
  it('reads creators and set ids from MediUX URLs', () =>
  {
    expect(creatorSyncUrl('Alice')).toBe('https://mediux.pro/user/Alice/sets')
    expect(creatorOfUrl('https://mediux.pro/user/Alice/sets')).toBe('alice')
    expect(creatorOfUrl('https://mediux.pro/sets/12')).toBeNull()
    expect(mediuxSetId('https://mediux.pro/sets/12?x=1')).toBe('12')
    expect(mediuxSetId('https://theposterdb.com/set/12')).toBeNull()
  })
})

describe('planQuickSync', () =>
{
  const setUrl = (id: number) => `https://mediux.pro/sets/${id}`

  it('creates a job when nothing covers the URLs', () =>
  {
    const plan = planQuickSync([], { urls: [setUrl(1)], name: 'Show - Set', cronExpr: '0 3 * * 0' }, () => 'id-1')
    expect(plan).toEqual({
      kind: 'create',
      job: { id: 'id-1', name: 'Show - Set', urls: [setUrl(1)], cronExpr: '0 3 * * 0', enabled: true, skipApplied: true },
    })
  })

  it('leaves an enabled job that already covers the URL alone', () =>
  {
    const existing = job({ urls: [setUrl(1), setUrl(2)] })
    expect(planQuickSync([existing], { urls: [`${setUrl(1)}/`], name: 'x', cronExpr: '0 3 * * 0' }, makeId))
      .toEqual({ kind: 'exists', job: existing })
  })

  it('treats a creator-wide sync as covering that creator\'s sets', () =>
  {
    const wide = job({ urls: [creatorSyncUrl('Alice')] })
    const plan = planQuickSync([wide], { urls: [setUrl(9)], name: 'x', cronExpr: '0 3 * * 0', creator: 'alice' }, makeId)
    expect(plan).toEqual({ kind: 'exists', job: wide })
  })

  it('re-enables a disabled job instead of adding a duplicate', () =>
  {
    const disabled = job({ enabled: false })
    const plan = planQuickSync([disabled], { urls: [setUrl(100)], name: 'x', cronExpr: '0 3 * * 0' }, makeId)
    expect(plan).toEqual({ kind: 'update', job: { ...disabled, enabled: true }, added: 0, reenabled: true })
  })

  it('merges selected sets into the creator\'s existing sync job', () =>
  {
    const creatorJob = job({ name: 'Sync @alice (1 set)', urls: [setUrl(1)], cronExpr: '0 9 * * 1' })
    const plan = planQuickSync([creatorJob], {
      urls: [setUrl(1), setUrl(2), setUrl(3)], name: 'Sync @alice (3 sets)', cronExpr: '0 3 * * 0', creator: 'alice', groupByCreator: true,
    }, makeId)
    expect(plan).toEqual({
      kind: 'update',
      job: { ...creatorJob, name: 'Sync @alice (3 sets)', urls: [setUrl(1), setUrl(2), setUrl(3)], creator: 'alice' },
      added: 2,
      reenabled: false,
    })
  })

  it('replaces individual sets when the whole creator is synced', () =>
  {
    const creatorJob = job({ name: 'Sync @alice (2 sets)', creator: 'alice', urls: [setUrl(1), setUrl(2), 'https://theposterdb.com/set/5'] })
    const plan = planQuickSync([creatorJob], {
      urls: [creatorSyncUrl('alice')], name: 'Sync @alice', cronExpr: '0 3 * * 0', creator: 'alice', groupByCreator: true,
    }, makeId)
    expect(plan.kind).toBe('update')
    expect(plan.job.urls).toEqual(['https://theposterdb.com/set/5', creatorSyncUrl('alice')])
    expect(plan.job.name).toBe('Sync @alice')
  })

  it('keeps a name the user customized', () =>
  {
    const creatorJob = job({ name: 'Alice favorites', creator: 'alice', urls: [setUrl(1)] })
    const plan = planQuickSync([creatorJob], { urls: [setUrl(2)], name: 'x', cronExpr: '0 3 * * 0', creator: 'alice', groupByCreator: true }, makeId)
    expect(plan.job.name).toBe('Alice favorites')
  })

  it('tags new creator jobs so later syncs can find them', () =>
  {
    const plan = planQuickSync([], { urls: [setUrl(1)], name: 'Sync @bob (1 set)', cronExpr: '0 3 * * 0', creator: 'bob', groupByCreator: true }, () => 'id-2')
    expect(plan).toMatchObject({ kind: 'create', job: { id: 'id-2', creator: 'bob' } })
  })
})

describe('describeQuickSync', () =>
{
  const base = job({ name: 'Sync @alice', cronExpr: '0 3 * * 0' })

  it('names the job and its schedule for each outcome', () =>
  {
    expect(describeQuickSync({ kind: 'exists', job: base }, 0, 'alice')).toBe('Already synced by "Sync @alice" (Every Sunday at 03:00).')
    expect(describeQuickSync({ kind: 'create', job: base }, 3, 'alice')).toBe('Syncing 3 sets (Every Sunday at 03:00).')
    expect(describeQuickSync({ kind: 'create', job: base }, 0, 'alice')).toBe('Syncing every set from @alice (Every Sunday at 03:00).')
    expect(describeQuickSync({ kind: 'update', job: base, added: 1, reenabled: false }, 1, 'alice')).toBe('Added 1 set to "Sync @alice" (Every Sunday at 03:00).')
    expect(describeQuickSync({ kind: 'update', job: base, added: 0, reenabled: true }, 1, 'alice')).toBe('Turned "Sync @alice" back on (Every Sunday at 03:00).')
  })

  it('reports when a creator job now covers every set', () =>
  {
    const wide = job({ name: 'Sync @alice', urls: [creatorSyncUrl('alice')] })
    expect(describeQuickSync({ kind: 'update', job: wide, added: 1, reenabled: false }, 0, 'alice'))
      .toBe('"Sync @alice" now syncs every set from @alice (Every day at 03:00).')
  })
})

describe('scheduleCoverage', () =>
{
  it('indexes enabled jobs by set and by creator', () =>
  {
    const setJob = job({ id: 'sets', urls: ['https://mediux.pro/sets/1'] })
    const wideJob = job({ id: 'wide', urls: [creatorSyncUrl('Alice')] })
    const offJob = job({ id: 'off', enabled: false, urls: ['https://mediux.pro/sets/2'] })
    const coverage = scheduleCoverage([setJob, wideJob, offJob])
    expect(coveringJob(coverage, '1')?.id).toBe('sets')
    expect(coveringJob(coverage, '99', 'ALICE')?.id).toBe('wide')
    expect(coveringJob(coverage, '2')).toBeUndefined()
  })
})

describe('applied history', () =>
{
  const rec = (overrides: Partial<AppliedRecord>): AppliedRecord => ({
    itemKey: '1', title: 'Show', type: 'show', source: 'mediux', appliedAt: '2026-10-01T00:00:00.000Z', ...overrides,
  })

  it('collects every image URL applied to each item', () =>
  {
    const index = appliedUrlIndex([
      rec({ itemKey: '1', setId: 'a', posterUrls: ['u1', 'u2'] }),
      rec({ itemKey: '1', setId: 'b', posterUrls: ['u3'] }),
      rec({ itemKey: '2' }),
    ])
    expect([...index.get('1')!]).toEqual(['u1', 'u2', 'u3'])
    expect(index.get('2')!.size).toBe(0)
  })

  it('merges entries per item and set, newest first, within the cap', () =>
  {
    const existing = [rec({ itemKey: '1', setId: 'a', posterUrls: ['u1'] }), rec({ itemKey: '2', setId: 'a' })]
    const merged = mergeAppliedRecords(existing, [rec({ itemKey: '1', setId: 'a', posterUrls: ['u1', 'u2'], appliedAt: 'new' })])
    expect(merged.map(r => [r.itemKey, r.appliedAt, r.posterUrls])).toEqual([
      ['1', 'new', ['u1', 'u2']],
      ['2', '2026-10-01T00:00:00.000Z', undefined],
    ])
    expect(mergeAppliedRecords(existing, [rec({ itemKey: '3' })], 2).map(r => r.itemKey)).toEqual(['3', '1'])
  })
})

describe('run results', () =>
{
  const start = new Date('2026-10-09T03:00:00.000Z')
  const end = new Date('2026-10-09T03:02:00.000Z')

  it('succeeds when everything worked, even with nothing new', () =>
  {
    const run = finishRun({ ...emptyTally(2), skipped: 40 }, start, end, 'schedule')
    expect(run).toEqual({
      startedAt: start.toISOString(), finishedAt: end.toISOString(), trigger: 'schedule', status: 'success',
      uploaded: 0, skipped: 40, unmatched: 0, failed: 0, urlErrors: 0,
    })
    expect(describeRun(run)).toBe('Up to date · 40 already applied')
  })

  it('is partial when some uploads or URLs failed', () =>
  {
    const run = finishRun({ ...emptyTally(2), uploaded: 3, failed: 1, urlErrors: 1, unmatched: 2, firstError: 'Image download failed: 404' }, start, end, 'manual')
    expect(run.status).toBe('partial')
    expect(run.error).toBe('Image download failed: 404')
    expect(describeRun(run)).toBe('3 posters applied · 2 titles not in library · 1 failed · 1 URL could not be read')
  })

  it('fails when no URL could be read', () =>
  {
    const run = finishRun({ ...emptyTally(1), urlErrors: 1, firstError: 'x: timeout' }, start, end, 'schedule')
    expect(run.status).toBe('error')
    expect(describeRun(failedRun('Not connected to Plex', start, end, 'manual'))).toBe('Not connected to Plex')
    expect(describeRun(finishRun(emptyTally(1), start, end, 'manual'))).toBe('Nothing new to apply')
  })

  it('stores runs on the job, newest first, within the history limit', () =>
  {
    let current = job({ lastError: 'old' })
    for (let i = 0; i < MAX_JOB_HISTORY + 2; i++)
    {
      current = recordRun(current, finishRun({ ...emptyTally(1), uploaded: i }, start, end, 'schedule'))
    }
    expect(current.history).toHaveLength(MAX_JOB_HISTORY)
    expect(current.history![0].uploaded).toBe(MAX_JOB_HISTORY + 1)
    expect(current).toMatchObject({ lastRun: start.toISOString(), lastStatus: 'success' })
    expect(current.lastError).toBeUndefined()

    const failed = recordRun(current, failedRun('boom', start, end, 'manual'))
    expect(failed).toMatchObject({ lastStatus: 'error', lastError: 'boom' })
  })

  it('marks jobs left running by a previous process as interrupted', () =>
  {
    const result = recoverInterrupted([job({ id: 'a', lastStatus: 'running' }), job({ id: 'b', lastStatus: 'success' })])
    expect(result.changed).toBe(true)
    expect(result.jobs.map(j => [j.lastStatus, j.lastError])).toEqual([['error', INTERRUPTED_MESSAGE], ['success', undefined]])
    expect(recoverInterrupted([job()]).changed).toBe(false)
  })
})

describe('relativeTime', () =>
{
  afterEach(() =>
  {
    vi.useRealTimers()
  })

  it('formats future and past distances', () =>
  {
    const now = FRI_NOON.getTime()
    expect(relativeTime(now + 10_000, now)).toBe('in a moment')
    expect(relativeTime(now - 10_000, now)).toBe('just now')
    expect(relativeTime(now + 5 * 60_000, now)).toBe('in 5m')
    expect(relativeTime(now + 135 * 60_000, now)).toBe('in 2h 15m')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(relativeTime(now + (2 * 24 + 4) * 3_600_000, now)).toBe('in 2d 4h')
    expect(relativeTime(now - 3 * 24 * 3_600_000, now)).toBe('3d ago')
  })

  it('defaults to the current time', () =>
  {
    vi.useFakeTimers()
    vi.setSystemTime(FRI_NOON)
    expect(relativeTime(new Date(FRI_NOON.getTime() + 60 * 60_000))).toBe('in 1h')
  })
})
