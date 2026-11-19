import type { RefObject } from 'react'
import styles from './SetupLog.module.css'

interface SetupLogProps
{
  lines: string[]
  /** The box the install log scrolls to the bottom of as lines arrive. */
  ref: RefObject<HTMLDivElement | null>
}

/** The install's output, one line per row, in a box that scrolls. */
export default function SetupLog({ lines, ref }: SetupLogProps)
{
  return (
    <div className={styles.logBox} ref={ref}>
      {lines.map((line, i) => (
        <div key={i} className={styles.logLine}>{line}</div>
      ))}
    </div>
  )
}
