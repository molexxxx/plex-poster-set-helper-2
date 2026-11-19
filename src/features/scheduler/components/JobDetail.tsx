import { useId } from 'react'
import { Play, Trash2, ArrowUp, ArrowDown, Square, Pencil } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Switch from '../../../components/ui/Switch'
import Menu from '../../../components/ui/Menu'
import ProgressBar from '../../../components/ui/ProgressBar'
import type { ArtworkType, ScheduledJob } from '../../../../electron/ipc/types'
import { describeCron, describeProgress, describeRun, relativeTime } from '../../../../electron/services/scheduleUtils'
import { describeJobTypes, formatWhen, jobIdentity, jobStatus, statusLabel } from '../schedulerFormat'
import StatusIcon from './StatusIcon'
import DetailBlock from './DetailBlock'
import HistoryEntry from './HistoryEntry'
import shared from '../schedulerShared.module.css'
import styles from './JobDetail.module.css'
interface JobDetailProps {
  job:         ScheduledJob
  settingsTypes: ArtworkType[]
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
export default function JobDetail({ job, settingsTypes, now, starting, canMoveUp, canMoveDown, canStop, onEdit, onDelete, onToggle, onRunNow, onStop, onMove }: JobDetailProps) {
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
        <div className={shared.detailRow}>
          <div className={shared.detailRowText}>
            <span id={enabledLabelId} className={shared.detailRowLabel}>Run on schedule</span>
            <span className={shared.detailRowValue}>{job.enabled ? describeCron(job.cronExpr) : `Paused. When on: ${describeCron(job.cronExpr)}`}</span>
          </div>
          <Switch checked={job.enabled} onChange={onToggle} ariaLabelledBy={enabledLabelId} />
        </div>
        <div className={shared.detailRow}>
          <div className={shared.detailRowText}>
            <span className={shared.detailRowLabel}>Next run</span>
            <span className={shared.detailRowValue}>
              {job.enabled && job.nextRun ? `${formatWhen(job.nextRun)} (${relativeTime(job.nextRun, now)})` : 'Only when you start it'}
            </span>
          </div>
        </div>
      </DetailBlock>

      <DetailBlock title="Last run">
        <div className={shared.detailRow}>
          <div className={shared.detailRowText}>
            {lastRun ? (
              <>
                <span className={`${shared.detailRowLabel} ${styles.lastRunLabel}`}>
                  <StatusIcon status={lastRun.status} />
                  {formatWhen(lastRun.startedAt)} · {lastRun.trigger === 'manual' ? 'started by you' : 'scheduled'}
                </span>
                <span className={styles.lastResult}>{summary}</span>
                {lastError && lastError !== summary && <span className={shared.errorLine}>{lastError}</span>}
              </>
            ) : job.lastError ? (
              <span className={shared.errorLine}>{job.lastError}</span>
            ) : (
              <span className={shared.detailRowValue}>This job has not run yet.</span>
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
          <div className={shared.detailRow}>
            <div className={shared.detailRowText}>
              <span className={shared.detailRowLabel}>Where it starts</span>
              <span className={shared.detailRowValue}>
                {job.since
                  ? `Sets @${job.creator} added or updated since ${new Date(job.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : `Every set in @${job.creator}'s catalog`}
              </span>
            </div>
          </div>
        )}
        <div className={shared.detailRow}>
          <div className={shared.detailRowText}>
            <span className={shared.detailRowLabel}>Artwork types</span>
            <span className={shared.detailRowValue}>{describeJobTypes(job, settingsTypes)}</span>
          </div>
        </div>
        <div className={shared.detailRow}>
          <div className={shared.detailRowText}>
            <span className={shared.detailRowLabel}>Only apply new artwork</span>
            <span className={shared.detailRowValue}>{job.skipApplied === false ? 'Off: re-applies the whole set every run' : 'On: skips posters already applied'}</span>
          </div>
        </div>
        <div className={shared.detailRow}>
          <div className={shared.detailRowText}>
            <span className={shared.detailRowLabel}>Only fill gaps</span>
            <span className={shared.detailRowValue}>{job.fillGaps ? 'On: leaves slots other art already covers' : 'Off'}</span>
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
