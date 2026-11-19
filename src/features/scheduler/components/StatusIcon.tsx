import { CheckCircle2, AlertCircle, AlertTriangle, Loader2, Hourglass, Square, CircleSlash } from 'lucide-react'
import type { RowStatus } from '../schedulerFormat'
import styles from './StatusIcon.module.css'
/** Icon for a run or job status. */
export default function StatusIcon({ status, size = 13 }: { status?: RowStatus; size?: number })
{
  if (status === 'running') return <Loader2 size={size} className={styles.iconSpin} aria-hidden />
  if (status === 'queued') return <Hourglass size={size} className={styles.iconMuted} aria-hidden />
  if (status === 'paused') return <CircleSlash size={size} className={styles.iconMuted} aria-hidden />
  if (status === 'success') return <CheckCircle2 size={size} className={styles.iconSuccess} aria-hidden />
  if (status === 'partial') return <AlertTriangle size={size} className={styles.iconWarning} aria-hidden />
  if (status === 'error') return <AlertCircle size={size} className={styles.iconError} aria-hidden />
  if (status === 'stopped') return <Square size={size - 2} className={styles.iconMuted} aria-hidden />
  return null
}
