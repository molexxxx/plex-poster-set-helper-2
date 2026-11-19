import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import type { LogNoticeMessage } from '../hooks/useLogNotice'
import styles from './LogNotice.module.css'

interface LogNoticeProps
{
  notice: LogNoticeMessage
  onDismiss: () => void
}

/** A notice over the log lines: an action done, one to follow up on, or a failure. */
export default function LogNotice({ notice, onDismiss }: LogNoticeProps)
{
  return (
    <div className={styles.notice} data-tone={notice.tone}>
      {notice.tone === 'done'
        ? <CheckCircle2 size={14} aria-hidden />
        : <AlertTriangle size={14} aria-hidden />}
      <span className={styles.noticeText}>{notice.text}</span>
      <button type="button" className={styles.noticeClose} onClick={onDismiss} aria-label="Dismiss">
        <X size={12} aria-hidden />
      </button>
    </div>
  )
}
