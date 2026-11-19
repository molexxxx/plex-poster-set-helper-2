import { useEffect, useMemo, useState } from 'react'
import type { ScheduledJob } from '../../../../../electron/ipc/types'
import { DEFAULT_QUICK_CRON } from '../../../../../electron/services/schedule/quickSync'
import { scheduleCoverage } from '../../../../../electron/services/schedule/coverage'
import { ALL_TYPES, type FileType } from '../../../../utils/posterGroups'
import { loadAppliedIndex, type AppliedIndex } from '../../../../utils/appliedTracker'
const EMPTY_INDEX: AppliedIndex = { setKeys: new Set(), titles: new Set(), posterUrls: new Set(), currentByItem: new Map(), currentPosterUrls: new Set() }

/**
 * What the Creators view reads once for every catalog: the applied-art index,
 * the scheduled jobs (kept current), the quick-sync schedule, and the artwork
 * types from Settings.
 *
 * @returns The applied index and its setter, the jobs and what they cover, the
 *   quick-sync schedule, and the types Apply uses with the Settings types.
 */
export function useCreatorsData()
{
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>(EMPTY_INDEX)
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [quickCron, setQuickCron] = useState(DEFAULT_QUICK_CRON)
  const [types, setTypes] = useState<Set<FileType>>(new Set(ALL_TYPES))
  const [settingsTypes, setSettingsTypes] = useState<FileType[]>(ALL_TYPES)
  const coverage = useMemo(() => scheduleCoverage(jobs), [jobs])

  useEffect(() => { void loadAppliedIndex().then(setAppliedIdx) }, [])
  useEffect(() =>
  {
    window.api.config.get().then(c =>
    {
      if (c.mediuxFilters?.length) setTypes(new Set(c.mediuxFilters as FileType[]))
      if (c.mediuxFilters) setSettingsTypes(c.mediuxFilters)
      setQuickCron(c.schedulerQuickCron || DEFAULT_QUICK_CRON)
    }).catch(() => { /* keep the defaults */ })
    window.api.scheduler.list().then(setJobs).catch(() => { /* scheduler unavailable */ })
    return window.api.scheduler.onChange(setJobs)
  }, [])

  return { appliedIdx, setAppliedIdx, jobs, quickCron, types, setTypes, settingsTypes, coverage }
}
