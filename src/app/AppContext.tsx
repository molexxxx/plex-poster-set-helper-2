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
}

export const AppContext = createContext<AppContextValue>({
  navigate: () => {},
  plexConnected: false,
  navDock: 'auto',
  setNavDock: () => {},
  smoothScroll: false,
})

/** Accesses the shared app context. */
export function useAppContext() {
  return useContext(AppContext)
}
