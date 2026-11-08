import styles from './AmbientBackground.module.css'

/** Static atmospheric glow behind the app shell, painted once by CSS with no animation loop. */
export default function AmbientBackground() {
  return <div className={styles.backdrop} aria-hidden="true" />
}
