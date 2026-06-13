import { LibraryBig, CalendarClock, ArrowLeftRight, Wand2, RotateCcw, Settings } from 'lucide-react'
import type { ComponentType } from 'react'
import type { NavTab } from '../../app/App'

export interface NavEntry {
  id: NavTab
  label: string
  /** Typed loosely so any lucide icon assigns cleanly without depending on lucide's prop types. */
  Icon: ComponentType<{ size?: number }>
  hint: string
}

/** Single source of truth for navigable sections, shared by the dock and command palette. */
export const NAV_ENTRIES: NavEntry[] = [
  { id: 'library',   label: 'Library Browser', Icon: LibraryBig,    hint: 'Browse Plex libraries and poster sets' },
  { id: 'scheduler', label: 'Scheduler',       Icon: CalendarClock, hint: 'Automated poster jobs and run history' },
  { id: 'mappings',  label: 'Title Mappings',  Icon: ArrowLeftRight, hint: 'Map source titles to Plex titles' },
  { id: 'manual',    label: 'Manual Import',   Icon: Wand2,         hint: 'Scrape URLs or run bulk files' },
  { id: 'reset',     label: 'Reset Posters',   Icon: RotateCcw,     hint: 'Restore original Plex artwork' },
  { id: 'settings',  label: 'Settings',        Icon: Settings,      hint: 'Plex connection and preferences' },
]
