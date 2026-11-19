import { useEffect, useMemo, useState } from 'react'
import type { LibraryItem, PosterSetSummary, ScheduledJob } from '../../../../../electron/ipc/types'
import { setKey, type FileType } from '../../../../utils/posterGroups'
import { uuid } from '../../../../utils/uuid'
import { errorMessage } from '../../../../utils/errorMessage'
import { artworkOverride } from '../../../../../electron/services/schedule/artworkTypes'
import { planQuickSync } from '../../../../../electron/services/schedule/quickSync'
import { scheduleCoverage } from '../../../../../electron/services/schedule/coverage'
import { useAppContext } from '../../../../app/AppContext'
import { useNavStore } from '../../../../app/navStore'

/**
 * Scheduling sets from the panel: the jobs (kept current) and what they
 * cover, creating a job for one set, and opening the job that covers it.
 *
 * @param item - The title the panel shows, which names a new job.
 * @param types - The artwork types picked in the panel.
 * @param settingsTypes - The types from Settings; a new job keeps its own only when they differ.
 * @param quickCron - The schedule a new job gets.
 * @returns What the jobs cover, the set being scheduled, the last error, and the actions.
 */
export function useSetSchedule(item: LibraryItem, types: Set<FileType>, settingsTypes: FileType[], quickCron: string)
{
  const [schedJobs, setSchedJobs] = useState<ScheduledJob[]>([])
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<{ setId: string; message: string } | null>(null)
  const coverage = useMemo(() => scheduleCoverage(schedJobs), [schedJobs])
  const { navigate } = useAppContext()
  const goScheduler = useNavStore(s => s.goScheduler)

  // Scheduled jobs, kept live so the Scheduled tags follow edits made elsewhere.
  useEffect(() =>
  {
    window.api.scheduler.list().then(setSchedJobs).catch(() => { /* scheduler unavailable */ })
    return window.api.scheduler.onChange(setSchedJobs)
  }, [])

  // Schedule a single set straight from the library, reusing any job that
  // already covers it (the set itself or, for MediUX, a whole-creator sync).
  async function scheduleSet(s: PosterSetSummary)
  {
    if (schedulingId) return
    const sKey = setKey(s)
    setSchedulingId(sKey)
    setScheduleError(null)
    try
    {
      const plan = planQuickSync(await window.api.scheduler.list(), {
        urls: [s.setUrl ?? `https://mediux.pro/sets/${s.id}`],
        name: `${item.title}${item.year ? ` (${item.year})` : ''} - ${s.setName}`,
        cronExpr: quickCron,
        // Creator-wide syncs are MediUX feeds; a ThePosterDB uploader has none.
        creator: s.source === 'mediux' ? s.uploader : undefined,
        assetTypes: artworkOverride(types, settingsTypes),
      }, uuid)
      if (plan.kind !== 'exists') await window.api.scheduler.save(plan.job)
      setSchedJobs(await window.api.scheduler.list())
    }
    catch (err)
    {
      setScheduleError({ setId: sKey, message: errorMessage(err) })
    }
    finally
    {
      setSchedulingId(null)
    }
  }

  function openScheduledJob(jobId: string)
  {
    goScheduler(jobId)
    navigate('scheduler')
  }

  return { coverage, schedulingId, setSchedulingId, scheduleError, scheduleSet, openScheduledJob }
}
