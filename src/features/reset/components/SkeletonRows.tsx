import styles from './SkeletonRows.module.css'


/** Shimmer placeholder rows shown while the applied history loads. */
export default function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={styles.skelRow} style={{ animationDelay: `${i * 60}ms` }}>
          <div className={`${styles.skel} ${styles.skelThumb}`} />
          <div className={styles.skelInfo}>
            <div className={`${styles.skel} ${styles.skelTitle}`} />
            <div className={`${styles.skel} ${styles.skelMeta}`} />
          </div>
          <div className={`${styles.skel} ${styles.skelBtn}`} />
        </div>
      ))}
    </>
  )
}
