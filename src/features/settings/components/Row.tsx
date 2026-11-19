import { useId } from 'react'
import styles from './settingsRows.module.css'
/**
 * One settings row: label and description on the left, its control on the right.
 *
 * @param stacked - Put the control under the text, for wide inputs and lists.
 * @param children - The control, or a function given the label and description
 *   ids so the control can name itself after the row.
 */
export default function Row({ label, description, stacked, children }: {
  label: React.ReactNode
  description?: React.ReactNode
  stacked?: boolean
  children?: React.ReactNode | ((ids: { labelId: string; descId: string }) => React.ReactNode)
}) {
  const labelId = useId()
  const descId = useId()
  const control = typeof children === 'function' ? children({ labelId, descId }) : children
  return (
    <div className={`${styles.row} ${stacked ? styles.rowStacked : ''}`}>
      <div className={styles.rowText}>
        <span id={labelId} className={styles.rowLabel}>{label}</span>
        {description && <span id={descId} className={styles.rowDesc}>{description}</span>}
      </div>
      {control && <div className={styles.rowControl}>{control}</div>}
    </div>
  )
}
