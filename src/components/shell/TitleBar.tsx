import { useEffect, useState } from 'react'
import styles from './TitleBar.module.css'

function PlexIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="ppsh-amber" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f9c449" />
          <stop offset="0.5" stopColor="#e5a00d" />
          <stop offset="1" stopColor="#bd860f" />
        </linearGradient>
      </defs>
      <rect x="12" y="4" width="40" height="56" rx="7" fill="#c3cadb" transform="rotate(-16 32 54)" />
      <rect x="12" y="4" width="40" height="56" rx="7" fill="#79829b" transform="rotate(13 32 54)" />
      <rect x="12" y="4" width="40" height="56" rx="7" fill="url(#ppsh-amber)" />
      <path d="M 26.4 24.6 L 40 32 L 26.4 39.4 Z" fill="#11141c" stroke="#11141c" strokeWidth="6" strokeLinejoin="round" />
    </svg>
  )
}

/** Title bar: the app's name, the page in view, and the window controls (hidden in web mode). */
export default function TitleBar({ section }: { section?: string }) {
  const [isWeb, setIsWeb] = useState(true)

  useEffect(() => {
    window.api?.app.getEnv().then(e => setIsWeb(!!e.web))
  }, [])

  return (
    <div className={styles.bar}>
      <div className={isWeb ? styles.lead : `${styles.lead} ${styles.drag}`}>
        <div className={styles.brand}>
          <PlexIcon />
          <span className={styles.appName}>
            Plex Poster Set Helper{' '}<span className={styles.version}>2</span>
          </span>
        </div>
        {section && (
          <>
            <span className={styles.divider} aria-hidden />
            <span className={styles.section}>{section}</span>
          </>
        )}
      </div>
      {!isWeb && (
        <div className={styles.controls}>
          <button className={styles.btn} onClick={() => window.api.window.minimize()} aria-label="Minimize">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><rect y="4.5" width="10" height="1" fill="currentColor" /></svg>
          </button>
          <button className={styles.btn} onClick={() => window.api.window.maximize()} aria-label="Maximize">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden><rect x="0.5" y="0.5" width="9" height="9" rx="1.5" stroke="currentColor" /></svg>
          </button>
          <button className={`${styles.btn} ${styles.close}`} onClick={() => window.api.window.close()} aria-label="Close">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M0.6 0.6l8.8 8.8M9.4 0.6l-8.8 8.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></svg>
          </button>
        </div>
      )}
    </div>
  )
}
