import { create } from 'zustand'
import type { LibraryItem } from '../../electron/ipc/types'

/** Where to land inside the Library Browser when navigating there. */
export interface LibraryIntent {
  /** A Plex library section key to open in My Library. */
  section?: string
  /** A MediUX creator to open in the Creators view. */
  creator?: string
  /** A specific library item to open the MediUX sets panel for. */
  item?: LibraryItem
}

/**
 * Cross-page navigation intents set by the command palette and consumed (then
 * cleared) by the destination page, so a search result can scroll/jump straight
 * to the right spot.
 */
interface NavStore {
  libraryIntent: LibraryIntent | null
  /** data-anchor of the Settings section to scroll to and pulse. */
  settingsAnchor: string | null
  /** Scheduled job id to scroll to and highlight. */
  schedulerJobId: string | null

  goLibrary: (intent: LibraryIntent) => void
  goSettings: (anchor: string) => void
  goScheduler: (jobId: string) => void

  clearLibrary: () => void
  clearSettings: () => void
  clearScheduler: () => void
}

export const useNavStore = create<NavStore>((set) => ({
  libraryIntent: null,
  settingsAnchor: null,
  schedulerJobId: null,

  goLibrary: (libraryIntent) => set({ libraryIntent }),
  goSettings: (settingsAnchor) => set({ settingsAnchor }),
  goScheduler: (schedulerJobId) => set({ schedulerJobId }),

  clearLibrary: () => set({ libraryIntent: null }),
  clearSettings: () => set({ settingsAnchor: null }),
  clearScheduler: () => set({ schedulerJobId: null }),
}))
