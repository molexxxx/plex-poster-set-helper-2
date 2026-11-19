import Switch from '../../../components/ui/Switch'
import Segmented from '../../../components/ui/Segmented'
import { useAppContext } from '../../../app/AppContext'
import type { AppConfig, AppEnv } from '../../../../electron/ipc/types'
import type { SettingsConfig } from '../hooks/useSettingsConfig'
import { NAV_DOCK_OPTIONS } from '../settingsOptions'
import Block from '../components/Block'
import Row from '../components/Row'
import AboutBlock from '../components/AboutBlock'

interface AppGroupProps
{
  cfg: AppConfig
  autosave: SettingsConfig['autosave']
  env: AppEnv | null
  isWeb: boolean
  /** Offer launch at login: a desktop install whose jobs no 24/7 engine elsewhere runs. */
  showAutoStart: boolean
  autoStart: boolean
  toggleAutoStart: (on: boolean) => Promise<void>
  announce: (message: string) => void
}

/** The App group: the window and tray, the legacy pages, and the version and updates. */
export default function AppGroup({ cfg, autosave, env, isWeb, showAutoStart, autoStart, toggleAutoStart, announce }: AppGroupProps)
{
  const { navDock, setNavDock, showLegacyTools, setShowLegacyTools } = useAppContext()
  return (
    <>
      <Block title="Window" anchor="general">
        <Row label="Navigation dock" description="Where the page buttons sit. Automatic moves them into the status bar on small windows.">
          {({ labelId }) => (
            <Segmented options={NAV_DOCK_OPTIONS} value={navDock} onChange={setNavDock} ariaLabelledBy={labelId} />
          )}
        </Row>
        {!isWeb && (
          <Row label="Tray notice" description="Show a notice when the app minimizes to the system tray.">
            {({ labelId, descId }) => (
              <Switch checked={cfg.trayNotice ?? true} onChange={v => autosave('trayNotice', v)} ariaLabelledBy={labelId} ariaDescribedBy={descId} />
            )}
          </Row>
        )}
        {showAutoStart && (
          <Row label="Launch at login" description="Open the app when you sign in to your computer, so scheduled jobs keep running.">
            {({ labelId, descId }) => (
              <Switch checked={autoStart} onChange={v => void toggleAutoStart(v)} ariaLabelledBy={labelId} ariaDescribedBy={descId} />
            )}
          </Row>
        )}
      </Block>

      <Block title="Legacy tools" anchor="legacy">
        <Row
          label="Show legacy tools"
          description="Adds two older pages to the navigation: Manual Import, for pasting MediUX and ThePosterDB links or running bulk files, and Title Mappings, for pointing a Plex title at a different name on the poster sites. Saved mappings keep applying while the page is hidden. Starts on when either page holds saved work."
        >
          {({ labelId, descId }) => (
            <Switch checked={showLegacyTools} onChange={setShowLegacyTools} ariaLabelledBy={labelId} ariaDescribedBy={descId} />
          )}
        </Row>
      </Block>

      <AboutBlock env={env} announce={announce} />
    </>
  )
}
