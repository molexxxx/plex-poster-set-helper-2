import { LOG_LEVEL_LABELS } from '../../../../electron/services/logFormat'
import { dayLabel, fullTime, timeOf, type LogRow } from '../logView'
import styles from './LogLines.module.css'

/** The log rows: a heading where the day changes, a marker where the app started, and one line per entry. */
export default function LogLines({ rows }: { rows: LogRow[] })
{
  return (
    <>
      {rows.map(row =>
      {
        if (row.kind === 'day')
        {
          return (
            <div key={row.key} className={styles.dayRow}>
              <span>{dayLabel(row.day)}</span>
            </div>
          )
        }
        const e = row.entry
        if (row.kind === 'start')
        {
          return (
            <div key={row.key} className={styles.startRow}>
              <span className={styles.time} title={fullTime(e.ts)}>{timeOf(e.ts)}</span>
              <span className={styles.startText}>{e.message}</span>
            </div>
          )
        }
        const meta = e.meta && Object.keys(e.meta).length ? JSON.stringify(e.meta) : ''
        return (
          <div key={row.key} className={styles.row} data-level={e.level}>
            <span className={styles.time} title={fullTime(e.ts)}>{timeOf(e.ts)}</span>
            <span className={styles.level} data-level={e.level}>{LOG_LEVEL_LABELS[e.level] ?? e.level.toUpperCase()}</span>
            <span className={styles.module} title={e.module}>{e.module}</span>
            <span className={styles.message}>
              {e.message}
              {meta && <span className={styles.meta}> {meta}</span>}
            </span>
          </div>
        )
      })}
    </>
  )
}
