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
}

export const AppContext = createContext<AppContextValue>({
  navigate: () => {},
  plexConnected: false,
  navDock: 'auto',
  setNavDock: () => {},
})

/** Accesses the shared app context. */
export function useAppContext() {
  return useContext(AppContext)
}
