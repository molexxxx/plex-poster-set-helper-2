import { useCallback, useState } from 'react'
import type { AppConfig } from '../../../../electron/ipc/types'

/**
 * The config as the Settings page shows it, saved one field at a time.
 *
 * @returns The config (null until `loadConfig` runs), its setter, `autosave`,
 *   `loadConfig`, which resolves to the config it read, and the saved TMDB key
 *   with `saveTmdbKey`.
 */
export function useSettingsConfig()
{
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [savedTmdbKey, setSavedTmdbKey] = useState('')

  function autosave<K extends keyof AppConfig>(key: K, value: AppConfig[K])
  {
    setCfg(prev => prev ? { ...prev, [key]: value } : prev)
    void window.api.config.set({ [key]: value })
  }

  const loadConfig = useCallback(async () =>
  {
    const c = await window.api.config.get() as AppConfig
    setCfg(c)
    setSavedTmdbKey((c.tmdbApiKey ?? '').trim())
    return c
  }, [])

  function saveTmdbKey(value: string)
  {
    const key = value.trim()
    autosave('tmdbApiKey', key)
    setSavedTmdbKey(key)
  }

  return { cfg, setCfg, autosave, loadConfig, savedTmdbKey, saveTmdbKey }
}

/** The config state and actions `useSettingsConfig` returns. */
export type SettingsConfig = ReturnType<typeof useSettingsConfig>
