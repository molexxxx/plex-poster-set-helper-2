import Switch from '../../../components/ui/Switch'
import Select from '../../../components/ui/Select'
import { DEFAULT_QUICK_CRON, QUICK_SCHEDULES, describeCron } from '../../../../electron/services/scheduleUtils'
import type { AppConfig, Library } from '../../../../electron/ipc/types'
import type { SettingsConfig } from '../hooks/useSettingsConfig'
import type { AnimeList } from '../hooks/useAnimeList'
import { ASSET_TYPES } from '../settingsOptions'
import Block from '../components/Block'
import Row from '../components/Row'
import TitleMatchingBlock from '../components/TitleMatchingBlock'
import controls from '../components/controls.module.css'

interface ArtworkGroupProps
{
  cfg: AppConfig
  setCfg: SettingsConfig['setCfg']
  autosave: SettingsConfig['autosave']
  /** The server's libraries; the collections switch shows when one holds movies. */
  libraries: Library[]
  serverConnected: boolean
  savedTmdbKey: string
  saveTmdbKey: (value: string) => void
  showKey: boolean
  setShowKey: (update: (shown: boolean) => boolean) => void
  anime: AnimeList
}

/** The Artwork group: the types every apply starts with, Library Browser options, and title matching. */
export default function ArtworkGroup({ cfg, setCfg, autosave, libraries, serverConnected, savedTmdbKey, saveTmdbKey, showKey, setShowKey, anime }: ArtworkGroupProps)
{
  const movieLibs = libraries.filter(l => l.type === 'movie')
  return (
    <>
      <Block title="Artwork types" anchor="mediux-filters" description="The types every apply starts with, from MediUX and ThePosterDB. The Library Browser, Creators, and Manual Import can change them while you work, and a scheduled job can keep its own.">
        {ASSET_TYPES.map(({ type, name, desc }) =>
        {
          const on = cfg.mediuxFilters.includes(type)
          return (
            <Row key={type} label={name} description={desc}>
              {({ labelId, descId }) => (
                <Switch
                  checked={on}
                  onChange={checked => autosave('mediuxFilters', checked ? [...cfg.mediuxFilters, type] : cfg.mediuxFilters.filter(t => t !== type))}
                  ariaLabelledBy={labelId}
                  ariaDescribedBy={descId}
                />
              )}
            </Row>
          )
        })}
      </Block>

      <Block title="Library Browser" anchor="collections">
        {(movieLibs.length > 0 || !serverConnected) && (
          <Row label="Show collections" description="Browse and apply art to your Plex collections.">
            {({ labelId, descId }) => (
              <Switch
                checked={cfg.collectionsEnabled !== false}
                onChange={on => autosave('collectionsEnabled', on)}
                ariaLabelledBy={labelId}
                ariaDescribedBy={descId}
              />
            )}
          </Row>
        )}
        <div data-anchor="quick-sync">
          <Row label="Schedule and Sync timing" description="The schedule a job gets when you use Schedule on a set or Sync on a creator.">
            {({ labelId }) =>
            {
              const current = cfg.schedulerQuickCron || DEFAULT_QUICK_CRON
              const options = (QUICK_SCHEDULES.includes(current) ? QUICK_SCHEDULES : [...QUICK_SCHEDULES, current])
                .map(expr => ({ value: expr, label: describeCron(expr) }))
              return (
                <div className={controls.selectWide}>
                  <Select options={options} value={current} onChange={v => autosave('schedulerQuickCron', v)} ariaLabelledBy={labelId} />
                </div>
              )
            }}
          </Row>
        </div>
      </Block>

      <TitleMatchingBlock
        cfg={cfg}
        setCfg={setCfg}
        autosave={autosave}
        savedTmdbKey={savedTmdbKey}
        saveTmdbKey={saveTmdbKey}
        showKey={showKey}
        setShowKey={setShowKey}
        anime={anime}
      />
    </>
  )
}
