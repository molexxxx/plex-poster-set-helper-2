import { useId } from 'react'
import styles from '../schedulerShared.module.css'
/** A labeled block of rows in the detail pane, styled like a Settings group. */
export default function DetailBlock({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode })
{
  const titleId = useId()
  return (
    <section className={styles.block} aria-labelledby={titleId}>
      <div className={styles.blockHead}>
        <h3 id={titleId} className={styles.blockTitle}>{title}</h3>
        {action}
      </div>
      <div className={styles.panel}>{children}</div>
    </section>
  )
}
