import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { UpdateInfo, UpdateProgress, AppEnv } from '../../../electron/ipc/types'

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready'

interface UpdaterValue {
  status: UpdateStatus
  info: UpdateInfo | null
  progress: UpdateProgress | null
  version: string
  env: AppEnv | null
  mode: 'desktop' | 'docker'
  lastChecked: number | null
  dismissed: boolean
  check: () => Promise<UpdateInfo>
  download: () => void
  restart: () => void
  dismiss: () => void
  reopen: () => void
}

const UpdaterContext = createContext<UpdaterValue>({
  status: 'idle', info: null, progress: null, version: '', env: null, mode: 'desktop', lastChecked: null, dismissed: false,
  check: async () => ({ available: false }), download: () => {}, restart: () => {}, dismiss: () => {}, reopen: () => {},
})

export const useUpdater = () => useContext(UpdaterContext)

export function UpdaterProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus]           = useState<UpdateStatus>('idle')
  const [info, setInfo]               = useState<UpdateInfo | null>(null)
  const [progress, setProgress]       = useState<UpdateProgress | null>(null)
  const [version, setVersion]         = useState('')
  const [env, setEnv]                 = useState<AppEnv | null>(null)
  const [lastChecked, setLastChecked] = useState<number | null>(null)
  const [dismissed, setDismissed]     = useState(false)

  const check = useCallback(async () => {
    setStatus(prev => (prev === 'idle' ? 'checking' : prev))
    const res = await window.api.app.checkUpdate()
    setLastChecked(Date.now())
    if (res.available) {
      setInfo(res)
      setDismissed(false)
      setStatus(prev => (prev === 'downloading' || prev === 'ready' ? prev : 'available'))
    } else {
      setStatus(prev => (prev === 'checking' ? 'idle' : prev))
    }
    return res
  }, [])

  useEffect(() => {
    window.api.app.getEnv().then(e => {
      setEnv(e)
      setVersion(e.version)
      // Docker/container can't self-update and the main process skips electron-updater,
      // so poll GitHub Releases once on startup to surface "please pull a new image".
      if (e.container) void check()
    })
    // Desktop (packaged) push events from electron-updater:
    const offAvail = window.api.app.onUpdateAvailable(i => { setInfo({ ...i, mode: 'desktop' }); setStatus('available'); setDismissed(false) })
    const offProg  = window.api.app.onDownloadProgress(p => { setProgress(p); setStatus('downloading') })
    const offReady = window.api.app.onUpdateReady(() => { setStatus('ready'); setDismissed(false) })
    return () => { offAvail(); offProg(); offReady() }
  }, [check])

  const mode: 'desktop' | 'docker' = info?.mode ?? (env?.container ? 'docker' : 'desktop')

  const download = useCallback(() => { setStatus('downloading'); setProgress(null); window.api.app.installUpdate() }, [])
  const restart  = useCallback(() => { window.api.app.quitAndInstall() }, [])
  const dismiss  = useCallback(() => setDismissed(true), [])
  const reopen   = useCallback(() => setDismissed(false), [])

  return (
    <UpdaterContext.Provider value={{ status, info, progress, version, env, mode, lastChecked, dismissed, check, download, restart, dismiss, reopen }}>
      {children}
    </UpdaterContext.Provider>
  )
}
