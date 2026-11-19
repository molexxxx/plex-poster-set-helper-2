import { useEffect, useState } from 'react'
import type { AppEnv, SchedulerEngineStatus } from '../../../../electron/ipc/types'

/**
 * Where the app runs, and the launch-at-login setting desktop installs offer.
 * Reads both on mount.
 *
 * @returns The environment (null until read), whether the app launches at
 *   login, whether a 24/7 engine elsewhere runs the jobs, and `toggleAutoStart`.
 */
export function useAppEnv()
{
  const [env, setEnv]             = useState<AppEnv | null>(null)
  const [autoStart, setAutoStart] = useState(false)
  const [engine, setEngine]       = useState<SchedulerEngineStatus>({ external: false })

  useEffect(() =>
  {
    window.api.app.getEnv().then(e => {
      setEnv(e)
      if (e.web) return
      window.api.scheduler.getAutoStart().then(setAutoStart).catch(() => { /* keep off */ })
      window.api.scheduler.engineStatus().then(setEngine).catch(() => { /* assume local */ })
    })
  }, [])
  async function toggleAutoStart(on: boolean) {
    setAutoStart(on)
    try {
      await window.api.scheduler.setAutoStart(on)
    } catch {
      setAutoStart(!on)
    }
  }

  return { env, autoStart, engine, toggleAutoStart }
}
