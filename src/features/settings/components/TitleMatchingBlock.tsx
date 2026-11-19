import { RefreshCw, CheckCircle2, ExternalLink, Eye, EyeOff } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Spinner from '../../../components/ui/Spinner'
import Switch from '../../../components/ui/Switch'
import type { AppConfig } from '../../../../electron/ipc/types'
import type { SettingsConfig } from '../hooks/useSettingsConfig'
import type { AnimeList } from '../hooks/useAnimeList'
import { animeListText } from '../settingsText'
import Block from './Block'
import Row from './Row'
import controls from './controls.module.css'

interface TitleMatchingBlockProps
{
  cfg: AppConfig
  setCfg: SettingsConfig['setCfg']
  autosave: SettingsConfig['autosave']
  /** The key as last saved, which the row description reports on. */
  savedTmdbKey: string
  saveTmdbKey: (value: string) => void
  /** Show the key in plain text. */
  showKey: boolean
  setShowKey: (update: (shown: boolean) => boolean) => void
  anime: AnimeList
}

/** Title matching: the TMDB API key field, and the anime ID list with its update controls. */
export default function TitleMatchingBlock({ cfg, setCfg, autosave, savedTmdbKey, saveTmdbKey, showKey, setShowKey, anime }: TitleMatchingBlockProps)
{
  const { animeList, animeUpdating, animeUpdated, updateAnimeList } = anime
  return (
    <Block
      title="Title matching"
      anchor="tmdb"
      description="A free TMDB API key lets the app match titles by ID instead of name and year, which fixes most mismatches, including anime libraries that use HAMA."
    >
      <Row
        stacked
        label="TMDB API key"
        description={savedTmdbKey
          ? 'Saved. Matching uses TMDB IDs.'
          : 'No key: matching uses title and year, which can miss renamed titles.'}
      >
        {({ labelId, descId }) => (
          <div className={controls.inputRow}>
            <input
              className={`${controls.textInput} ${controls.mono}`}
              type={showKey ? 'text' : 'password'}
              value={cfg.tmdbApiKey ?? ''}
              onChange={e => setCfg(prev => prev ? { ...prev, tmdbApiKey: e.target.value } : prev)}
              onBlur={e => saveTmdbKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveTmdbKey((e.target as HTMLInputElement).value) }}
              placeholder="Paste your API key (v3)"
              spellCheck={false}
              autoComplete="off"
              aria-labelledby={labelId}
              aria-describedby={descId}
            />
            <Button
              variant="ghost" size="sm"
              icon={showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              aria-label={showKey ? 'Hide key' : 'Show key'}
              aria-pressed={showKey}
              onClick={() => setShowKey(v => !v)}
            />
            <Button
              variant="secondary" size="sm"
              icon={<ExternalLink size={13} />}
              onClick={() => window.api.app.openExternal('https://www.themoviedb.org/settings/api')}
            >
              Get a key
            </Button>
          </div>
        )}
      </Row>
      <Row label="Anime ID list" description={animeListText(animeList)}>
        <Button
          variant="secondary" size="sm"
          icon={animeUpdated
            ? <CheckCircle2 size={13} />
            : animeUpdating || animeList?.updating ? <Spinner size="xs" color="current" /> : <RefreshCw size={13} />}
          onClick={() => void updateAnimeList()}
          disabled={animeUpdating || !!animeList?.updating}
        >
          {animeUpdated
            ? 'Updated'
            : animeUpdating || animeList?.updating
              ? 'Downloading…'
              : animeList?.downloaded ? 'Update now' : 'Download now'}
        </Button>
      </Row>
      <Row
        label="Update the anime list automatically"
        description="Downloads the newest list once a week, which is how often it is published. When off, it changes only when you click Update now."
      >
        {({ labelId, descId }) => (
          <Switch
            checked={cfg.animeListAutoUpdate ?? true}
            onChange={v => autosave('animeListAutoUpdate', v)}
            ariaLabelledBy={labelId}
            ariaDescribedBy={descId}
          />
        )}
      </Row>
    </Block>
  )
}
