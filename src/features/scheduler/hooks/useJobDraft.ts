import { useMemo, useState } from 'react'
import type { ArtworkType, ScheduledJob } from '../../../../electron/ipc/types'
import { analyzeUrls, cronToForm, formToCron, type ScheduleForm } from '../../../../electron/services/scheduleUtils'
import { useCronPreview } from './useCronPreview'

/**
 * The fields of the job being created or edited, and what they derive: the
 * cron expression and its preview, the parsed links, whether the job can be
 * saved, and whether anything changed since the form opened.
 *
 * @param initial - The job being edited, or undefined for a new one.
 * @returns The fields with their setters, `update` for the schedule, and the derived values.
 */
export function useJobDraft(initial?: ScheduledJob)
{
  const [name,        setName]        = useState(initial?.name ?? '')
  const [urls,        setUrls]        = useState((initial?.urls ?? []).join('\n'))
  const [schedule,    setSchedule]    = useState<ScheduleForm>(() => cronToForm(initial?.cronExpr ?? '0 3 * * *'))
  const [enabled,     setEnabled]     = useState(initial?.enabled ?? true)
  const [skipApplied, setSkipApplied] = useState(initial?.skipApplied !== false)
  const [fillGaps,    setFillGaps]    = useState(initial?.fillGaps === true)
  const [assetTypes,  setAssetTypes]  = useState<ArtworkType[] | undefined>(initial?.assetTypes)

  const cronExpr  = formToCron(schedule)
  const { preview, current } = useCronPreview(cronExpr)
  const urlInfo   = useMemo(() => analyzeUrls(urls), [urls])
  const cronError = current && preview && !preview.valid ? preview.error ?? 'This schedule is not valid' : null
  const valid     = name.trim().length > 0 && urlInfo.urls.length > 0 && urlInfo.unsupported.length === 0 && !cronError

  const snapshot = JSON.stringify({ name: name.trim(), urls: urlInfo.urls, cronExpr, enabled, skipApplied, fillGaps, assetTypes: assetTypes ?? null })
  const [initialSnapshot] = useState(snapshot)
  const dirty = snapshot !== initialSnapshot

  // The last run's error names the link it could not read.
  const lastRun = initial?.history?.[0]
  const failedLinks = lastRun?.error ? (initial?.urls ?? []).filter(u => lastRun.error!.includes(u)) : []

  const update = (patch: Partial<ScheduleForm>) => setSchedule(s => ({ ...s, ...patch }))

  return {
    name, setName, urls, setUrls, schedule, update, enabled, setEnabled, skipApplied, setSkipApplied, fillGaps, setFillGaps,
    assetTypes, setAssetTypes, cronExpr, preview, current, urlInfo, cronError, valid, dirty, lastRun, failedLinks,
  }
}

/** The job fields and derived values `useJobDraft` returns. */
export type JobDraft = ReturnType<typeof useJobDraft>
