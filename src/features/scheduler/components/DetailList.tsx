import styles from './DetailList.module.css'
/** One category of a run's per-title details. */
export default function DetailList({ label, items }: { label: string; items: string[] })
{
  return (
    <div className={styles.detailGroup}>
      <span className={styles.detailLabel}>{label}</span>
      <ul className={styles.detailItems}>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}
