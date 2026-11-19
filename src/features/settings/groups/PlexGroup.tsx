import type { AppConfig } from '../../../../electron/ipc/types'
import type { SettingsConfig } from '../hooks/useSettingsConfig'
import type { PlexAccount } from '../hooks/usePlexAccount'
import AccountBlock from '../components/AccountBlock'
import ServerBlock from '../components/ServerBlock'
import LibrariesBlock from '../components/LibrariesBlock'

interface PlexGroupProps
{
  cfg: AppConfig
  setCfg: SettingsConfig['setCfg']
  plex: PlexAccount
  /** Opens the sign-out confirmation. */
  setConfirm: (dialog: 'signout') => void
}

/** The Plex group: the account, the server address once signed in, and the libraries once connected. */
export default function PlexGroup({ cfg, setCfg, plex, setConfirm }: PlexGroupProps)
{
  const connected = plex.authStatus.status === 'authorized'

  return (
    <>
      <AccountBlock cfg={cfg} plex={plex} connected={connected} setConfirm={setConfirm} />
      {connected && <ServerBlock cfg={cfg} setCfg={setCfg} plex={plex} />}
      {plex.serverConnected && <LibrariesBlock cfg={cfg} plex={plex} />}
    </>
  )
}
