import { EventEmitter } from 'events'
import type { BrowserInstallState, LogEntry, PlexAuthStatus, ScrapeProgress, ScheduledJob, UpdateInfo, UpdateProgress, UserSetsChunk } from '../ipc/types'

export type AppEventMap = {
  'scrape:progress': ScrapeProgress
  'auth:statusChange': PlexAuthStatus
  'scheduler:onChange': ScheduledJob[]
  'browser:installProgress': string
  'browser:installState': BrowserInstallState
  'log:stream': LogEntry
  'app:updateAvailable': UpdateInfo
  'app:downloadProgress': UpdateProgress
  'app:updateReady': void
  'library:userSetsChunk': UserSetsChunk
}

class AppEventBus extends EventEmitter {
  emitEvent<K extends keyof AppEventMap>(event: K, data: AppEventMap[K]): void {
    this.emit(event, data)
  }

  onEvent<K extends keyof AppEventMap>(event: K, listener: (data: AppEventMap[K]) => void): () => void {
    this.on(event, listener)
    return () => this.off(event, listener)
  }
}

export const appEvents = new AppEventBus()
