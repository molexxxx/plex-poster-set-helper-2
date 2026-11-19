import { describe, it, expect, vi, afterEach } from 'vitest'
import { describeJobTypes, formatWhen, jobIdentity, jobStatus, ordinal, statusLabel } from '../features/scheduler/schedulerFormat'
import { trapTab } from '../features/scheduler/components/JobForm/trapTab'
import type { ScheduledJob } from '../../electron/ipc/types'

function job(extra: Partial<ScheduledJob> = {}): ScheduledJob
{
  return { id: 'j', name: 'Job', urls: ['https://mediux.pro/sets/1'], cronExpr: '0 3 * * *', enabled: true, ...extra }
}

describe('ordinal', () =>
{
  it('picks the suffix from the last digit', () =>
  {
    expect([1, 2, 3, 4, 10, 21, 22, 23, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '10th', '21st', '22nd', '23rd', '101st'])
  })

  it('uses th for the teens', () =>
  {
    expect([11, 12, 13, 111, 112, 113].map(ordinal)).toEqual(['11th', '12th', '13th', '111th', '112th', '113th'])
  })
})

describe('describeJobTypes', () =>
{
  it('names types picked for the job', () =>
  {
    expect(describeJobTypes(job({ assetTypes: ['poster', 'backdrop'] }), ['title_card'])).toBe('Posters and backdrops, picked for this job')
  })

  it('names the Settings types when the job has none of its own', () =>
  {
    expect(describeJobTypes(job(), ['title_card'])).toBe('Title cards, as set in Settings')
  })
})

describe('jobIdentity', () =>
{
  it('names the creator a sync follows', () =>
  {
    expect(jobIdentity(job({ creator: 'willtong93', urls: ['https://mediux.pro/user/willtong93/sets'] }))).toBe('@willtong93 · MediUX creator')
    expect(jobIdentity(job({ urls: ['https://mediux.pro/user/Someone/sets'] }))).toBe('@someone · MediUX creator')
  })

  it('counts sets and names their sites', () =>
  {
    expect(jobIdentity(job())).toBe('1 set · MediUX')
    expect(jobIdentity(job({ urls: ['https://mediux.pro/sets/1', 'https://theposterdb.com/set/2'] }))).toBe('2 sets · MediUX and ThePosterDB')
    expect(jobIdentity(job({ urls: ['https://example.com/x'] }))).toBe('1 set')
  })
})

describe('jobStatus', () =>
{
  it('shows a starting or running job as running', () =>
  {
    expect(jobStatus(job(), true)).toBe('running')
    expect(jobStatus(job({ lastStatus: 'running', enabled: false }), false)).toBe('running')
  })

  it('puts queued before paused, and paused before the last result', () =>
  {
    expect(jobStatus(job({ queued: true, enabled: false }), false)).toBe('queued')
    expect(jobStatus(job({ enabled: false, lastStatus: 'error' }), false)).toBe('paused')
    expect(jobStatus(job({ lastStatus: 'partial' }), false)).toBe('partial')
    expect(jobStatus(job(), false)).toBeUndefined()
  })
})

describe('statusLabel', () =>
{
  it('labels each status', () =>
  {
    expect(statusLabel(job(), 'running')).toBe('Running')
    expect(statusLabel(job(), 'error')).toBe('Failed')
    expect(statusLabel(job(), 'partial')).toBe('Partly failed')
  })

  it('gives a queued job its place in line', () =>
  {
    expect(statusLabel(job({ queuePosition: 3 }), 'queued')).toBe('Queued · 3rd in line')
    expect(statusLabel(job({ queuePosition: 1 }), 'queued')).toBe('Queued · next')
    expect(statusLabel(job(), 'queued')).toBe('Queued · next')
  })
})

describe('formatWhen', () =>
{
  it('formats a run time in the local time zone', () =>
  {
    const iso = '2026-10-11T07:00:00.000Z'
    const expected = new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    expect(formatWhen(iso)).toBe(expected)
  })
})

describe('trapTab', () =>
{
  afterEach(() =>
  {
    vi.unstubAllGlobals()
  })

  function setup(activeIndex: number)
  {
    const els = [0, 1, 2].map(() => ({ offsetParent: {}, focus: vi.fn() }))
    const hidden = { offsetParent: null, focus: vi.fn() }
    const container = { querySelectorAll: () => [els[0], hidden, els[1], els[2]] } as unknown as HTMLElement
    vi.stubGlobal('document', { activeElement: els[activeIndex] })
    return { els, hidden, container }
  }

  const key = (k: string, shiftKey = false) =>
    ({ key: k, shiftKey, preventDefault: vi.fn() }) as unknown as Parameters<typeof trapTab>[0] & { preventDefault: ReturnType<typeof vi.fn> }

  it('wraps Tab from the last control to the first', () =>
  {
    const { els, container } = setup(2)
    const e = key('Tab')
    trapTab(e, container)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(els[0].focus).toHaveBeenCalled()
  })

  it('wraps Shift+Tab from the first control to the last', () =>
  {
    const { els, container } = setup(0)
    const e = key('Tab', true)
    trapTab(e, container)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(els[2].focus).toHaveBeenCalled()
  })

  it('leaves Tab alone between the ends, other keys, and a missing container', () =>
  {
    const { els, hidden, container } = setup(1)
    const middle = key('Tab')
    trapTab(middle, container)
    trapTab(key('Enter'), container)
    trapTab(key('Tab'), null)
    expect(middle.preventDefault).not.toHaveBeenCalled()
    for (const el of [...els, hidden]) expect(el.focus).not.toHaveBeenCalled()
  })
})
