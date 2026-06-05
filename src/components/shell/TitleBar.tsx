import styles from './TitleBar.module.css'

function PlexIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M16 2C8.268 2 2 8.268 2 16s6.268 14 14 14 14-6.268 14-14S23.732 2 16 2z"
        fill="#e5a00d"
      />
      <path
        d="M13.5 9l9 7-9 7V9z"
        fill="#1a1a1a"
      />
    </svg>
  )
}

export default function TitleBar() {
  return (
    <div className={styles.bar}>
      <div className={styles.drag}>
        <div className={styles.brand}>
          <PlexIcon />
          <span className={styles.appName}>Plex Poster Set Helper</span>
        </div>
      </div>
      <div className={styles.controls}>
        <button className={styles.btn} onClick={() => window.api.window.minimize()} aria-label="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor" /></svg>
        </button>
        <button className={styles.btn} onClick={() => window.api.window.maximize()} aria-label="Maximize">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" /></svg>
        </button>
        <button className={`${styles.btn} ${styles.close}`} onClick={() => window.api.window.close()} aria-label="Close">
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" /><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>
    </div>
  )
}
