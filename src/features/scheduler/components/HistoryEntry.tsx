import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { JobRun } from '../../../../electron/ipc/types'
import { describeRun } from '../../../../electron/services/scheduleUtils'
import { formatWhen } from '../schedulerFormat'
import StatusIcon from './StatusIcon'
import DetailList from './DetailList'
import shared from '../schedulerShared.module.css'
import styles from './HistoryEntry.module.css'
/** One past run, with its error written out and its per-title details on request. */
export default function HistoryEntry({ run }: { run: JobRun })
{
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
      {run.error && run.status !== 'stopped' && run.error !== summary && <p className={shared.errorLine}>{run.error}</p>}
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
