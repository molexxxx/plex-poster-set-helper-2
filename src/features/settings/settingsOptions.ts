import { Server, Image as ImageIcon, AppWindow, Wrench, type LucideIcon } from 'lucide-react'
import { LOG_RETENTION_OPTIONS } from '../../../electron/services/logFormat'
import type { BrowserSource, NavDockMode } from '../../../electron/ipc/types'

/** The settings groups; the page shows one at a time. */
export type GroupId = 'plex' | 'artwork' | 'app' | 'advanced'

/** The sidebar entries in order, with the line shown under each group's title. */
export const GROUPS: Array<{ id: GroupId; label: string; Icon: LucideIcon; description: string }> = [
  { id: 'plex',     label: 'Plex',     Icon: Server,    description: 'Your account, your server, and the libraries the app works on.' },
  { id: 'artwork',  label: 'Artwork',  Icon: ImageIcon, description: 'What gets applied to Plex and how titles are matched.' },
  { id: 'app',      label: 'App',      Icon: AppWindow, description: 'Navigation, the tray, startup, and updates.' },
  { id: 'advanced', label: 'Advanced', Icon: Wrench,    description: 'Download speed, the browser engine, logs, and cached data.' },
]

/** Which group holds each command-palette deep-link anchor. */
export const ANCHOR_GROUP: Record<string, GroupId> = {
  'plex-account': 'plex', 'plex-server': 'plex', libraries: 'plex',
  'mediux-filters': 'artwork', collections: 'artwork', 'quick-sync': 'artwork', tmdb: 'artwork',
  general: 'app', application: 'app', legacy: 'app',
  scraper: 'advanced', browser: 'advanced', logs: 'advanced',
}

/** How the browser engine row names where its executable comes from. */
export const SOURCE_LABELS: Record<BrowserSource, string> = {
  bundled: 'Bundled with the app',
  managed: 'Downloaded copy',
  system: 'System browser',
  custom: 'Custom path',
}

/** Choices for where the navigation dock sits. */
export const NAV_DOCK_OPTIONS: Array<{ value: NavDockMode; label: string }> = [
  { value: 'auto', label: 'Automatic' },
  { value: 'floating', label: 'Floating' },
  { value: 'bar', label: 'Status bar' },
]

/** Choices for how many sets are fetched at once. */
export const WORKER_OPTIONS = Array.from({ length: 8 }, (_, i) =>
{
  const n = i + 1
  return { value: String(n), label: n === 1 ? '1 (gentlest)' : n === 8 ? '8 (fastest)' : String(n) }
})

/** Choices for how many days of logs are kept. */
export const RETENTION_OPTIONS = LOG_RETENTION_OPTIONS.map(n => ({ value: String(n), label: n === 1 ? '1 day' : `${n} days` }))

/** The artwork types every apply starts with, one switch each. */
export const ASSET_TYPES = [
  { type: 'poster',     name: 'Posters',     desc: 'Movie, show, season, and collection covers' },
  { type: 'backdrop',   name: 'Backdrops',   desc: 'Wide background art behind a title' },
  { type: 'title_card', name: 'Title cards', desc: 'Episode thumbnails for TV shows' },
] as const
