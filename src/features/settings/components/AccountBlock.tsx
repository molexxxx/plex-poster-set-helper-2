import { LogIn, LogOut, CheckCircle2, Copy, ExternalLink } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Spinner from '../../../components/ui/Spinner'
import type { AppConfig } from '../../../../electron/ipc/types'
import { copyText } from '../../../utils/clipboard'
import type { PlexAccount } from '../hooks/usePlexAccount'
import Block from './Block'
import Row from './Row'
import rowStyles from './settingsRows.module.css'
import styles from './AccountBlock.module.css'

interface AccountBlockProps
{
  cfg: AppConfig
  plex: PlexAccount
  /** Signed in to Plex. */
  connected: boolean
  /** Opens the sign-out confirmation. */
  setConfirm: (dialog: 'signout') => void
}

/** The Plex account: who is signed in, the sign-in link while approval is pending, or the sign-in button. */
export default function AccountBlock({ cfg, plex, connected, setConfirm }: AccountBlockProps)
{
  const { authStatus, signingIn, setSigningIn, copiedAuth, setCopiedAuth, signIn } = plex
  return (
    <Block title="Account" anchor="plex-account">
      {connected ? (
        <Row
          label={
            <span className={styles.account}>
              {cfg.plexAccountThumb && (
                <img
                  src={cfg.plexAccountThumb}
                  alt=""
                  className={styles.avatar}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <span className={styles.accountText}>
                <span>{cfg.plexAccountName || 'Plex user'}</span>
                <span className={rowStyles.rowDesc}>{cfg.plexAccountEmail ? `${cfg.plexAccountEmail} · Signed in` : 'Signed in'}</span>
              </span>
            </span>
          }
        >
          <Button variant="destructive" size="sm" icon={<LogOut size={13} />} onClick={() => setConfirm('signout')}>
            Sign out
          </Button>
        </Row>
      ) : signingIn ? (
        authStatus.status === 'waiting' && authStatus.authUrl ? (
          <Row stacked label="Waiting for you to approve the sign-in" description="Open this link on any device, sign in to Plex, and approve. This page updates by itself.">
            <div className={styles.authLinkRow}>
              <code className={styles.authLinkUrl} title={authStatus.authUrl}>{authStatus.authUrl}</code>
              <Button
                variant="secondary" size="sm"
                icon={copiedAuth ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                onClick={async () =>
                {
                  try { if (!(await copyText(authStatus.authUrl!))) return; setCopiedAuth(true); setTimeout(() => setCopiedAuth(false), 1800) } catch { /* clipboard may be blocked */ }
                }}
              >
                {copiedAuth ? 'Copied' : 'Copy link'}
              </Button>
              <Button variant="secondary" size="sm" icon={<ExternalLink size={13} />} onClick={() => window.open(authStatus.authUrl!, '_blank')}>
                Open
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { window.api.auth.disconnect(); setSigningIn(false) }}>Cancel</Button>
            </div>
          </Row>
        ) : (
          <Row label="Starting sign-in…">
            <Spinner size="sm" />
            <Button variant="ghost" size="sm" onClick={() => { window.api.auth.disconnect(); setSigningIn(false) }}>Cancel</Button>
          </Row>
        )
      ) : (
        <Row label="Plex account" description="Sign in to browse your libraries and apply art.">
          <Button variant="primary" size="sm" icon={<LogIn size={13} />} onClick={signIn}>Sign in with Plex</Button>
        </Row>
      )}
    </Block>
  )
}
