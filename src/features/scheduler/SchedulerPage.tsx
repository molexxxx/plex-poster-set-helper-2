import { useEffect, useState, useCallback, useMemo, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, Play, Trash2, Clock, CheckCircle2, AlertCircle, AlertTriangle, Loader2, X, Save, Server,
  ArrowUp, ArrowDown, Hourglass, Square, CircleSlash, Pencil, ChevronDown, LibraryBig, Users,
} from 'lucide-react'
import Button from '../../components/ui/Button'
import Switch from '../../components/ui/Switch'
import Select from '../../components/ui/Select'
import Segmented from '../../components/ui/Segmented'
import Menu from '../../components/ui/Menu'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import ProgressBar from '../../components/ui/ProgressBar'
import type { ScheduledJob, SchedulerEngineStatus, CronPreview, JobRun } from '../../../electron/ipc/types'
import {
  HOUR_INTERVALS, analyzeUrls, creatorOfUrl, cronToForm, describeCron, describeProgress, describeRun, formToCron, relativeTime,
  type ScheduleForm, type SchedulePreset,
} from '../../../electron/services/scheduleUtils'
import { classifyUrl } from '../../../electron/scrapers/urlSource'
import { useNavStore } from '../../app/navStore'
import { useAppContext } from '../../app/AppContext'
import { uuid } from '../../utils/uuid'
import { errorMessage } from '../../utils/errorMessage'
import styles from './SchedulerPage.module.css'

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

/**
 * Formats a run time for display in the viewer's locale.
 *
 * @param iso - ISO timestamp.
 * @returns A label such as "Sun, Oct 11, 3:00 AM".
 */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** "1st", "2nd", "3rd", "4th". */
function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/**
 * Names what a job works on, in place of a URL count.
 *
 * @param job - The job.
 * @returns A label such as "@willtong93 · MediUX creator" or "2 sets · ThePosterDB and MediUX".
 */
function jobIdentity(job: ScheduledJob): string {
  const creators = [...new Set(job.urls.map(creatorOfUrl).filter((c): c is string => !!c))]
  if (job.creator && creators.length <= 1) return `@${job.creator} · MediUX creator`
  if (creators.length === 1 && job.urls.length === 1) return `@${creators[0]} · MediUX creator`
  const sites = [...new Set(job.urls.map(u => classifyUrl(u)).filter(s => s !== 'unknown'))]
    .map(s => (s === 'posterdb' ? 'ThePosterDB' : 'MediUX'))
  const n = job.urls.length
  return `${n} ${n === 1 ? 'set' : 'sets'}${sites.length ? ` · ${sites.join(' and ')}` : ''}`
}

/** Re-renders on an interval so relative times stay current. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * Asks the scheduler to evaluate an expression, debounced while the user types.
 *
 * @param expr - Cron expression.
 * @returns The latest preview, and whether it belongs to `expr` yet.
 */
function useCronPreview(expr: string): { preview: CronPreview | null; current: boolean } {
  const [result, setResult] = useState<{ expr: string; preview: CronPreview } | null>(null)
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      window.api.scheduler.preview(expr)
        .then(preview => { if (!cancelled) setResult({ expr, preview }) })
        .catch(() => { /* preview is advisory; the save call validates */ })
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [expr])
  return { preview: result?.preview ?? null, current: result?.expr === expr }
}

type RowStatus = JobRun['status'] | 'running' | 'queued' | 'paused'

/** Icon for a run or job status. */
function StatusIcon({ status, size = 13 }: { status?: RowStatus; size?: number }) {
  if (status === 'running') return <Loader2 size={size} className={styles.iconSpin} aria-hidden />
  if (status === 'queued') return <Hourglass size={size} className={styles.iconMuted} aria-hidden />
  if (status === 'paused') return <CircleSlash size={size} className={styles.iconMuted} aria-hidden />
  if (status === 'success') return <CheckCircle2 size={size} className={styles.iconSuccess} aria-hidden />
  if (status === 'partial') return <AlertTriangle size={size} className={styles.iconWarning} aria-hidden />
  if (status === 'error') return <AlertCircle size={size} className={styles.iconError} aria-hidden />
  if (status === 'stopped') return <Square size={size - 2} className={styles.iconMuted} aria-hidden />
  return null
}

const STATUS_LABEL: Record<Exclude<RowStatus, 'queued'>, string> = {
  running: 'Running', paused: 'Paused', success: 'Succeeded', partial: 'Partly failed', error: 'Failed', stopped: 'Stopped',
}

/** Moves Tab focus around inside a container instead of out of it. */
function trapTab(e: React.KeyboardEvent, container: HTMLElement | null) {
  if (e.key !== 'Tab' || !container) return
  const focusable = [...container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter(el => el.offsetParent !== null)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}

interface JobFormProps {
  initial?: ScheduledJob
  onSave:  (job: ScheduledJob, runAfterSave: boolean) => Promise<void>
  onClose: () => void
}

/** Dialog for creating or editing a scheduled job. */
function JobForm({ initial, onSave, onClose }: JobFormProps) {
  const [name,        setName]        = useState(initial?.name ?? '')
  const [urls,        setUrls]        = useState((initial?.urls ?? []).join('\n'))
  const [schedule,    setSchedule]    = useState<ScheduleForm>(() => cronToForm(initial?.cronExpr ?? '0 3 * * *'))
  const [enabled,     setEnabled]     = useState(initial?.enabled ?? true)
  const [skipApplied, setSkipApplied] = useState(initial?.skipApplied !== false)
  const [fillGaps,    setFillGaps]    = useState(initial?.fillGaps === true)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [dayHint,     setDayHint]     = useState(false)

  const ids = { title: useId(), name: useId(), urls: useId(), urlsHelp: useId(), schedule: useId(), every: useId(), minute: useId(), day: useId(), time: useId(), custom: useId(), customHelp: useId() }
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<Element | null>(null)
  const confirmOpenRef = useRef(false)
  useEffect(() => { confirmOpenRef.current = confirmDiscard }, [confirmDiscard])

  const cronExpr  = formToCron(schedule)
  const { preview, current } = useCronPreview(cronExpr)
  const urlInfo   = useMemo(() => analyzeUrls(urls), [urls])
  const cronError = current && preview && !preview.valid ? preview.error ?? 'This schedule is not valid' : null
  const valid     = name.trim().length > 0 && urlInfo.urls.length > 0 && urlInfo.unsupported.length === 0 && !cronError

  const snapshot = JSON.stringify({ name: name.trim(), urls: urlInfo.urls, cronExpr, enabled, skipApplied, fillGaps })
  const [initialSnapshot] = useState(snapshot)
  const dirty = snapshot !== initialSnapshot

  // The last run's error names the link it could not read.
  const lastRun = initial?.history?.[0]
  const failedLinks = lastRun?.error ? (initial?.urls ?? []).filter(u => lastRun.error!.includes(u)) : []

  const update = (patch: Partial<ScheduleForm>) => setSchedule(s => ({ ...s, ...patch }))

  useEffect(() => {
    openerRef.current = document.activeElement
    nameRef.current?.focus()
    return () => {
      const opener = openerRef.current
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [])

  const requestClose = useCallback(() => {
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }, [dirty, onClose])

  async function submit(runAfterSave: boolean) {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        ...initial,
        id: initial?.id ?? uuid(),
        name: name.trim(),
        urls: urlInfo.urls,
        cronExpr,
        enabled,
        skipApplied,
        fillGaps,
      }, runAfterSave)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  const submitRef = useRef(submit)
  useEffect(() => { submitRef.current = submit })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmOpenRef.current) return
      if (e.key === 'Escape') {
        if (dialogRef.current?.querySelector('[role="listbox"]')) return
        e.preventDefault()
        requestClose()
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        void submitRef.current(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  function toggleDay(i: number) {
    const days = schedule.days.includes(i) ? schedule.days.filter(d => d !== i) : [...schedule.days, i]
    setDayHint(days.length === 0)
    if (days.length) update({ days })
  }

  const timeInput = (
    <input
      id={ids.time}
      type="time"
      className={`${styles.input} ${styles.timeInput}`}
      value={`${pad2(schedule.hour)}:${pad2(schedule.minute)}`}
      onChange={e => {
        const [h, m] = e.target.value.split(':').map(Number)
        if (!Number.isNaN(h) && !Number.isNaN(m)) update({ hour: h, minute: m })
      }}
      required
    />
  )
  const minuteOptions = (MINUTE_STEPS.includes(schedule.minute) ? MINUTE_STEPS : [...MINUTE_STEPS, schedule.minute].sort((a, b) => a - b))
    .map(m => ({ value: String(m), label: `:${pad2(m)}` }))
  const otherTimeZone = preview && preview.timeZone !== BROWSER_TIME_ZONE ? preview.timeZone : null
  const downOnOverlay = useRef(false)

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={e => { downOnOverlay.current = e.target === e.currentTarget }}
      onClick={e => { if (downOnOverlay.current && e.target === e.currentTarget) requestClose() }}
    >
      <div
        ref={dialogRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        onKeyDown={e => trapTab(e, dialogRef.current)}
      >
        <div className={styles.drawerHeader}>
          <h2 id={ids.title} className={styles.drawerTitle}>{initial ? 'Edit job' : 'New job'}</h2>
          <Button variant="ghost" size="sm" icon={<X size={15} />} aria-label="Close" onClick={requestClose} />
        </div>

        <div className={styles.drawerBody}>
          <section className={styles.formSection}>
            <h3 className={styles.formHeading}>What it applies</h3>
            <div className={styles.field}>
              <label htmlFor={ids.name} className={styles.label}>Name</label>
              <input
                ref={nameRef}
                id={ids.name}
                className={styles.input}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="For example, Nightly poster sync"
                spellCheck={false}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor={ids.urls} className={styles.label}>Links</label>
              <p id={ids.urlsHelp} className={styles.help}>
                One per line: MediUX set, boxset, show, or creator pages, and ThePosterDB set or poster pages.
              </p>
              <textarea
                id={ids.urls}
                aria-describedby={ids.urlsHelp}
                aria-invalid={urlInfo.unsupported.length > 0 || undefined}
                className={`${styles.textarea} ${urlInfo.unsupported.length ? styles.inputInvalid : ''}`}
                value={urls}
                onChange={e => {
                  const v = e.target.value
                  setUrls(v)
                  // Keep an auto-generated "Sync @user (N sets)" name counting the list; a custom name does not match.
                  const setCount = v.split('\n').map(l => l.trim()).filter(u => /\/sets\/\d+/.test(u)).length
                  setName(prev => {
                    const m = prev.match(/^(Sync @\S+) \(\d+ sets?\)$/)
                    return m ? `${m[1]} (${setCount} ${setCount === 1 ? 'set' : 'sets'})` : prev
                  })
                }}
                placeholder={'https://mediux.pro/sets/...\nhttps://mediux.pro/user/<creator>/sets\nhttps://theposterdb.com/set/...'}
                rows={5}
                spellCheck={false}
              />
              {urlInfo.urls.length > 0 && (
                <span className={styles.help}>
                  {urlInfo.urls.length} {urlInfo.urls.length === 1 ? 'link' : 'links'}
                  {urlInfo.duplicates > 0 && ` · ${urlInfo.duplicates} duplicate${urlInfo.duplicates !== 1 ? 's' : ''} will be removed`}
                </span>
              )}
              {urlInfo.unsupported.length > 0 && (
                <p className={styles.fieldError} role="alert">
                  <AlertCircle size={13} aria-hidden />
                  <span>
                    Only theposterdb.com and mediux.pro links work here:{' '}
                    {urlInfo.unsupported.slice(0, 3).join(', ')}
                    {urlInfo.unsupported.length > 3 && ` and ${urlInfo.unsupported.length - 3} more`}
                  </span>
                </p>
              )}
              {failedLinks.length > 0 && (
                <p className={styles.fieldWarning}>
                  <AlertTriangle size={13} aria-hidden />
                  <span>The last run could not read {lastRun!.error}</span>
                </p>
              )}
            </div>
          </section>

          <section className={styles.formSection}>
            <h3 className={styles.formHeading} id={ids.schedule}>When it runs</h3>
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
                <span className={styles.help}>{dayHint ? 'At least one day stays selected.' : 'Pick one or more days.'}</span>
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
                  <span className={styles.help}>Months without a day {schedule.dayOfMonth} are skipped.</span>
                )}
              </>
            )}

            {schedule.preset === 'custom' && (
              <div className={styles.field}>
                <label htmlFor={ids.custom} className={styles.label}>Cron expression</label>
                <input
                  id={ids.custom}
                  aria-describedby={ids.customHelp}
                  aria-invalid={!!cronError || undefined}
                  className={`${styles.input} ${styles.mono} ${cronError ? styles.inputInvalid : ''}`}
                  value={schedule.custom}
                  onChange={e => update({ custom: e.target.value })}
                  placeholder="0 3 * * 0"
                  spellCheck={false}
                />
                <span id={ids.customHelp} className={styles.help}>Minute, hour, day of month, month, weekday</span>
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

          <section className={styles.formSection}>
            <h3 className={styles.formHeading}>How it applies</h3>
            <Switch
              label="Only apply new artwork"
              description="Skips posters already applied to an item, so Plex does not collect duplicate copies."
              checked={skipApplied}
              onChange={setSkipApplied}
            />
            <Switch
              label="Only fill gaps"
              description="Leaves any poster, season, or episode that other art already covers. Use it for a backup creator."
              checked={fillGaps}
              onChange={setFillGaps}
            />
          </section>
        </div>

        <div className={styles.drawerFooter}>
          {error && (
            <p className={styles.footerError} role="alert">
              <AlertCircle size={13} aria-hidden />
              <span>{error}</span>
            </p>
          )}
          <div className={styles.footerActions}>
            <Button variant="ghost" size="sm" onClick={requestClose}>Cancel</Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Play size={13} />}
              onClick={() => submit(true)}
              disabled={!valid || saving}
              title="Save, then run the job once now"
            >
              Save and run
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={13} />}
              onClick={() => submit(false)}
              disabled={!valid}
              loading={saving}
              title="Save (Ctrl+Enter)"
            >
              {initial ? 'Save changes' : 'Create job'}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard your changes?"
        body="The changes you made to this job are not saved yet."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={onClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>,
    document.body,
  )
}

/** One category of a run's per-title details. */
function DetailList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className={styles.detailGroup}>
      <span className={styles.detailLabel}>{label}</span>
      <ul className={styles.detailItems}>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}

/** One past run, with its error written out and its per-title details on request. */
function HistoryEntry({ run }: { run: JobRun }) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const summary = describeRun(run)
  const details = run.details
  const hasDetails = !!details && (details.applied.length + details.unmatched.length + details.failed.length
    + (details.covered?.length ?? 0) + (details.noTarget?.length ?? 0)) > 0
  return (
    <li className={styles.historyItem}>
      <div className={styles.historyHead}>
        <StatusIcon status={run.status} />
        <span className={styles.historyWhen}>{formatWhen(run.startedAt)}</span>
        <span className={styles.historyTrigger}>{run.trigger === 'manual' ? 'Started by you' : 'Scheduled'}</span>
      </div>
      <p className={styles.historySummary}>{summary}</p>
      {run.error && run.status !== 'stopped' && run.error !== summary && <p className={styles.errorLine}>{run.error}</p>}
      {hasDetails && (
        <>
          <button type="button" className={styles.linkButton} aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(v => !v)}>
            <ChevronDown size={13} className={open ? styles.chevronOpen : undefined} aria-hidden />
            {open ? 'Hide titles' : 'Show titles'}
          </button>
          {open && (
            <div id={detailsId} className={styles.runDetails}>
              {details!.applied.length > 0 && <DetailList label="Applied" items={details!.applied} />}
              {details!.failed.length > 0 && <DetailList label="Failed" items={details!.failed} />}
              {(details!.noTarget?.length ?? 0) > 0 && <DetailList label="No matching season or episode in Plex" items={details!.noTarget!} />}
              {(details!.covered?.length ?? 0) > 0 && <DetailList label="Left to other art" items={details!.covered!} />}
              {details!.unmatched.length > 0 && <DetailList label="Not in your library" items={details!.unmatched} />}
            </div>
          )}
        </>
      )}
    </li>
  )
}

/** Status shown for a job in the list and the detail header. */
function jobStatus(job: ScheduledJob, starting: boolean): RowStatus | undefined {
  if (starting || job.lastStatus === 'running') return 'running'
  if (job.queued) return 'queued'
  if (!job.enabled) return 'paused'
  return job.lastStatus as JobRun['status'] | undefined
}

/** Label for a status chip. */
function statusLabel(job: ScheduledJob, status: RowStatus): string {
  if (status !== 'queued') return STATUS_LABEL[status]
  return `Queued · ${job.queuePosition && job.queuePosition > 1 ? `${ordinal(job.queuePosition)} in line` : 'next'}`
}

/** A labeled block of rows in the detail pane, styled like a Settings group. */
function DetailBlock({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const titleId = useId()
  return (
    <section className={styles.block} aria-labelledby={titleId}>
      <div className={styles.blockHead}>
        <h3 id={titleId} className={styles.blockTitle}>{title}</h3>
        {action}
      </div>
      <div className={styles.panel}>{children}</div>
    </section>
  )
}

interface JobDetailProps {
  job:         ScheduledJob
  now:         number
  starting:    boolean
  canMoveUp:   boolean
  canMoveDown: boolean
  canStop:     boolean
  onEdit:      () => void
  onDelete:    () => void
  onToggle:    (enabled: boolean) => void
  onRunNow:    () => void
  onStop:      () => void
  onMove:      (delta: -1 | 1) => void
}

/** Everything about the selected job: status, actions, schedule, last result, links, options, and run history. */
function JobDetail({ job, now, starting, canMoveUp, canMoveDown, canStop, onEdit, onDelete, onToggle, onRunNow, onStop, onMove }: JobDetailProps) {
  const titleId = useId()
  const enabledLabelId = useId()
  const status = jobStatus(job, starting)
  const isRunning = status === 'running'
  const lastRun = job.history?.[0]
  const history = job.history ?? []
  const summary = lastRun ? describeRun(lastRun) : ''
  const lastError = lastRun && (lastRun.status === 'error' || lastRun.status === 'partial') ? lastRun.error ?? job.lastError : !lastRun && job.lastStatus === 'error' ? job.lastError : undefined

  return (
    <article className={styles.detail} aria-labelledby={titleId}>
      <header className={styles.detailHead}>
        <div className={styles.detailHeading}>
          <div className={styles.detailTitleLine}>
            <h2 id={titleId} className={styles.detailTitle}>{job.name}</h2>
            {status && (
              <span className={`${styles.chip} ${styles[`chip_${status}`] ?? ''}`}>
                <StatusIcon status={status} size={12} />
                {statusLabel(job, status)}
              </span>
            )}
          </div>
          <p className={styles.detailIdentity}>{jobIdentity(job)}</p>
        </div>
        <div className={styles.detailActions}>
          {isRunning ? (
            canStop
              ? <Button variant="secondary" size="sm" icon={<Square size={11} />} onClick={onStop}>Stop</Button>
              : <Button variant="secondary" size="sm" disabled>Running</Button>
          ) : job.queued ? (
            <Button variant="secondary" size="sm" onClick={onStop}>Take out of queue</Button>
          ) : (
            <Button variant="primary" size="sm" icon={<Play size={12} />} onClick={onRunNow}>Run now</Button>
          )}
          <Button variant="secondary" size="sm" icon={<Pencil size={12} />} onClick={onEdit}>Edit</Button>
          <Menu
            label={`More actions for ${job.name}`}
            items={[
              { label: 'Run earlier', icon: <ArrowUp size={14} />, disabled: !canMoveUp, onSelect: () => onMove(-1) },
              { label: 'Run later', icon: <ArrowDown size={14} />, disabled: !canMoveDown, onSelect: () => onMove(1) },
              { label: 'Delete…', icon: <Trash2 size={14} />, danger: true, onSelect: onDelete },
            ]}
          />
        </div>
      </header>

      {isRunning && job.progress && (
        <div className={styles.progressPanel}>
          <span className={styles.progressText}>{describeProgress(job.progress)}</span>
          {job.progress.phase === 'reading' || !job.progress.total
            ? <ProgressBar variant="indeterminate" size="sm" />
            : <ProgressBar value={job.progress.done} max={job.progress.total} size="sm" />}
        </div>
      )}

      <DetailBlock title="Schedule">
        <div className={styles.detailRow}>
          <div className={styles.detailRowText}>
            <span id={enabledLabelId} className={styles.detailRowLabel}>Run on schedule</span>
            <span className={styles.detailRowValue}>{job.enabled ? describeCron(job.cronExpr) : `Paused. When on: ${describeCron(job.cronExpr)}`}</span>
          </div>
          <Switch checked={job.enabled} onChange={onToggle} ariaLabelledBy={enabledLabelId} />
        </div>
        <div className={styles.detailRow}>
          <div className={styles.detailRowText}>
            <span className={styles.detailRowLabel}>Next run</span>
            <span className={styles.detailRowValue}>
              {job.enabled && job.nextRun ? `${formatWhen(job.nextRun)} (${relativeTime(job.nextRun, now)})` : 'Only when you start it'}
            </span>
          </div>
        </div>
      </DetailBlock>

      <DetailBlock title="Last run">
        <div className={styles.detailRow}>
          <div className={styles.detailRowText}>
            {lastRun ? (
              <>
                <span className={`${styles.detailRowLabel} ${styles.lastRunLabel}`}>
                  <StatusIcon status={lastRun.status} />
                  {formatWhen(lastRun.startedAt)} · {lastRun.trigger === 'manual' ? 'started by you' : 'scheduled'}
                </span>
                <span className={styles.lastResult}>{summary}</span>
                {lastError && lastError !== summary && <span className={styles.errorLine}>{lastError}</span>}
              </>
            ) : job.lastError ? (
              <span className={styles.errorLine}>{job.lastError}</span>
            ) : (
              <span className={styles.detailRowValue}>This job has not run yet.</span>
            )}
          </div>
        </div>
      </DetailBlock>

      <DetailBlock title={job.urls.length === 1 ? 'Link' : `Links (${job.urls.length})`}>
        <ul className={styles.linkList}>
          {job.urls.map(url => <li key={url} className={styles.linkItem}>{url}</li>)}
        </ul>
      </DetailBlock>

      <DetailBlock title="How it applies">
        {job.creator && (
          <div className={styles.detailRow}>
            <div className={styles.detailRowText}>
              <span className={styles.detailRowLabel}>Where it starts</span>
              <span className={styles.detailRowValue}>
                {job.since
                  ? `Sets @${job.creator} added or updated since ${new Date(job.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : `Every set in @${job.creator}'s catalog`}
              </span>
            </div>
          </div>
        )}
        <div className={styles.detailRow}>
          <div className={styles.detailRowText}>
            <span className={styles.detailRowLabel}>Only apply new artwork</span>
            <span className={styles.detailRowValue}>{job.skipApplied === false ? 'Off: re-applies the whole set every run' : 'On: skips posters already applied'}</span>
          </div>
        </div>
        <div className={styles.detailRow}>
          <div className={styles.detailRowText}>
            <span className={styles.detailRowLabel}>Only fill gaps</span>
            <span className={styles.detailRowValue}>{job.fillGaps ? 'On: leaves slots other art already covers' : 'Off'}</span>
          </div>
        </div>
      </DetailBlock>

      {history.length > 0 && (
        <DetailBlock title={`Recent runs (${history.length})`}>
          <ul className={styles.history} aria-label={`Recent runs of ${job.name}`}>
            {history.map(run => <HistoryEntry key={run.startedAt} run={run} />)}
          </ul>
        </DetailBlock>
      )}
    </article>
  )
}

/** First-run panel: what a job does, and the three ways to make one. */
function EmptyJobs({ onNew, onOpenCreators, onOpenLibrary }: { onNew: () => void; onOpenCreators: () => void; onOpenLibrary: () => void }) {
  const titleId = useId()
  return (
    <section className={styles.block} aria-labelledby={titleId}>
      <div className={styles.blockHead}>
        <h2 id={titleId} className={styles.blockTitle}>No scheduled jobs yet</h2>
      </div>
      <p className={styles.emptyIntro}>
        A job checks MediUX creators and sets, or ThePosterDB sets, on a schedule and applies their new art to Plex by itself.
      </p>
      <div className={styles.panel}>
        <div className={styles.detailRow}>
          <div className={styles.detailRowText}>
            <span className={styles.detailRowLabel}>Keep up with a creator</span>
            <span className={styles.detailRowValue}>Follow a MediUX creator in the Library Browser&apos;s Creators tab and use Sync. Their new uploads apply as they appear.</span>
          </div>
          <Button variant="secondary" size="sm" icon={<Users size={13} />} onClick={onOpenCreators}>Open Creators</Button>
        </div>
        <div className={styles.detailRow}>
          <div className={styles.detailRowText}>
            <span className={styles.detailRowLabel}>Keep one set current</span>
            <span className={styles.detailRowValue}>Open a title in the Library Browser and use Schedule on one of its sets.</span>
          </div>
          <Button variant="secondary" size="sm" icon={<LibraryBig size={13} />} onClick={onOpenLibrary}>Open the Library Browser</Button>
        </div>
        <div className={styles.detailRow}>
          <div className={styles.detailRowText}>
            <span className={styles.detailRowLabel}>Start from links</span>
            <span className={styles.detailRowValue}>Paste MediUX or ThePosterDB links and pick when the job runs.</span>
          </div>
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={onNew}>New job</Button>
        </div>
      </div>
    </section>
  )
}

/** Scheduler: a queue of jobs that apply MediUX and ThePosterDB art to Plex on a schedule, with the selected job beside it. */
export default function SchedulerPage() {
  const [jobs,        setJobs]        = useState<ScheduledJob[]>([])
  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [editing,     setEditing]     = useState<ScheduledJob | 'new' | null>(null)
  const [deleting,    setDeleting]    = useState<ScheduledJob | null>(null)
  const [starting,    setStarting]    = useState<Set<string>>(new Set())
  const [engine,      setEngine]      = useState<SchedulerEngineStatus>({ external: false })
  const [actionError, setActionError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [loaded,      setLoaded]      = useState(false)
  const now = useNow()
  const { navigate } = useAppContext()
  const goLibrary = useNavStore(s => s.goLibrary)
  const lastStatuses = useRef(new Map<string, string | undefined>())
  const listRef = useRef<HTMLDivElement>(null)

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

  const selected = jobs.find(j => j.id === selectedId) ?? jobs[0] ?? null

  /** Selects a job and brings it into view in the list. */
  const reveal = useCallback((id: string) => {
    setSelectedId(id)
    setTimeout(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-job-id="${id}"]`)
      if (!el) return
      el.scrollIntoView({ block: 'nearest' })
      el.focus()
      el.classList.add(styles.rowPulse)
      setTimeout(() => el.classList.remove(styles.rowPulse), 1600)
    }, 60)
  }, [])

  // Command-palette deep link: select the requested job.
  const schedulerJobId = useNavStore(s => s.schedulerJobId)
  const clearScheduler  = useNavStore(s => s.clearScheduler)
  useEffect(() => {
    if (!schedulerJobId || jobs.length === 0) return
    const id = schedulerJobId
    const t = setTimeout(() => { reveal(id); clearScheduler() }, 60)
    return () => clearTimeout(t)
  }, [schedulerJobId, jobs.length, clearScheduler, reveal])

  async function runNow(id: string) {
    setStarting(prev => new Set(prev).add(id))
    await attempt(() => window.api.scheduler.runNow(id))
    setStarting(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  async function saveJob(job: ScheduledJob, runAfterSave: boolean) {
    const saved = await window.api.scheduler.save(job)
    setEditing(null)
    setSelectedId(saved.id)
    if (runAfterSave) void runNow(saved.id)
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

  function confirmDelete() {
    const job = deleting
    setDeleting(null)
    if (job) void attempt(() => window.api.scheduler.delete(job.id))
  }

  function onListKey(e: React.KeyboardEvent) {
    if (!jobs.length || !selected) return
    const i = jobs.findIndex(j => j.id === selected.id)
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, jobs.length - 1)
      : e.key === 'ArrowUp' ? Math.max(i - 1, 0)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? jobs.length - 1
      : -1
    if (next < 0) return
    e.preventDefault()
    const id = jobs[next].id
    setSelectedId(id)
    listRef.current?.querySelector<HTMLElement>(`[data-job-id="${id}"]`)?.focus()
  }

  const closeEditor  = useCallback(() => setEditing(null), [])
  const troubled     = jobs.filter(j => j.enabled && (j.lastStatus === 'error' || j.lastStatus === 'partial'))
  const selectedIndex = selected ? jobs.findIndex(j => j.id === selected.id) : -1

  const notices = (
    <>
      {engine.external && (
        <div className={styles.infoNotice}>
          <Server size={14} aria-hidden />
          <span>A 24/7 scheduler elsewhere runs these jobs, even when this app is closed. Changes here reach it automatically.</span>
        </div>
      )}

      {actionError && (
        <div className={styles.errorNotice} role="alert">
          <AlertCircle size={14} aria-hidden />
          <span>{actionError}</span>
          <Button variant="ghost" size="sm" icon={<X size={13} />} aria-label="Dismiss" onClick={() => setActionError(null)} />
        </div>
      )}
    </>
  )

  return (
    <div className={styles.page}>
      {loaded && jobs.length === 0 && (
        <div className={styles.emptyPage}>
          <header>
            <h1 className="page-title">Scheduler</h1>
            <p className="page-subtitle">Applies new art from MediUX and ThePosterDB to Plex on a schedule.</p>
          </header>
          {notices}
          <EmptyJobs
            onNew={() => setEditing('new')}
            onOpenCreators={() => { goLibrary({ creators: true }); navigate('library') }}
            onOpenLibrary={() => navigate('library')}
          />
        </div>
      )}

      {jobs.length > 0 && (
        <div className={styles.layout}>
          <aside className={styles.sidebar} aria-label="Jobs">
            <div className={styles.sidebarHead}>
              <div>
                <h1 className="page-title">Scheduler</h1>
                <p className="page-subtitle">Jobs run one at a time, top to bottom.</p>
              </div>
              <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setEditing('new')}>New job</Button>
            </div>

            {troubled.length > 0 && (
              <div className={styles.warnNotice}>
                <AlertTriangle size={14} aria-hidden />
                <span>
                  {troubled.length === 1 ? 'One job' : `${troubled.length} jobs`} had problems on the last run:{' '}
                  {troubled.map((job, i) => (
                    <span key={job.id}>
                      {i > 0 && ', '}
                      <button type="button" className={styles.inlineLink} onClick={() => reveal(job.id)}>{job.name}</button>
                    </span>
                  ))}
                  .
                </span>
              </div>
            )}

            <div ref={listRef} className={styles.jobList} role="listbox" aria-label="Scheduled jobs, in run order" onKeyDown={onListKey}>
              {jobs.map((job, index) => {
                const status = jobStatus(job, starting.has(job.id))
                const isSelected = selected?.id === job.id
                const timing = status === 'running' ? 'Running now'
                  : job.enabled && job.nextRun ? `Next ${relativeTime(job.nextRun, now)}`
                  : 'Paused'
                return (
                  <div
                    key={job.id}
                    data-job-id={job.id}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    className={`${styles.jobItem} ${isSelected ? styles.jobItemSelected : ''} ${!job.enabled ? styles.jobItemPaused : ''}`}
                    onClick={() => setSelectedId(job.id)}
                  >
                    <span className={styles.order} aria-hidden>{index + 1}</span>
                    <span className={styles.jobItemText}>
                      <span className={styles.jobItemName}>{job.name}</span>
                      <span className={styles.jobItemSub}>{describeCron(job.cronExpr)} · {timing}</span>
                    </span>
                    {status && (
                      <span className={styles.jobItemStatus} title={statusLabel(job, status)}>
                        <StatusIcon status={status} size={14} />
                        <span className={styles.srOnly}>{statusLabel(job, status)}</span>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </aside>

          <div className={styles.main}>
            {notices}

            {selected && (
              <JobDetail
                key={selected.id}
                job={selected}
                now={now}
                starting={starting.has(selected.id)}
                canMoveUp={selectedIndex > 0}
                canMoveDown={selectedIndex < jobs.length - 1}
                canStop={!engine.external}
                onEdit={() => setEditing(selected)}
                onDelete={() => setDeleting(selected)}
                onToggle={enabled => void attempt(() => window.api.scheduler.save({ ...selected, enabled }))}
                onRunNow={() => void runNow(selected.id)}
                onStop={() => void attempt(() => window.api.scheduler.stop(selected.id))}
                onMove={delta => moveJob(selected.id, delta)}
              />
            )}
          </div>
        </div>
      )}

      {editing !== null && (
        <JobForm
          initial={editing === 'new' ? undefined : editing}
          onSave={saveJob}
          onClose={closeEditor}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete "${deleting?.name ?? ''}"?`}
        body="The job and its run history are removed. Art it already applied stays in Plex."
        confirmLabel="Delete job"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      <p className={styles.srOnly} aria-live="polite">{announcement}</p>
    </div>
  )
}
