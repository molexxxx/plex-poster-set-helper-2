import { useMemo, useState } from 'react'
import { Copy, Check, Container, Boxes, Terminal } from 'lucide-react'
import Modal from '../../components/ui/Modal'
import styles from './DockerUpdateModal.module.css'

const GUIDE_URL = 'https://github.com/molexxxx/plex-poster-set-helper-2/blob/main/docker/README.md#updating-to-a-new-version'

type Method = 'unraid' | 'compose' | 'script'
type Os = 'windows' | 'mac' | 'linux'

/**
 * Best-effort guess of the viewer's OS from the user agent. The commands run on
 * the Docker host, which we can't see from inside the container, so this only
 * picks a sensible default tab and the right shell for the run-script method.
 */
function detectOs(): Os {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '').toLowerCase()
  if (/(windows|win32|win64)/.test(ua)) return 'windows'
  if (/(mac|iphone|ipad|ipod)/.test(ua)) return 'mac'
  return 'linux'
}

/**
 * A copyable block of shell commands.
 *
 * Copy is best-effort: browsers only expose the clipboard API on a secure
 * context (https or localhost), so over plain http on a LAN address the text
 * stays selectable by hand instead.
 */
function CmdBlock({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked on http - the text stays selectable */ }
  }
  return (
    <div className={styles.cmd}>
      <pre className={styles.cmdText}>{lines.join('\n')}</pre>
      <button className={styles.copyBtn} onClick={copy} title="Copy commands">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  )
}

const TABS: { id: Method; label: string; icon: React.ReactNode }[] = [
  { id: 'unraid',  label: 'unraid',         icon: <Container size={13} /> },
  { id: 'compose', label: 'Docker Compose', icon: <Boxes size={13} /> },
  { id: 'script',  label: 'Run script',     icon: <Terminal size={13} /> },
]

/**
 * Step-by-step update instructions for the Docker / unraid build, grouped by
 * method. The containerized app is viewed from a browser on another machine, so
 * the host has no desktop and openExternal can't surface a guide - every method
 * is listed and the modal opens to the one that best matches the viewer's OS.
 */
export default function DockerUpdateModal({ open, onClose, version }: {
  open: boolean
  onClose: () => void
  version?: string
}) {
  const os = useMemo(() => detectOs(), [])
  // unraid/NAS hosts are usually managed from a Linux browser; a Windows or Mac
  // viewer is more likely running the repo's launcher script, so default there.
  const [method, setMethod] = useState<Method>(os === 'linux' ? 'unraid' : 'script')

  const otherShell = os === 'windows' ? './docker/run.sh --build' : './docker/run.ps1 -Build'

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={version ? `Update to v${version}` : 'Update your container'}
      description="Your settings, schedules, and history live in the config volume and are never touched. Pull the latest, rebuild, and restart on whichever machine runs Docker."
    >
      <div className={styles.tabs} role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={method === t.id}
            className={`${styles.tab} ${method === t.id ? styles.tabActive : ''}`}
            onClick={() => setMethod(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.panel}>
        {method === 'unraid' && (
          <>
            <p className={styles.panelText}>
              Installed from <strong>Community Applications</strong>? Open the <strong>Docker</strong> tab,
              click <strong>Plex Poster Helper</strong>, and choose <strong>Force update</strong>. unraid pulls the
              latest image from Docker Hub and restarts - no commands needed.
            </p>
          </>
        )}

        {method === 'compose' && (
          <>
            <p className={styles.panelText}>Run from the repo folder on your Docker host:</p>
            <CmdBlock lines={['git pull', 'docker compose -f docker/docker-compose.yml up -d --build']} />
          </>
        )}

        {method === 'script' && (
          <>
            <p className={styles.panelText}>
              One command from the repo folder
              {os !== 'linux' && <> (detected <strong>{os === 'windows' ? 'Windows' : 'macOS'}</strong>)</>}:
            </p>
            <CmdBlock lines={['git pull', os === 'windows' ? './docker/run.ps1 -Build' : './docker/run.sh --build']} />
            <p className={styles.panelHint}>
              {os === 'windows' ? 'On Mac / Linux: ' : 'On Windows: '}
              <code className={styles.inlineCode}>{otherShell}</code>
            </p>
          </>
        )}
      </div>

      <div className={styles.guide}>
        <span className={styles.guideLabel}>Full guide</span>
        <CmdBlock lines={[GUIDE_URL]} />
      </div>
    </Modal>
  )
}
