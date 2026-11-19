import { useId, useState } from 'react'
import { Clock, AlertCircle } from 'lucide-react'
import Switch from '../../../../components/ui/Switch'
import Select from '../../../../components/ui/Select'
import Segmented from '../../../../components/ui/Segmented'
import { HOUR_INTERVALS, describeCron, relativeTime, type SchedulePreset } from '../../../../../electron/services/scheduleUtils'
import { formatWhen } from '../../schedulerFormat'
import type { JobDraft } from '../../hooks/useJobDraft'
import form from './form.module.css'
import styles from './ScheduleSection.module.css'
const PRESETS: Array<{ value: SchedulePreset; label: string }> = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) => i * 5)
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1)
const BROWSER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

const pad2 = (n: number) => String(n).padStart(2, '0')

/** "When it runs": the preset picker and its time fields or a cron expression, the upcoming runs, and the on-schedule switch. */
export default function ScheduleSection({ draft }: { draft: JobDraft })
{
  const { schedule, update, cronExpr, preview, current, cronError, enabled, setEnabled } = draft
  const [dayHint, setDayHint] = useState(false)
  const ids = { schedule: useId(), every: useId(), minute: useId(), day: useId(), time: useId(), custom: useId(), customHelp: useId() }
  function toggleDay(i: number)
  {
    const days = schedule.days.includes(i) ? schedule.days.filter(d => d !== i) : [...schedule.days, i]
    setDayHint(days.length === 0)
    if (days.length) update({ days })
  }

  const timeInput = (
    <input
      id={ids.time}
      type="time"
      className={`${form.input} ${form.timeInput}`}
      value={`${pad2(schedule.hour)}:${pad2(schedule.minute)}`}
      onChange={e =>
      {
        const [h, m] = e.target.value.split(':').map(Number)
        if (!Number.isNaN(h) && !Number.isNaN(m)) update({ hour: h, minute: m })
      }}
      required
    />
  )
  const minuteOptions = (MINUTE_STEPS.includes(schedule.minute) ? MINUTE_STEPS : [...MINUTE_STEPS, schedule.minute].sort((a, b) => a - b))
    .map(m => ({ value: String(m), label: `:${pad2(m)}` }))
  const otherTimeZone = preview && preview.timeZone !== BROWSER_TIME_ZONE ? preview.timeZone : null

  return (
    <section className={form.formSection}>
      <h3 className={form.formHeading} id={ids.schedule}>When it runs</h3>
      <Segmented
        options={PRESETS}
        value={schedule.preset}
        onChange={preset => update({ preset, custom: schedule.preset === 'custom' ? schedule.custom : cronExpr })}
        ariaLabelledBy={ids.schedule}
      />

      {schedule.preset === 'hourly' && (
        <div className={styles.timeRow}>
          <span id={ids.every} className={styles.timeLabel}>Every</span>
          <div className={styles.selectSmall}>
            <Select
              options={HOUR_INTERVALS.map(h => ({ value: String(h), label: h === 1 ? 'hour' : `${h} hours` }))}
              value={String(schedule.everyHours)}
              onChange={v => update({ everyHours: Number(v) })}
              ariaLabelledBy={ids.every}
            />
          </div>
          <span id={ids.minute} className={styles.timeLabel}>at minute</span>
          <div className={styles.selectSmall}>
            <Select options={minuteOptions} value={String(schedule.minute)} onChange={v => update({ minute: Number(v) })} ariaLabelledBy={ids.minute} />
          </div>
        </div>
      )}

      {schedule.preset === 'daily' && (
        <div className={styles.timeRow}>
          <label htmlFor={ids.time} className={styles.timeLabel}>At</label>
          {timeInput}
        </div>
      )}

      {schedule.preset === 'weekly' && (
        <>
          <div className={styles.dayRow} role="group" aria-label="Days of the week">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                className={`${styles.dayBtn} ${schedule.days.includes(i) ? styles.dayActive : ''}`}
                onClick={() => toggleDay(i)}
                aria-pressed={schedule.days.includes(i)}
                aria-label={DAY_NAMES[i]}
              >{d}</button>
            ))}
          </div>
          <span className={form.help}>{dayHint ? 'At least one day stays selected.' : 'Pick one or more days.'}</span>
          <div className={styles.timeRow}>
            <label htmlFor={ids.time} className={styles.timeLabel}>At</label>
            {timeInput}
          </div>
        </>
      )}

      {schedule.preset === 'monthly' && (
        <>
          <div className={styles.timeRow}>
            <span id={ids.day} className={styles.timeLabel}>On day</span>
            <div className={styles.selectSmall}>
              <Select
                options={DAYS_OF_MONTH.map(d => ({ value: String(d), label: String(d) }))}
                value={String(schedule.dayOfMonth)}
                onChange={v => update({ dayOfMonth: Number(v) })}
                ariaLabelledBy={ids.day}
              />
            </div>
            <label htmlFor={ids.time} className={styles.timeLabel}>at</label>
            {timeInput}
          </div>
          {schedule.dayOfMonth > 28 && (
            <span className={form.help}>Months without a day {schedule.dayOfMonth} are skipped.</span>
          )}
        </>
      )}

      {schedule.preset === 'custom' && (
        <div className={form.field}>
          <label htmlFor={ids.custom} className={form.label}>Cron expression</label>
          <input
            id={ids.custom}
            aria-describedby={ids.customHelp}
            aria-invalid={!!cronError || undefined}
            className={`${form.input} ${form.mono} ${cronError ? form.inputInvalid : ''}`}
            value={schedule.custom}
            onChange={e => update({ custom: e.target.value })}
            placeholder="0 3 * * 0"
            spellCheck={false}
          />
          <span id={ids.customHelp} className={form.help}>Minute, hour, day of month, month, weekday</span>
        </div>
      )}

      {cronError ? (
        <p className={`${styles.cronPreview} ${styles.cronPreviewError}`} role="alert">
          <AlertCircle size={13} aria-hidden />
          <span>{cronError}</span>
        </p>
      ) : (
        <div className={styles.cronPreview} aria-live="polite">
          <p className={styles.cronPreviewTitle}><Clock size={13} aria-hidden /> {describeCron(cronExpr)}</p>
          {preview?.valid && preview.nextRuns.length > 0 && (
            <p className={`${styles.cronPreviewRuns} ${current ? '' : styles.stale}`}>
              Next: {formatWhen(preview.nextRuns[0])} ({relativeTime(preview.nextRuns[0])})
              {preview.nextRuns.length > 1 && `, then ${preview.nextRuns.slice(1).map(formatWhen).join(' and ')}`}
            </p>
          )}
          {otherTimeZone && (
            <p className={styles.cronPreviewRuns}>
              The time runs on the server&apos;s clock ({otherTimeZone}); upcoming runs are shown in your time zone.
            </p>
          )}
        </div>
      )}

      <Switch
        label="Run on schedule"
        description="Turned off, the job is kept but only runs when you start it."
        checked={enabled}
        onChange={setEnabled}
      />
    </section>
  )
}
