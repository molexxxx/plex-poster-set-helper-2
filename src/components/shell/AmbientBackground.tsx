import styles from './AmbientBackground.module.css'

/** The app's solid ground behind every page. */
export default function AmbientBackground() {
  return <div className={styles.backdrop} aria-hidden="true" />
}
