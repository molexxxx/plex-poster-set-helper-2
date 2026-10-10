import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CalendarClock, Plus, Play, Trash2, ToggleLeft, ToggleRight, Clock, CheckCircle2, AlertCircle,
  AlertTriangle, Loader2, Pencil, X, Save, Power, Server, History, Zap, ArrowUp, ArrowDown, Hourglass,
} from 'lucide-react'
import Button from '../../components/ui/Button'
import Switch from '../../components/ui/Switch'
import EmptyState from '../../components/ui/EmptyState'
import Spinner from '../../components/ui/Spinner'
import type { ScheduledJob, SchedulerEngineStatus, AppEnv, CronPreview, JobRun } from '../../../electron/ipc/types'
import {
  DEFAULT_QUICK_CRON, HOUR_INTERVALS, analyzeUrls, cronToForm, describeCron, describeRun, formToCron, relativeTime,
  type ScheduleForm, type SchedulePreset,
} from '../../../electron/services/scheduleUtils'
import { useNavStore } from '../../app/navStore'
import { uuid } from '../../utils/uuid'
import { errorMessage } from '../../utils/errorMessage'
import styles from './SchedulerPage.module.css'

const PRESETS: Array<{ id: SchedulePreset; label: string }> = [
  { id: 'hourly', label: 'Hourly' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'custom', label: 'Custom' },
]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) => i * 5)
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1)
const QUICK_SCHEDULES = ['0 3 * * *', '0 3 * * 0', '0 9 * * 1', '0 */12 * * *', '0 3 1 * *']
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

type CardStatus = JobRun['status'] | 'running' | 'queued'

/** Icon for a run or job status. */
function StatusIcon({ status, size = 12 }: { status?: CardStatus; size?: number }) {
  if (status === 'running') return <Loader2 size={size} className={styles.iconSpin} />
  if (status === 'queued') return <Hourglass size={size} className={styles.iconMuted} />
  if (status === 'success') return <CheckCircle2 size={size} className={styles.iconSuccess} />
  if (status === 'partial') return <AlertTriangle size={size} className={styles.iconWarning} />
  if (status === 'error') return <AlertCircle size={size} className={styles.iconError} />
  return null
}

const STATUS_LABEL: Record<CardStatus, string> = {
  running: 'Running', queued: 'Queued', success: 'Succeeded', partial: 'Partly failed', error: 'Failed',
}

/**
 * Describes where a running job is.
 *
 * @param p - The job's progress.
 * @returns A label such as "Reading @creator's sets · 312 found".
 */
function progressLabel(p: NonNullable<ScheduledJob['progress']>): string {
  if (p.phase === 'reading') {
    return `Reading ${p.current ?? 'the creator'}'s sets${p.done ? ` · ${p.done.toLocaleString()} found` : ''}`
  }
  const position = p.total ? ` · ${Math.min(p.done + 1, p.total).toLocaleString()} of ${p.total.toLocaleString()}` : ''
  return `${p.current ?? 'Applying'}${position}`
}


interface JobFormProps {
  initial?: ScheduledJob
  onSave:  (job: ScheduledJob, runAfterSave: boolean) => Promise<void>
  onClose: () => void
}

/** Drawer form for creating or editing a scheduled job. */
function JobForm({ initial, onSave, onClose }: JobFormProps) {
  const [name,        setName]        = useState(initial?.name ?? '')
  const [urls,        setUrls]        = useState((initial?.urls ?? []).join('\n'))
  const [schedule,    setSchedule]    = useState<ScheduleForm>(() => cronToForm(initial?.cronExpr ?? '0 3 * * *'))
  const [enabled,     setEnabled]     = useState(initial?.enabled ?? true)
  const [skipApplied, setSkipApplied] = useState(initial?.skipApplied !== false)
  const [fillGaps,    setFillGaps]    = useState(initial?.fillGaps === true)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const cronExpr  = formToCron(schedule)
  const { preview, current } = useCronPreview(cronExpr)
  const urlInfo   = useMemo(() => analyzeUrls(urls), [urls])
  const cronError = current && preview && !preview.valid ? preview.error ?? 'This schedule is not valid' : null
  const valid     = name.trim().length > 0 && urlInfo.urls.length > 0 && urlInfo.unsupported.length === 0 && !cronError

  const update = (patch: Partial<ScheduleForm>) => setSchedule(s => ({ ...s, ...patch }))

  // Only close on a true backdrop click - not when a text-selection drag that
  // started inside the drawer happens to release over the overlay.
  const downOnOverlay = useRef(false)

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
      if (e.key === 'Escape') onClose()
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submitRef.current(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggleDay(i: number) {
    const days = schedule.days.includes(i) ? schedule.days.filter(d => d !== i) : [...schedule.days, i]
    if (days.length) update({ days })
  }

  const timeInput = (
    <input
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
  const minuteOptions = MINUTE_STEPS.includes(schedule.minute) ? MINUTE_STEPS : [...MINUTE_STEPS, schedule.minute].sort((a, b) => a - b)
  const otherTimeZone = preview && preview.timeZone !== BROWSER_TIME_ZONE ? preview.timeZone : null

  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseDown={e => { downOnOverlay.current = e.target === e.currentTarget }}
      onClick={e => { if (downOnOverlay.current && e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        className={styles.drawer}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.28 }}
        role="dialog"
        aria-label={initial ? 'Edit job' : 'New scheduled job'}
      >
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>{initial ? 'Edit Job' : 'New Scheduled Job'}</span>
          <button className={styles.drawerClose} onClick={onClose} title="Close (Esc)"><X size={14} /></button>
        </div>

        <div className={styles.drawerBody}>
          <div className={styles.field}>
            <label className={styles.label}>Job name</label>
            <input
              className={styles.input}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Nightly poster sync"
              spellCheck={false}
              autoFocus={!initial}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              URLs
              <span className={styles.labelMeta}>one per line</span>
            </label>
            <textarea
              className={`${styles.textarea} ${urlInfo.unsupported.length ? styles.inputInvalid : ''}`}
              value={urls}
              onChange={e => {
                const v = e.target.value
                setUrls(v)
                // Keep the auto-generated "Sync @user (N sets)" count in sync with
                // the URL list - but only if the name is still that default form
                // (a custom name won't match the pattern, so it's left untouched).
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
              <span className={styles.fieldMeta}>
                {urlInfo.urls.length} URL{urlInfo.urls.length !== 1 ? 's' : ''}
                {urlInfo.duplicates > 0 && ` · ${urlInfo.duplicates} duplicate${urlInfo.duplicates !== 1 ? 's' : ''} will be removed`}
              </span>
            )}
            {urlInfo.unsupported.length > 0 && (
              <div className={styles.fieldError}>
                <AlertCircle size={11} />
                <span>
                  Only theposterdb.com and mediux.pro links are supported:{' '}
                  {urlInfo.unsupported.slice(0, 3).join(', ')}
                  {urlInfo.unsupported.length > 3 && ` and ${urlInfo.unsupported.length - 3} more`}
                </span>
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Schedule</label>
            <div className={styles.presets}>
              {PRESETS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={`${styles.presetBtn} ${schedule.preset === p.id ? styles.presetActive : ''}`}
                  onClick={() => update({ preset: p.id, custom: schedule.preset === 'custom' ? schedule.custom : cronExpr })}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {schedule.preset === 'hourly' && (
              <div className={styles.timeRow}>
                <span className={styles.timeLabel}>Every</span>
                <select className={styles.select} value={schedule.everyHours} onChange={e => update({ everyHours: Number(e.target.value) })}>
                  {HOUR_INTERVALS.map(h => <option key={h} value={h}>{h === 1 ? 'hour' : `${h} hours`}</option>)}
                </select>
                <span className={styles.timeLabel}>at minute</span>
                <select className={styles.select} value={schedule.minute} onChange={e => update({ minute: Number(e.target.value) })}>
                  {minuteOptions.map(m => <option key={m} value={m}>:{pad2(m)}</option>)}
                </select>
              </div>
            )}

            {schedule.preset === 'daily' && (
              <div className={styles.timeRow}>
                <span className={styles.timeLabel}>At</span>
                {timeInput}
              </div>
            )}

            {schedule.preset === 'weekly' && (
              <div className={styles.timePicker}>
                <div className={styles.dayRow}>
                  {DAYS.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      className={`${styles.dayBtn} ${schedule.days.includes(i) ? styles.dayActive : ''}`}
                      onClick={() => toggleDay(i)}
                      aria-pressed={schedule.days.includes(i)}
                    >{d}</button>
                  ))}
                </div>
                <div className={styles.timeRow}>
                  <span className={styles.timeLabel}>At</span>
                  {timeInput}
                  <span className={styles.fieldMeta}>Pick one or more days</span>
                </div>
              </div>
            )}

            {schedule.preset === 'monthly' && (
              <div className={styles.timePicker}>
                <div className={styles.timeRow}>
                  <span className={styles.timeLabel}>On day</span>
                  <select className={styles.select} value={schedule.dayOfMonth} onChange={e => update({ dayOfMonth: Number(e.target.value) })}>
                    {DAYS_OF_MONTH.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <span className={styles.timeLabel}>at</span>
                  {timeInput}
                </div>
                {schedule.dayOfMonth > 28 && (
                  <span className={styles.fieldMeta}>Months without a day {schedule.dayOfMonth} are skipped.</span>
                )}
              </div>
            )}

            {schedule.preset === 'custom' && (
              <div className={styles.customRow}>
                <input
                  className={`${styles.input} ${styles.mono} ${cronError ? styles.inputInvalid : ''}`}
                  value={schedule.custom}
                  onChange={e => update({ custom: e.target.value })}
                  placeholder="0 3 * * 0"
                  spellCheck={false}
                />
                <span className={styles.fieldMeta}>minute · hour · day of month · month · weekday</span>
              </div>
            )}

            {cronError ? (
              <div className={`${styles.cronPreview} ${styles.cronPreviewError}`}>
                <AlertCircle size={11} />
                <span>{cronError}</span>
              </div>
            ) : (
              <div className={styles.cronPreview}>
                <div className={styles.cronPreviewRow}>
                  <Clock size={11} />
                  <span className={styles.cronPreviewTitle}>{describeCron(cronExpr)}</span>
                </div>
                {preview?.valid && preview.nextRuns.length > 0 && (
                  <div className={`${styles.cronPreviewRuns} ${current ? '' : styles.stale}`}>
                    Next: {formatWhen(preview.nextRuns[0])} ({relativeTime(preview.nextRuns[0])})
                    {preview.nextRuns.length > 1 && `, then ${preview.nextRuns.slice(1).map(formatWhen).join(' and ')}`}
                  </div>
                )}
                {otherTimeZone && (
                  <div className={styles.cronPreviewRuns}>
                    The time you pick runs on the server&apos;s clock ({otherTimeZone}); upcoming runs are shown in your time zone.
                  </div>
                )}
              </div>
            )}
          </div>

          <Switch
            label="Only apply new artwork"
            description="Skips posters already applied to an item, so each run only adds new uploads and Plex doesn't pile up duplicate copies. Turn off to re-apply the full set every run."
            checked={skipApplied}
            onChange={setSkipApplied}
          />

          <Switch
            label="Only fill gaps"
            description="Leaves any poster, season, or episode that other art already covers, whether from another job or applied by hand. Use this for a backup creator that should only add what your main creator is missing."
            checked={fillGaps}
            onChange={setFillGaps}
          />

          <Switch
            label="Enable this job"
            description="Disabled jobs are saved but won't run on schedule."
            checked={enabled}
            onChange={setEnabled}
          />
        </div>

        <div className={styles.drawerFooter}>
          {error && (
            <div className={styles.footerError} role="alert">
              <AlertCircle size={12} />
              <span>{error}</span>
            </div>
          )}
          <div className={styles.footerActions}>
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Play size={12} />}
              onClick={() => submit(true)}
              disabled={!valid || saving}
              title="Save, then run the job once right away"
            >
              Save &amp; run
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
              {initial ? 'Save Changes' : 'Create Job'}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
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


interface JobCardProps {
  job:        ScheduledJob
  now:        number
  starting:   boolean
  canMoveUp:  boolean
  canMoveDown: boolean
  onEdit:     () => void
  onDelete:   () => void
  onToggle:   () => void
  onRunNow:   () => void
  onMove:     (delta: -1 | 1) => void
}

/** Card for one scheduled job with its status, progress, last result, history, and actions. */
function JobCard({ job, now, starting, canMoveUp, canMoveDown, onEdit, onDelete, onToggle, onRunNow, onMove }: JobCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showHistory,   setShowHistory]   = useState(false)
  const [openRun,       setOpenRun]       = useState<string | null>(null)

  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), 4000)
    return () => clearTimeout(t)
  }, [confirmDelete])

  const isRunning = starting || job.lastStatus === 'running'
  const status: CardStatus | undefined = isRunning ? 'running' : job.queued ? 'queued' : job.lastStatus
  const lastRun   = job.history?.[0]
  const history   = job.history ?? []
  const hasDetails = (run: JobRun) => !!run.details && (
    run.details.applied.length + run.details.unmatched.length + run.details.failed.length
    + (run.details.covered?.length ?? 0) + (run.details.noTarget?.length ?? 0)) > 0

  return (
    <div className={`${styles.card} ${!job.enabled ? styles.cardOff : ''}`} data-job-id={job.id}>
      <div className={styles.cardMain}>
        <div className={styles.cardLeft}>
          <button
            className={`${styles.toggle} ${job.enabled ? styles.toggleOn : ''}`}
            onClick={onToggle}
            title={job.enabled ? 'Disable' : 'Enable'}
            aria-pressed={job.enabled}
          >
            {job.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
          </button>

          <div className={styles.cardInfo}>
            <div className={styles.cardNameRow}>
              <span className={styles.cardName} title={job.name}>{job.name}</span>
              {status && (
                <span className={`${styles.statusChip} ${styles[`status_${status}`] ?? ''}`}>
                  <StatusIcon status={status} size={11} />
                  {STATUS_LABEL[status]}
                </span>
              )}
            </div>
            <span className={styles.cardSchedule}>{describeCron(job.cronExpr)}</span>
            <div className={styles.cardMeta}>
              <span>{job.urls.length} URL{job.urls.length !== 1 ? 's' : ''}</span>
              {job.enabled && job.nextRun && (
                <><span className={styles.dot} /><span title={formatWhen(job.nextRun)}>next {relativeTime(job.nextRun, now)}</span></>
              )}
              {!job.enabled && <><span className={styles.dot} /><span>paused</span></>}
              {job.lastRun && (
                <><span className={styles.dot} /><span title={new Date(job.lastRun).toLocaleString()}>last ran {relativeTime(job.lastRun, now)}</span></>
              )}
              {job.skipApplied === false && <><span className={styles.dot} /><span>re-applies everything</span></>}
              {job.fillGaps && <><span className={styles.dot} /><span>fills gaps only</span></>}
            </div>
            {isRunning && job.progress && (
              <span className={styles.cardProgress} title={job.progress.current}>{progressLabel(job.progress)}</span>
            )}
            {!isRunning && lastRun && (
              <span className={`${styles.cardResult} ${lastRun.status === 'error' ? styles.metaError : lastRun.status === 'partial' ? styles.metaWarning : ''}`} title={job.lastError}>
                {describeRun(lastRun)}
              </span>
            )}
            {!isRunning && !lastRun && job.lastStatus === 'error' && job.lastError && (
              <span className={`${styles.cardResult} ${styles.metaError}`} title={job.lastError}>{job.lastError}</span>
            )}
          </div>
        </div>

        <div className={styles.cardActions}>
          <button className={styles.actionBtn} onClick={() => onMove(-1)} disabled={!canMoveUp} title="Run earlier">
            <ArrowUp size={13} />
          </button>
          <button className={styles.actionBtn} onClick={() => onMove(1)} disabled={!canMoveDown} title="Run later">
            <ArrowDown size={13} />
          </button>
          <button className={styles.actionBtn} onClick={onRunNow} disabled={isRunning || job.queued} title={isRunning ? 'Running…' : job.queued ? 'Queued' : 'Run now'}>
            {isRunning ? <Spinner size="xs" color="current" /> : <Play size={13} />}
          </button>
          {history.length > 0 && (
            <button
              className={`${styles.actionBtn} ${showHistory ? styles.actionActive : ''}`}
              onClick={() => setShowHistory(v => !v)}
              title="Recent runs"
              aria-expanded={showHistory}
            >
              <History size={13} />
            </button>
          )}
          <button className={styles.actionBtn} onClick={onEdit} title="Edit">
            <Pencil size={13} />
          </button>
          {confirmDelete ? (
            <button className={styles.confirmDelete} onClick={onDelete} title="Click again to delete this job">
              Delete?
            </button>
          ) : (
            <button className={`${styles.actionBtn} ${styles.actionDanger}`} onClick={() => setConfirmDelete(true)} title="Delete">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {showHistory && history.length > 0 && (
          <motion.ul
            className={styles.history}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {history.map(run => {
              const expandable = hasDetails(run)
              const open = expandable && openRun === run.startedAt
              return (
                <li key={run.startedAt} className={styles.historyItem}>
                  <button
                    type="button"
                    className={`${styles.historyRow} ${expandable ? styles.historyRowExpandable : ''}`}
                    onClick={() => { if (expandable) setOpenRun(open ? null : run.startedAt) }}
                    title={run.error ?? (expandable ? 'Show which titles this run touched' : undefined)}
                    aria-expanded={expandable ? open : undefined}
                  >
                    <StatusIcon status={run.status} size={11} />
                    <span className={styles.historyWhen} title={new Date(run.startedAt).toLocaleString()}>{formatWhen(run.startedAt)}</span>
                    <span className={styles.historyTrigger}>{run.trigger === 'manual' ? 'Manual' : 'Scheduled'}</span>
                    <span className={styles.historySummary}>{describeRun(run)}</span>
                  </button>
                  {open && run.details && (
                    <div className={styles.runDetails}>
                      {run.details.applied.length > 0 && <DetailList label="Applied" items={run.details.applied} />}
                      {run.details.failed.length > 0 && <DetailList label="Failed" items={run.details.failed} />}
                      {(run.details.noTarget?.length ?? 0) > 0 && (
                        <DetailList label="No matching season or episode in Plex" items={run.details.noTarget!} />
                      )}
                      {(run.details.covered?.length ?? 0) > 0 && <DetailList label="Left to other art" items={run.details.covered!} />}
                      {run.details.unmatched.length > 0 && <DetailList label="Not in your library" items={run.details.unmatched} />}
                    </div>
                  )}
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}


/** Scheduler page: manage cron jobs that scrape and apply poster sets automatically. */
export default function SchedulerPage() {
  const [jobs,        setJobs]        = useState<ScheduledJob[]>([])
  const [editing,     setEditing]     = useState<ScheduledJob | 'new' | null>(null)
  const [starting,    setStarting]    = useState<Set<string>>(new Set())
  const [autoStart,   setAutoStart]   = useState(false)
  const [engine,      setEngine]      = useState<SchedulerEngineStatus>({ external: false })
  const [env,         setEnv]         = useState<AppEnv | null>(null)
  const [quickCron,   setQuickCron]   = useState(DEFAULT_QUICK_CRON)
  const [actionError, setActionError] = useState<string | null>(null)
  const now = useNow()

  const attempt = useCallback(async (action: () => Promise<unknown>) => {
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(errorMessage(err))
    }
  }, [])

  const load = useCallback(async () => {
    const [list, auto, eng, appEnv, cfg] = await Promise.all([
      window.api.scheduler.list(),
      window.api.scheduler.getAutoStart(),
      window.api.scheduler.engineStatus(),
      window.api.app.getEnv(),
      window.api.config.get(),
    ])
    setJobs(list)
    setAutoStart(auto)
    setEngine(eng)
    setEnv(appEnv)
    setQuickCron(cfg.schedulerQuickCron || DEFAULT_QUICK_CRON)
  }, [])

  useEffect(() => {
    void attempt(load)
    const off = window.api.scheduler.onChange((updated: ScheduledJob[]) => setJobs(updated))
    // The engine heartbeat can come and go (container started/stopped) while
    // this page is open, and each job's next run moves on once it fires.
    const poll = setInterval(() => {
      void window.api.scheduler.engineStatus().then(setEngine).catch(() => {})
      void window.api.scheduler.list().then(setJobs).catch(() => {})
    }, 30_000)
    return () => { off(); clearInterval(poll) }
  }, [load, attempt])

  // Command-palette deep link: scroll to and briefly highlight the requested job.
  const schedulerJobId = useNavStore(s => s.schedulerJobId)
  const clearScheduler  = useNavStore(s => s.clearScheduler)
  useEffect(() => {
    if (!schedulerJobId || jobs.length === 0) return
    const id = schedulerJobId
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-job-id="${id}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add(styles.jobPulse)
        setTimeout(() => el.classList.remove(styles.jobPulse), 1600)
      }
      clearScheduler()
    }, 120)
    return () => clearTimeout(t)
  }, [schedulerJobId, jobs, clearScheduler])

  async function runNow(id: string) {
    setStarting(prev => new Set(prev).add(id))
    await attempt(() => window.api.scheduler.runNow(id))
    setStarting(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  async function saveJob(job: ScheduledJob, runAfterSave: boolean) {
    const saved = await window.api.scheduler.save(job)
    setEditing(null)
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

  function changeQuickCron(expr: string) {
    setQuickCron(expr)
    void attempt(() => window.api.config.set({ schedulerQuickCron: expr }))
  }

  async function toggleAutoStart(v: boolean) {
    setAutoStart(v)
    await attempt(() => window.api.scheduler.setAutoStart(v))
  }

  const closeEditor   = useCallback(() => setEditing(null), [])
  const enabledCount  = jobs.filter(j => j.enabled).length
  const troubleCount  = jobs.filter(j => j.lastStatus === 'error' || j.lastStatus === 'partial').length
  const quickOptions  = QUICK_SCHEDULES.includes(quickCron) ? QUICK_SCHEDULES : [...QUICK_SCHEDULES, quickCron]

  return (
    <div className={styles.page}>

      <div className={styles.header}>
        <div>
          <h1 className="page-title">Scheduler</h1>
          <p className="page-subtitle">
            Run poster scrape &amp; upload jobs automatically on a recurring schedule.
            {jobs.length > 0 && ` ${enabledCount} of ${jobs.length} active.`}
            {jobs.length > 1 && ' Jobs run one at a time, in this order.'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.autoStart} title="Schedule used by the Schedule and Sync buttons in the Library Browser">
            <Zap size={12} className={styles.autoStartIcon} />
            <span>Quick sync</span>
            <select className={`${styles.select} ${styles.headerSelect}`} value={quickCron} onChange={e => changeQuickCron(e.target.value)}>
              {quickOptions.map(expr => <option key={expr} value={expr}>{describeCron(expr)}</option>)}
            </select>
          </label>
          {/* "Launch at login" only matters on a standalone desktop install. In a
              container the OS setting is a no-op (the container restart policy keeps
              it alive), and when a 24/7 engine is running, launching the desktop app
              at login is redundant - the engine already handles scheduling. */}
          {!env?.container && !engine.external && (
            <label className={styles.autoStart}>
              <Power size={12} className={styles.autoStartIcon} />
              <span>Launch at login</span>
              <Switch checked={autoStart} onChange={toggleAutoStart} />
            </label>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => setEditing('new')}
          >
            New Job
          </Button>
        </div>
      </div>

      {engine.external && (
        <div className={styles.engineNotice}>
          <Server size={13} />
          <span>
            A 24/7 scheduler is running these jobs and will fire them even when this app is closed.
            Edits you make here are picked up automatically - this window is your editor and dashboard.
          </span>
        </div>
      )}

      {actionError && (
        <div className={styles.errorNotice} role="alert">
          <AlertCircle size={13} />
          <span>{actionError}</span>
          <button className={styles.noticeClose} onClick={() => setActionError(null)} title="Dismiss"><X size={12} /></button>
        </div>
      )}

      {troubleCount > 0 && (
        <div className={styles.warnNotice}>
          <AlertTriangle size={13} />
          <span>
            {troubleCount} job{troubleCount !== 1 ? 's' : ''} had problems on the last run. Open a job&apos;s recent runs to see what happened, or run it again.
          </span>
        </div>
      )}

      {jobs.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={22} />}
          title="No scheduled jobs"
          description="Create a job here, or use Schedule on a set or Sync on a creator in the Library Browser. New artwork that matches your library is applied automatically."
          action={
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={13} />}
              onClick={() => setEditing('new')}
            >
              Create your first job
            </Button>
          }
        />
      ) : (
        <div className={styles.list}>
          <AnimatePresence initial={false}>
            {jobs.map((job, index) => (
              <motion.div
                key={job.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                <JobCard
                  job={job}
                  now={now}
                  starting={starting.has(job.id)}
                  canMoveUp={index > 0}
                  canMoveDown={index < jobs.length - 1}
                  onEdit={() => setEditing(job)}
                  onDelete={() => void attempt(() => window.api.scheduler.delete(job.id))}
                  onToggle={() => void attempt(() => window.api.scheduler.save({ ...job, enabled: !job.enabled }))}
                  onRunNow={() => void runNow(job.id)}
                  onMove={delta => moveJob(job.id, delta)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {editing !== null && (
          <JobForm
            initial={editing === 'new' ? undefined : editing}
            onSave={saveJob}
            onClose={closeEditor}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
