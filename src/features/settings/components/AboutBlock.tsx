import { useState } from 'react'
import { RefreshCw, Download, BookOpen } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Spinner from '../../../components/ui/Spinner'
import { useUpdater } from '../../updater/UpdaterContext'
import DockerUpdateModal from '../../updater/DockerUpdateModal'
import type { AppEnv } from '../../../../electron/ipc/types'
import Block from './Block'
import Row from './Row'
import styles from './AboutBlock.module.css'
/** Version and update rows. */
export default function AboutBlock({ env, announce }: { env: AppEnv | null; announce: (message: string) => void }) {
  const { status, info, version, mode, lastChecked, check, download, restart } = useUpdater()
  const [checking, setChecking] = useState(false)
  const [upToDate, setUpToDate] = useState(false)
  const [showDockerGuide, setShowDockerGuide] = useState(false)
  const isDocker = mode === 'docker'
  const devBuild = !!env && !env.packaged && !env.web

  async function onCheck() {
    setChecking(true)
    setUpToDate(false)
    const res = await check()
    setChecking(false)
    if (!res.available) {
      setUpToDate(true)
      announce('You have the latest version')
    }
  }

  const versionNote = devBuild
    ? 'Development build'
    : env?.web
      ? 'Running in Docker'
      : lastChecked
        ? `Last checked for updates at ${new Date(lastChecked).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : 'Not checked for updates yet'
  const updateNote = devBuild
    ? 'Development builds do not update themselves'
    : isDocker
      ? 'The Docker image updates when you pull a new one'
      : upToDate
        ? 'You have the latest version'
        : 'Checks GitHub for a newer release'

  return (
    <Block title="About" anchor="application">
      <Row label="Version" description={versionNote}>
        <span className={styles.versionTag}>v{version || '…'}</span>
      </Row>
      <Row label="Updates" description={updateNote}>
        {isDocker && status === 'available' && (
          <Button variant="primary" size="sm" icon={<BookOpen size={13} />} onClick={() => setShowDockerGuide(true)}>
            How to update to v{info?.version}
          </Button>
        )}
        {!isDocker && status === 'available' && (
          <Button variant="primary" size="sm" icon={<Download size={13} />} onClick={download}>
            Download v{info?.version}
          </Button>
        )}
        {!isDocker && status === 'downloading' && <span className={styles.inlineStatus}><Spinner size="xs" /> Downloading…</span>}
        {!isDocker && status === 'ready' && (
          <Button variant="primary" size="sm" icon={<RefreshCw size={13} />} onClick={restart}>
            Relaunch to update
          </Button>
        )}
        {(status === 'idle' || status === 'checking' || (isDocker && status !== 'available')) && !devBuild && (
          <Button
            variant="secondary" size="sm"
            icon={checking ? <Spinner size="xs" color="current" /> : <RefreshCw size={13} />}
            onClick={onCheck}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>
        )}
      </Row>
      <DockerUpdateModal open={showDockerGuide} onClose={() => setShowDockerGuide(false)} version={info?.version} />
    </Block>
  )
}
