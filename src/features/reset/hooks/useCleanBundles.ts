import { useEffect, useRef, useState } from 'react'
import { cleanLabel, type CleanState } from '../resetText'


/**
 * Plex's Clean Bundles task, as the Reset Posters page runs it: the button
 * shows the task's progress, then a done or failed state for a moment.
 *
 * @returns The task's state, whether it is running, the button label, and `cleanBundles`.
 */
export function useCleanBundles()
{
  const [cleanState, setCleanState] = useState<CleanState>('idle')
  const cleanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (cleanTimer.current) clearTimeout(cleanTimer.current) }, [])


  /**
   * Triggers Plex's Clean Bundles task. The IPC call resolves only once the task
   * actually clears server-side, so the button tracks real progress and ends the
   * moment it's done - no fixed cooldown.
   */
  async function cleanBundles()
  {
    if (cleanState === 'cleaning') return
    if (cleanTimer.current) clearTimeout(cleanTimer.current)
    setCleanState('cleaning')
    try
    {
      await window.api.plex.cleanBundles()
      setCleanState('done')
      cleanTimer.current = setTimeout(() => setCleanState('idle'), 2_500)
    }
    catch
    {
      setCleanState('error')
      cleanTimer.current = setTimeout(() => setCleanState('idle'), 4_000)
    }
  }

  return { cleanState, cleanBusy: cleanState === 'cleaning', cleanLabel: cleanLabel(cleanState), cleanBundles }
}

/** The Clean Bundles state and action, as `useCleanBundles` returns them. */
export type CleanBundles = ReturnType<typeof useCleanBundles>
