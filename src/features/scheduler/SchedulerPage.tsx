import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CalendarClock, Plus, Play, Trash2, ToggleLeft, ToggleRight,
  Clock, CheckCircle2, AlertCircle, Loader2, ChevronRight, X, Save,
  Power,
} from 'lucide-react'
import Button from '../../components/ui/Button'
import Switch from '../../components/ui/Switch'
import EmptyState from '../../components/ui/EmptyState'
import Spinner from '../../components/ui/Spinner'
import type { ScheduledJob } from '../../../electron/ipc/types'
import styles from './SchedulerPage.module.css'

// --- Cron helpers --------------------------------------------------------------

type Preset = 'daily' | 'weekly' | 'custom'
const DAYS    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS   = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 15, 30, 45]

function buildCron(preset: Preset, hour: number, minute: number, day: number, custom: string): string {
  if (preset === 'custom') return custom
  if (preset === 'weekly') return `${minute} ${hour} * * ${day}`
  return `${minute} ${hour} * * *`
}

function parseCron(expr: string): { preset: Preset; hour: number; minute: number; day: number } {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return { preset: 'custom', hour: 3, minute: 0, day: 0 }
  const [min, hr, , , dow] = parts
  const hour   = parseInt(hr) || 0
  const minute = parseInt(min) || 0
  const day    = parseInt(dow)
  if (dow === '*')    return { preset: 'daily',  hour, minute, day: 0 }
  if (!isNaN(day))    return { preset: 'weekly', hour, minute, day }
  return { preset: 'custom', hour, minute, day: 0 }
}

function nextRunLabel(cronExpr: string): string {
  try {
    const parts = cronExpr.trim().split(/\s+/)
    if (parts.length !== 5) return 'invalid schedule'
    const [min, hr, , , dow] = parts
    const h = parseInt(hr); const m = parseInt(min)
    if (isNaN(h) || isNaN(m)) return 'custom schedule'
    const now  = new Date()
    const next = new Date(now)
    next.setSeconds(0); next.setMilliseconds(0)
    next.setHours(h);   next.setMinutes(m)
    if (dow !== '*') {
      const target = parseInt(dow)
      const diff   = (target - now.getDay() + 7) % 7 || (next <= now ? 7 : 0)
      next.setDate(now.getDate() + diff)
    } else if (next <= now) {
      next.setDate(next.getDate() + 1)
    }
    const ms = next.getTime() - now.getTime()
    const hh = Math.floor(ms / 3_600_000)
    const mm = Math.floor((ms % 3_600_000) / 60_000)
    if (hh >= 24) return `in ${Math.floor(hh / 24)}d ${hh % 24}h`
    if (hh > 0)   return `in ${hh}h ${mm}m`
    return `in ${mm}m`
  } catch { return '-' }
}

function humanSchedule(cronExpr: string): string {
  const p    = parseCron(cronExpr)
  const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
  if (p.preset === 'daily')  return `Daily at ${time}`
  if (p.preset === 'weekly') return `Every ${DAYS[p.day]} at ${time}`
  return cronExpr
}

// --- Job form ------------------------------------------------------------------

interface JobFormProps {
  initial?: ScheduledJob
  onSave:  (job: ScheduledJob) => void
  onClose: () => void
}

function JobForm({ initial, onSave, onClose }: JobFormProps) {
  const parsed = initial ? parseCron(initial.cronExpr) : { preset: 'daily' as Preset, hour: 3, minute: 0, day: 1 }

  const [name,    setName]    = useState(initial?.name ?? '')
  const [urls,    setUrls]    = useState((initial?.urls ?? []).join('\n'))
  const [preset,  setPreset]  = useState<Preset>(parsed.preset)
  const [hour,    setHour]    = useState(parsed.hour)
  const [minute,  setMinute]  = useState(parsed.minute)
  const [day,     setDay]     = useState(parsed.day)
  const [custom,  setCustom]  = useState(initial?.cronExpr ?? '0 3 * * *')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)

  const cronExpr = buildCron(preset, hour, minute, day, custom)
  const urlList  = urls.split('\n').map(l => l.trim()).filter(Boolean)

  // Only close on a true backdrop click - not when a text-selection drag that
  // started inside the drawer happens to release over the overlay.
  const downOnOverlay = useRef(false)
  const valid    = name.trim().length > 0 && urlList.length > 0

  function submit() {
    if (!valid) return
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      urls: urlList,
      cronExpr,
      enabled,
      lastRun:    initial?.lastRun,
      lastStatus: initial?.lastStatus,
    })
  }

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
      >
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>{initial ? 'Edit Job' : 'New Scheduled Job'}</span>
          <button className={styles.drawerClose} onClick={onClose}><X size={14} /></button>
        </div>

        <div className={styles.drawerBody}>
          {/* Name */}
          <div className={styles.field}>
            <label className={styles.label}>Job name</label>
            <input
              className={styles.input}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Nightly poster sync"
              spellCheck={false}
            />
          </div>

          {/* URLs */}
          <div className={styles.field}>
            <label className={styles.label}>
              URLs
              <span className={styles.labelMeta}>one per line</span>
            </label>
            <textarea
              className={styles.textarea}
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
              placeholder={'https://mediux.pro/sets/...\nhttps://theposterdb.com/set/...'}
              rows={5}
              spellCheck={false}
            />
            {urlList.length > 0 && (
              <span className={styles.fieldMeta}>{urlList.length} URL{urlList.length !== 1 ? 's' : ''}</span>
            )}
          </div>

          {/* Schedule */}
          <div className={styles.field}>
            <label className={styles.label}>Schedule</label>
            <div className={styles.presets}>
              {(['daily', 'weekly', 'custom'] as Preset[]).map(p => (
                <button
                  key={p}
                  className={`${styles.presetBtn} ${preset === p ? styles.presetActive : ''}`}
                  onClick={() => setPreset(p)}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>

            {preset !== 'custom' && (
              <div className={styles.timePicker}>
                {preset === 'weekly' && (
                  <div className={styles.dayRow}>
                    {DAYS.map((d, i) => (
                      <button
                        key={d}
                        className={`${styles.dayBtn} ${day === i ? styles.dayActive : ''}`}
                        onClick={() => setDay(i)}
                      >{d}</button>
                    ))}
                  </div>
                )}
                <div className={styles.timeRow}>
                  <select
                    className={styles.select}
                    value={hour}
                    onChange={e => setHour(Number(e.target.value))}
                  >
                    {HOURS.map(h => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                  <span className={styles.timeSep}>:</span>
                  <select
                    className={styles.select}
                    value={minute}
                    onChange={e => setMinute(Number(e.target.value))}
                  >
                    {MINUTES.map(m => (
                      <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {preset === 'custom' && (
              <div className={styles.customRow}>
                <input
                  className={styles.input}
                  value={custom}
                  onChange={e => setCustom(e.target.value)}
                  placeholder="0 3 * * *"
                  spellCheck={false}
                />
                <span className={styles.fieldMeta}>min · hour · day · month · weekday</span>
              </div>
            )}

            <div className={styles.cronPreview}>
              <Clock size={11} />
              <span>{humanSchedule(cronExpr)} · next run {nextRunLabel(cronExpr)}</span>
            </div>
          </div>

          {/* Enabled */}
          <Switch
            label="Enable this job"
            description="Disabled jobs are saved but won't run on schedule."
            checked={enabled}
            onChange={setEnabled}
          />
        </div>

        <div className={styles.drawerFooter}>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Save size={13} />}
            onClick={submit}
            disabled={!valid}
          >
            {initial ? 'Save Changes' : 'Create Job'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// --- Job card ------------------------------------------------------------------

interface JobCardProps {
  job:      ScheduledJob
  running:  boolean
  onEdit:   () => void
  onDelete: () => void
  onToggle: () => void
  onRunNow: () => void
}

function JobCard({ job, running, onEdit, onDelete, onToggle, onRunNow }: JobCardProps) {
  return (
    <div className={`${styles.card} ${!job.enabled ? styles.cardOff : ''}`}>
      <div className={styles.cardLeft}>
        <button
          className={`${styles.toggle} ${job.enabled ? styles.toggleOn : ''}`}
          onClick={onToggle}
          title={job.enabled ? 'Disable' : 'Enable'}
        >
          {job.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
        </button>

        <div className={styles.cardInfo}>
          <div className={styles.cardNameRow}>
            <span className={styles.cardName}>{job.name}</span>
            {job.lastStatus === 'success' && (
              <CheckCircle2 size={11} className={styles.iconSuccess} />
            )}
            {job.lastStatus === 'error' && (
              <AlertCircle size={11} className={styles.iconError} />
            )}
            {running && <Loader2 size={12} className={styles.iconSpin} />}
          </div>
          <span className={styles.cardSchedule}>{humanSchedule(job.cronExpr)}</span>
          <div className={styles.cardMeta}>
            <span>{job.urls.length} URL{job.urls.length !== 1 ? 's' : ''}</span>
            {job.enabled && (
              <><span className={styles.dot} /><span>next {nextRunLabel(job.cronExpr)}</span></>
            )}
            {job.lastRun && (
              <><span className={styles.dot} /><span>last ran {new Date(job.lastRun).toLocaleDateString()}</span></>
            )}
            {job.lastStatus === 'error' && job.lastError && (
              <><span className={styles.dot} /><span className={styles.metaError}>{job.lastError}</span></>
            )}
          </div>
        </div>
      </div>

      <div className={styles.cardActions}>
        <button
          className={styles.actionBtn}
          onClick={onRunNow}
          disabled={running}
          title="Run now"
        >
          {running ? <Spinner size="xs" color="current" /> : <Play size={13} />}
        </button>
        <button className={styles.actionBtn} onClick={onEdit} title="Edit">
          <ChevronRight size={13} />
        </button>
        <button
          className={`${styles.actionBtn} ${styles.actionDanger}`}
          onClick={onDelete}
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

// --- Page ----------------------------------------------------------------------

export default function SchedulerPage() {
  const [jobs,       setJobs]       = useState<ScheduledJob[]>([])
  const [editing,    setEditing]    = useState<ScheduledJob | 'new' | null>(null)
  const [running,    setRunning]    = useState<Set<string>>(new Set())
  const [autoStart,  setAutoStart]  = useState(false)

  const load = useCallback(async () => {
    const [list, auto] = await Promise.all([
      window.api.scheduler.list() as Promise<ScheduledJob[]>,
      window.api.scheduler.getAutoStart() as Promise<boolean>,
    ])
    setJobs(list)
    setAutoStart(auto)
  }, [])

  useEffect(() => {
    void load()
    const off = window.api.scheduler.onChange((updated: ScheduledJob[]) => setJobs(updated))
    return () => { off() }
  }, [load])

  async function saveJob(job: ScheduledJob) {
    await window.api.scheduler.save(job)
    setEditing(null)
  }

  async function deleteJob(id: string) {
    await window.api.scheduler.delete(id)
  }

  async function toggleJob(job: ScheduledJob) {
    await window.api.scheduler.save({ ...job, enabled: !job.enabled })
  }

  async function runNow(id: string) {
    setRunning(prev => new Set(prev).add(id))
    try { await window.api.scheduler.runNow(id) }
    finally { setRunning(prev => { const s = new Set(prev); s.delete(id); return s }) }
  }

  async function toggleAutoStart(v: boolean) {
    setAutoStart(v)
    await window.api.scheduler.setAutoStart(v)
  }

  const enabledCount = jobs.filter(j => j.enabled).length
  const errorCount   = jobs.filter(j => j.lastStatus === 'error').length

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className="page-title">Scheduler</h1>
          <p className="page-subtitle">
            Run poster scrape &amp; upload jobs automatically on a recurring schedule.
            {jobs.length > 0 && ` ${enabledCount} of ${jobs.length} active.`}
          </p>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.autoStart}>
            <Power size={12} className={styles.autoStartIcon} />
            <span>Launch at login</span>
            <Switch checked={autoStart} onChange={toggleAutoStart} />
          </label>
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

      {/* Error notice */}
      {errorCount > 0 && (
        <div className={styles.errorNotice}>
          <AlertCircle size={13} />
          <span>{errorCount} job{errorCount !== 1 ? 's' : ''} failed on last run. Edit to review or run again.</span>
        </div>
      )}

      {/* Job list / empty */}
      {jobs.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={22} />}
          title="No scheduled jobs"
          description="Create a job to automatically scrape and upload posters on a recurring schedule."
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
            {jobs.map(job => (
              <motion.div
                key={job.id}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                <JobCard
                  job={job}
                  running={running.has(job.id)}
                  onEdit={() => setEditing(job)}
                  onDelete={() => deleteJob(job.id)}
                  onToggle={() => toggleJob(job)}
                  onRunNow={() => runNow(job.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Drawer */}
      <AnimatePresence>
        {editing !== null && (
          <JobForm
            initial={editing === 'new' ? undefined : editing}
            onSave={saveJob}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
