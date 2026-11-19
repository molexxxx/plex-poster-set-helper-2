import { Film, Tv2, Layers } from 'lucide-react'
import type { Stats } from '../resetText'
import styles from './StatStrip.module.css'


/** Summary chips of applied-poster counts by source and type. */
export default function StatStrip({ stats }: { stats: Stats })
{
  return (
    <div className={styles.statsStrip}>
      <span className={styles.stripStat}>
        <Layers size={13} className={styles.stripIcon} />
        <strong>{stats.total}</strong>
        <span>tracked</span>
      </span>
      <span className={styles.stripDiv} />
      <span className={styles.stripStat}>
        <span className={`${styles.sourceChip} ${styles.sourceChipMx}`}>MX</span>
        <strong>{stats.mediux}</strong>
      </span>
      <span className={styles.stripStat}>
        <span className={`${styles.sourceChip} ${styles.sourceChipPdb}`}>PDB</span>
        <strong>{stats.posterdb}</strong>
      </span>
      <span className={styles.stripDiv} />
      <span className={styles.stripStat}>
        <Film size={12} className={styles.stripIcon} />
        <strong>{stats.movies}</strong>
        <span>movies</span>
      </span>
      <span className={styles.stripStat}>
        <Tv2 size={12} className={styles.stripIcon} />
        <strong>{stats.shows}</strong>
        <span>shows</span>
      </span>
    </div>
  )
}
