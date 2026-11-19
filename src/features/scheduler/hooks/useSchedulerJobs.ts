import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScheduledJob, SchedulerEngineStatus } from '../../../../electron/ipc/types'
import { describeRun } from '../../../../electron/services/scheduleUtils'
import { errorMessage } from '../../../utils/errorMessage'

/**
 * The scheduled jobs and the scheduler engine's status. Loads both on mount,
 * follows the changes the scheduler pushes, polls every 30 seconds, and
 * announces runs that finish while the page is open.
 *
 * @returns The jobs, the ids being started, the engine status, the last action
 *   error, the announcement, whether the first load finished, and the job actions.
 */
export function useSchedulerJobs()
{
  const [jobs,        setJobs]        = useState<ScheduledJob[]>([])
  const [starting,    setStarting]    = useState<Set<string>>(new Set())
  const [engine,      setEngine]      = useState<SchedulerEngineStatus>({ external: false })
  const [actionError, setActionError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [loaded,      setLoaded]      = useState(false)
  const lastStatuses = useRef(new Map<string, string | undefined>())

  const attempt = useCallback(async (action: () => Promise<unknown>) => {
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(errorMessage(err))
    }
  }, [])

  const load = useCallback(async () => {
    const [list, eng] = await Promise.all([window.api.scheduler.list(), window.api.scheduler.engineStatus()])
    setJobs(list)
    setEngine(eng)
  }, [])

  useEffect(() => {
    void attempt(load).finally(() => setLoaded(true))
    const off = window.api.scheduler.onChange((updated: ScheduledJob[]) => setJobs(updated))
    // The engine heartbeat can come and go while this page is open, and each job's next run moves on once it fires.
    const poll = setInterval(() => {
      void window.api.scheduler.engineStatus().then(setEngine).catch(() => {})
      void window.api.scheduler.list().then(setJobs).catch(() => {})
    }, 30_000)
    return () => { off(); clearInterval(poll) }
  }, [load, attempt])

  // Announce runs that finish while the page is open.
  useEffect(() => {
    const seen = lastStatuses.current
    for (const job of jobs) {
      const before = seen.get(job.id)
      if (before === 'running' && job.lastStatus !== 'running') {
        const run = job.history?.[0]
        setAnnouncement(`${job.name}: ${run ? describeRun(run) : 'finished'}`)
      }
      seen.set(job.id, job.lastStatus)
    }
  }, [jobs])

  async function runNow(id: string) {
    setStarting(prev => new Set(prev).add(id))
    await attempt(() => window.api.scheduler.runNow(id))
    setStarting(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  function moveJob(id: string, delta: -1 | 1) {
    const ids = jobs.map(j => j.id)
    const from = ids.indexOf(id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    void attempt(async () => setJobs(await window.api.scheduler.reorder(ids)))
  }

  return { jobs, starting, engine, actionError, setActionError, announcement, loaded, attempt, runNow, moveJob }
}
