import { useEffect, useState } from 'react'
import { LogIn, Copy, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react'
import Button from '../../components/ui/Button'
import Spinner from '../../components/ui/Spinner'
import type { PlexAuthStatus } from '../../../electron/ipc/types'
import { copyText } from '../../utils/clipboard'
import styles from './WebSignInScreen.module.css'

interface Props {
  onAuthorized: () => void
}

/** Full-screen Plex SSO gate shown before the web UI loads. */
export default function WebSignInScreen({ onAuthorized }: Props) {
  const [status, setStatus] = useState<PlexAuthStatus>({ status: 'idle' })
  const [signingIn, setSigningIn] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.api?.auth.getStatus().then(s => {
      setStatus(s)
      if (s.status === 'authorized') onAuthorized()
    })
    const off = window.api?.auth.onStatusChange(s => {
      setStatus(s)
      if (s.status === 'authorized') {
        setSigningIn(false)
        void window.api?.auth.getStatus().then(() => onAuthorized())
      }
      if (s.status === 'idle') setSigningIn(false)
    })
    return () => { off?.() }
  }, [onAuthorized])

  async function signIn() {
    setSigningIn(true)
    setStatus({ status: 'waiting' })
    try {
      const authUrl = await window.api?.auth.signIn()
      if (authUrl) setStatus({ status: 'waiting', authUrl })
    } catch {
      setSigningIn(false)
      setStatus({ status: 'idle' })
    }
  }

  async function cancel() {
    await window.api?.auth.disconnect()
    setSigningIn(false)
    setStatus({ status: 'idle' })
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <LogIn size={40} color="var(--color-accent)" />
          <h1 className={styles.appName}>Plex Poster Set Helper 2</h1>
          <p className={styles.subtitle}>Sign in with Plex to continue</p>
        </div>

        <div className={styles.signInRow}>
          {status.status === 'error' ? (
            <div className={styles.errorBox}>
              <AlertCircle size={20} />
              <span>{status.error ?? 'Sign-in failed. Please try again.'}</span>
              <Button variant="primary" size="sm" icon={<LogIn size={13} />} onClick={signIn}>
                Retry
              </Button>
            </div>
          ) : status.status === 'timeout' ? (
            <div className={styles.errorBox}>
              <AlertCircle size={20} />
              <span>Sign-in timed out after 5 minutes.</span>
              <Button variant="primary" size="sm" icon={<LogIn size={13} />} onClick={signIn}>
                Try again
              </Button>
            </div>
          ) : signingIn ? (
            status.status === 'waiting' && status.authUrl ? (
              <div className={styles.authLinkBox}>
                <div className={styles.authLinkHeader}>
                  <Spinner size="xs" />
                  <span>Waiting for you to authorize…</span>
                </div>
                <p className={styles.authLinkHint}>
                  Open this link, sign in to Plex, and click <strong>Approve</strong>.
                  This page finishes automatically.
                </p>
                <div className={styles.authLinkRow}>
                  <code className={styles.authLinkUrl} title={status.authUrl}>{status.authUrl}</code>
                  <button
                    type="button"
                    className={styles.authCopyBtn}
                    onClick={async () => {
                      try {
                        if (!(await copyText(status.authUrl!))) return
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1800)
                      } catch { /* clipboard may be blocked */ }
                    }}
                    title="Copy link"
                  >
                    {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                  </button>
                  <button
                    type="button"
                    className={styles.authOpenBtn}
                    onClick={() => window.open(status.authUrl!, '_blank', 'noopener')}
                    title="Open in new tab"
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
                <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
              </div>
            ) : (
              <div className={styles.waitingRow}>
                <Spinner size="sm" />
                <span>Connecting…</span>
                <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
              </div>
            )
          ) : (
            <>
              <p className={styles.signInDesc}>
                Your Plex account is required to browse libraries, apply posters, and run schedules.
                Access is limited to users who can sign in to your linked Plex account.
              </p>
              <Button variant="primary" size="lg" icon={<LogIn size={16} />} onClick={signIn}>
                Sign in with Plex
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
