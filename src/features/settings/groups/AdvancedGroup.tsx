import Select from '../../../components/ui/Select'
import type { AppConfig } from '../../../../electron/ipc/types'
import type { SettingsConfig } from '../hooks/useSettingsConfig'
import type { BrowserEngine } from '../hooks/useBrowserEngine'
import type { LogsAndCaches } from '../hooks/useLogsAndCaches'
import { WORKER_OPTIONS } from '../settingsOptions'
import Block from '../components/Block'
import Row from '../components/Row'
import BrowserEngineBlock from '../components/BrowserEngineBlock'
import LogsBlock from '../components/LogsBlock'
import controls from '../components/controls.module.css'

interface AdvancedGroupProps
{
  cfg: AppConfig
  autosave: SettingsConfig['autosave']
  isWeb: boolean
  browser: BrowserEngine
  maintenance: LogsAndCaches
  /** Opens the clear-logs or clear-cached-data confirmation. */
  setConfirm: (dialog: 'logs' | 'caches') => void
}

/** The Advanced group: download speed, the browser engine, and logs and cached data. */
export default function AdvancedGroup({ cfg, autosave, isWeb, browser, maintenance, setConfirm }: AdvancedGroupProps)
{
  return (
    <>
      <Block title="Downloads" anchor="scraper">
        <Row label="Sets fetched at once" description="Higher is faster but heavier on MediUX and ThePosterDB.">
          {({ labelId }) => (
            <div className={controls.selectWrap}>
              <Select
                options={WORKER_OPTIONS}
                value={String(cfg.maxWorkers)}
                onChange={v => autosave('maxWorkers', Number(v))}
                ariaLabelledBy={labelId}
              />
            </div>
          )}
        </Row>
      </Block>

      <BrowserEngineBlock browser={browser} isWeb={isWeb} />

      <LogsBlock cfg={cfg} isWeb={isWeb} maintenance={maintenance} setConfirm={setConfirm} />
    </>
  )
}
