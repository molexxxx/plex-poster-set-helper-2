import { useId } from 'react'
import styles from './settingsRows.module.css'
/** A titled group of settings rows. */
export default function Block({ title, description, action, anchor, children }: {
  title: string
  description?: string
  action?: React.ReactNode
  /** Deep-link target used by the command palette. */
  anchor?: string
  children: React.ReactNode
})
{
  const titleId = useId()
  return (
    <section className={styles.block} data-anchor={anchor} aria-labelledby={titleId}>
      <div className={styles.blockHead}>
        <h3 id={titleId} className={styles.blockTitle}>{title}</h3>
        {action}
      </div>
      {description && <p className={styles.blockDesc}>{description}</p>}
      <div className={styles.list}>{children}</div>
    </section>
  )
}
