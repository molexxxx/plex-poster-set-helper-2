import { createContext, useContext } from 'react'
import type { NavTab } from './App'
import type { NavDockMode } from '../../electron/ipc/types'

interface AppContextValue {
  navigate: (tab: NavTab) => void
  plexConnected: boolean
  /** Where the navigation dock sits, as the user chose it. */
  navDock: NavDockMode
  /** Moves the navigation dock and saves the choice. */
  setNavDock: (mode: NavDockMode) => void
  /** Whether scrollers may opt in to smoothed wheel scrolling (desktop app only). */
  smoothScroll: boolean
  /** Whether the older Manual Import and Title Mappings pages are listed in the navigation. */
  showLegacyTools: boolean
  /** Shows or hides the legacy tools and saves the choice. */
  setShowLegacyTools: (show: boolean) => void
}

export const AppContext = createContext<AppContextValue>({
  navigate: () => {},
  plexConnected: false,
  navDock: 'auto',
  setNavDock: () => {},
  smoothScroll: false,
  showLegacyTools: false,
  setShowLegacyTools: () => {},
})

/** Accesses the shared app context. */
export function useAppContext() {
  return useContext(AppContext)
}
