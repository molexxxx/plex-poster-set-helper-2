import type { RefObject } from 'react'
import { Plus, AlertTriangle } from 'lucide-react'
import Button from '../../../components/ui/Button'
import type { ScheduledJob } from '../../../../electron/ipc/types'
import { describeCron } from '../../../../electron/services/schedule/cronText'
import { relativeTime } from '../../../../electron/services/schedule/runs'
import { jobStatus, statusLabel } from '../schedulerFormat'
import StatusIcon from './StatusIcon'
import shared from '../schedulerShared.module.css'
import styles from './JobList.module.css'

interface JobListProps
{
  jobs: ScheduledJob[]
  selected: ScheduledJob | null
  /** Jobs whose Run now is starting; they show as running. */
  starting: Set<string>
  /** The time the next-run labels count from. */
  now: number
  listRef: RefObject<HTMLDivElement | null>
  setSelectedId: (id: string) => void
  /** Opens the editor for a new job. */
  setEditing: (job: 'new') => void
  /** Selects a job and brings it into view, for the links in the problem notice. */
  reveal: (id: string) => void
}

/** The jobs in run order beside the detail pane, with New job and a notice naming jobs whose last run had problems. */
export default function JobList({ jobs, selected, starting, now, listRef, setSelectedId, setEditing, reveal }: JobListProps)
{
  const troubled = jobs.filter(j => j.enabled && (j.lastStatus === 'error' || j.lastStatus === 'partial'))

  function onListKey(e: React.KeyboardEvent)
  {
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

  return (
    <aside className={styles.sidebar} aria-label="Jobs">
      <div className={styles.sidebarHead}>
        <div>
          <h1 className="page-title">Scheduler</h1>
          <p className="page-subtitle">Jobs run one at a time, top to bottom.</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setEditing('new')}>New job</Button>
      </div>

      {troubled.length > 0 && (
        <div className={shared.warnNotice}>
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
        {jobs.map((job, index) =>
        {
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
                  <span className={shared.srOnly}>{statusLabel(job, status)}</span>
                </span>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
