import { useEffect, useState } from 'react'
import type { ArtworkType } from '../../../../electron/ipc/types'
import { ARTWORK_TYPES } from '../../../../electron/services/scheduleUtils'
/**
 * The artwork types picked in Settings, which jobs without their own choice follow.
 *
 * @returns The types, every type until Settings has loaded.
 */
export function useSettingsTypes(): ArtworkType[]
{
  const [types, setTypes] = useState<ArtworkType[]>([...ARTWORK_TYPES])
  useEffect(() =>
  {
    let cancelled = false
    window.api.config.get()
      .then(c => { if (!cancelled && c.mediuxFilters) setTypes(c.mediuxFilters) })
      .catch(() => { /* keep every type */ })
    return () => { cancelled = true }
  }, [])
  return types
}
