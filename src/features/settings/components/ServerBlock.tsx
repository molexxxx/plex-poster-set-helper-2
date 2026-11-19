import { Pencil, X, CheckCircle2, AlertTriangle } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Spinner from '../../../components/ui/Spinner'
import type { AppConfig } from '../../../../electron/ipc/types'
import type { SettingsConfig } from '../hooks/useSettingsConfig'
import type { PlexAccount } from '../hooks/usePlexAccount'
import Block from './Block'
import Row from './Row'
import controls from './controls.module.css'
import styles from './ServerBlock.module.css'

/** The Plex server: its name and address with a Change button, or the address field and Connect while it is set. */
export default function ServerBlock({ cfg, setCfg, plex }: { cfg: AppConfig; setCfg: SettingsConfig['setCfg']; plex: PlexAccount })
{
  const { serverConnected, editingServer, setEditingServer, serverName, testing, testMsg, setTestMsg, testConnection } = plex
  return (
    <Block title="Server" anchor="plex-server">
      {serverConnected && !editingServer ? (
        <Row
          label={<span className={styles.serverName}><span className={styles.serverDot} aria-hidden />{serverName || 'Plex server'}</span>}
          description={<span className={styles.serverUrl} title={cfg.baseUrl}>{cfg.baseUrl}</span>}
        >
          <Button variant="secondary" size="sm" icon={<Pencil size={12} />} onClick={() => setEditingServer(true)}>Change</Button>
        </Row>
      ) : (
        <Row stacked label="Server address" description="Found automatically after sign-in. Enter it yourself if it was not, for example http://192.168.1.20:32400.">
          {({ labelId }) => (
            <>
              <div className={controls.inputRow}>
                <input
                  className={controls.textInput}
                  value={cfg.baseUrl}
                  onChange={e => setCfg(prev => prev ? { ...prev, baseUrl: e.target.value } : prev)}
                  onKeyDown={e => { if (e.key === 'Enter' && cfg.baseUrl && !testing) void testConnection() }}
                  placeholder="http://localhost:32400"
                  spellCheck={false}
                  aria-labelledby={labelId}
                />
                <Button
                  variant="primary"
                  size="sm"
                  icon={testing ? <Spinner size="xs" color="current" /> : undefined}
                  onClick={testConnection}
                  disabled={testing || !cfg.baseUrl}
                >
                  {testing ? 'Connecting…' : 'Connect'}
                </Button>
                {editingServer && (
                  <Button variant="ghost" size="sm" icon={<X size={13} />} aria-label="Cancel changing the server" onClick={() => { setEditingServer(false); setTestMsg(null) }} />
                )}
              </div>
              {testMsg && (
                <p className={testMsg.ok ? styles.statusOk : styles.statusErr} role="status">
                  {testMsg.ok ? <CheckCircle2 size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />} {testMsg.msg}
                </p>
              )}
            </>
          )}
        </Row>
      )}
    </Block>
  )
}
